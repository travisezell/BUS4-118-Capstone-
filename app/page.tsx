"use client";

import { useEffect, useRef, useState } from "react";

type Role = "user" | "assistant";

interface ChatMessage {
  role: Role;
  content: string;
  meta?: {
    intent?: string;
    confidence?: number;
    sources?: string[];
    escalated?: boolean;
    latencyMs?: number;
    statusTrace?: { kind: string; label: string }[];
  };
}

const SAMPLE_PROMPTS: { label: string; prompt: string }[] = [
  { label: "Access · Figma", prompt: "I need access to Figma for the design review" },
  {
    label: "Account · locked out",
    prompt: "I'm locked out of my account",
  },
  { label: "Ticket · status", prompt: "What's the status of INC-1042?" },
  {
    label: "Q&A · password rules",
    prompt: "What are the password requirements?",
  },
];

const WELCOME =
  "Hi — I'm your IT support assistant. I can help with **access requests**, **account lockouts**, and **ticket status**, plus general IT questions. Try a quick prompt below or just type your question.";

// ─────────────────────────────────────────────────────────────────────
// Live status stepper
//
// The orchestrator records the agent stages internally, but the response
// is non-streaming — by the time the UI gets the trace, the request is
// already done. So we predict the likely stages from the user's text and
// step through them while the request is in flight. After the response
// arrives we replace the prediction with the *real* trace so the user
// sees what actually happened, including timing.
// ─────────────────────────────────────────────────────────────────────

interface Stage {
  label: string;
  ms: number;
}

const STAGE_INTAKE: Stage = { label: "Classifying request…", ms: 250 };
const STAGE_KNOWLEDGE: Stage = {
  label: "Searching IT documentation…",
  ms: 900,
};
const STAGE_WORKFLOW_ACCESS: Stage = {
  label: "Submitting access request…",
  ms: 700,
};
const STAGE_WORKFLOW_ACCOUNT: Stage = {
  label: "Checking account recovery options…",
  ms: 700,
};
const STAGE_WORKFLOW_TICKET: Stage = {
  label: "Looking up ticket status…",
  ms: 600,
};
const STAGE_RESPOND: Stage = { label: "Composing response…", ms: 400 };

/** Predict the agent flow from the user's message text. */
function predictStages(message: string): Stage[] {
  const m = message.toLowerCase();
  const trimmed = message.trim();

  // Greeting / non-help — system responds immediately, no doc search,
  // no tool calls. Match the actual graph behavior.
  if (
    /^(?:hi|hello|hey|yo|sup|hiya|howdy|good\s*(?:morning|afternoon|evening)|thanks?|thank\s*you|ok|okay|cool|test|\??)\s*[!.?]*\s*$/i.test(
      trimmed
    ) ||
    /\bwhat (?:can|do) you (?:do|help)\b/.test(m) ||
    /\bwho are you\b/.test(m)
  ) {
    return [STAGE_INTAKE, STAGE_RESPOND];
  }

  // Ticket status — usually the fastest path (skips Knowledge in the graph).
  if (
    /\b(?:inc|req|acc)-\d+\b/i.test(message) ||
    /\b(?:status|ticket|update)\b/.test(m)
  ) {
    return [STAGE_INTAKE, STAGE_WORKFLOW_TICKET, STAGE_RESPOND];
  }

  // Access — usually goes through Knowledge then Workflow.
  if (
    /\b(?:access|account.*to|provision|figma|slack|jira|github|notion|want to use|set me up)\b/.test(
      m
    )
  ) {
    return [
      STAGE_INTAKE,
      STAGE_KNOWLEDGE,
      STAGE_WORKFLOW_ACCESS,
      STAGE_RESPOND,
    ];
  }

  // Account help — Knowledge then conditionally Workflow.
  if (
    /\b(?:locked|lockout|password|sign[- ]?in|mfa|2fa|compromised|hacked|my account|can't log)\b/.test(
      m
    )
  ) {
    return [
      STAGE_INTAKE,
      STAGE_KNOWLEDGE,
      STAGE_WORKFLOW_ACCOUNT,
      STAGE_RESPOND,
    ];
  }

  // General Q&A — just classify, retrieve, respond.
  return [STAGE_INTAKE, STAGE_KNOWLEDGE, STAGE_RESPOND];
}

export default function Home() {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: "assistant", content: WELCOME },
  ]);
  const [statusLabel, setStatusLabel] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, statusLabel]);

  async function send(text: string) {
    const userText = text.trim();
    if (!userText || pending) return;

    setMessages((prev) => [...prev, { role: "user", content: userText }]);
    setInput("");
    setPending(true);

    // Predict the agent stages from the message and step through them
    // with realistic per-stage timing. We hold on the last stage if the
    // request hasn't returned yet so the user sees movement, not a
    // freeze.
    const predicted = predictStages(userText);
    setStatusLabel(predicted[0].label);
    let cancelled = false;
    let stageIdx = 0;

    const tick = () => {
      if (cancelled) return;
      stageIdx = Math.min(stageIdx + 1, predicted.length - 1);
      setStatusLabel(predicted[stageIdx].label);
      if (stageIdx < predicted.length - 1) {
        setTimeout(tick, predicted[stageIdx].ms);
      }
    };
    setTimeout(tick, predicted[0].ms);

    try {
      const history = messages
        .filter((m) => m.role !== "assistant" || m.content !== WELCOME)
        .map((m) => ({ role: m.role, content: m.content }));

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: userText, history }),
      });
      const data = await res.json();
      cancelled = true;
      setStatusLabel(null);

      if (!res.ok) {
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: `Sorry — ${data.error ?? "something went wrong."}`,
          },
        ]);
        return;
      }

      // Pull the real status trace out of the response. The orchestrator
      // emits one event per agent stage; we surface those in the
      // message metadata so users can see what actually ran.
      const statusTrace = (data.statusEvents ?? []).map(
        (e: { kind: string; label: string }) => ({
          kind: e.kind,
          label: e.label,
        })
      );

      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: data.response,
          meta: {
            intent: data.intent,
            confidence: data.confidence,
            sources: data.retrievedSources ?? [],
            escalated: data.escalated,
            latencyMs: data.latencyMs,
            statusTrace,
          },
        },
      ]);
    } catch (err) {
      cancelled = true;
      setStatusLabel(null);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `Sorry — I couldn't reach the server. (${
            err instanceof Error ? err.message : "unknown error"
          })`,
        },
      ]);
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col px-4 py-6 sm:py-10">
      <header className="mb-4 sm:mb-6">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-600 font-semibold text-white">
            IT
          </div>
          <div>
            <h1 className="text-lg font-semibold leading-tight">
              IT Support Assistant
            </h1>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Multi-agent · LangGraph · RAG · MCP · Group 5 BUS 118S
            </p>
          </div>
        </div>
      </header>

      <section
        ref={scrollRef}
        className="flex-1 space-y-4 overflow-y-auto rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
        style={{ minHeight: 420 }}
      >
        {messages.map((m, i) => (
          <MessageBubble key={i} message={m} />
        ))}
        {statusLabel && (
          <div className="flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-blue-500" />
            <span>{statusLabel}</span>
          </div>
        )}
      </section>

      <div className="mt-3 flex flex-wrap gap-2">
        {SAMPLE_PROMPTS.map((p) => (
          <button
            key={p.label}
            type="button"
            disabled={pending}
            onClick={() => send(p.prompt)}
            className="rounded-full border border-zinc-200 bg-white px-3 py-1 text-xs text-zinc-700 transition hover:border-blue-400 hover:text-blue-700 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:border-blue-500 dark:hover:text-blue-300"
          >
            {p.label}
          </button>
        ))}
      </div>

      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={pending}
          placeholder="Describe your IT issue…"
          className="flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm shadow-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-200 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:focus:ring-blue-900/40"
        />
        <button
          type="submit"
          disabled={pending || input.trim().length === 0}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "Working…" : "Send"}
        </button>
      </form>

      <footer className="mt-3 text-center text-xs text-zinc-400 dark:text-zinc-500">
        Real OpenAI + Chroma RAG · Live MCP tool integration · Mock ticket store. See <code>/api/metrics</code>{" "}
        and <code>/api/health</code>.
      </footer>
    </main>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  return (
    <div className={isUser ? "flex justify-end" : "flex justify-start"}>
      <div
        className={[
          "max-w-[88%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
          isUser
            ? "bg-blue-600 text-white"
            : message.meta?.escalated
              ? "border border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-900/60 dark:bg-amber-900/20 dark:text-amber-100"
              : "border border-zinc-200 bg-zinc-50 text-zinc-900 dark:border-zinc-800 dark:bg-zinc-800/50 dark:text-zinc-100",
        ].join(" ")}
      >
        <div className="whitespace-pre-wrap">{renderContent(message.content)}</div>
        {!isUser && message.meta && (
          <MessageMeta meta={message.meta} />
        )}
      </div>
    </div>
  );
}

function MessageMeta({
  meta,
}: {
  meta: NonNullable<ChatMessage["meta"]>;
}) {
  const items: string[] = [];
  if (meta.intent) items.push(`intent: ${meta.intent}`);
  if (typeof meta.confidence === "number")
    items.push(`confidence: ${(meta.confidence * 100).toFixed(0)}%`);
  if (typeof meta.latencyMs === "number")
    items.push(`${meta.latencyMs} ms`);
  if (meta.escalated) items.push("escalated");
  return (
    <div className="mt-2 space-y-1.5">
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-zinc-500 dark:text-zinc-400">
        {items.map((t) => (
          <span key={t}>{t}</span>
        ))}
        {meta.sources && meta.sources.length > 0 && (
          <span>
            sources: <code>{meta.sources.join(", ")}</code>
          </span>
        )}
      </div>
      {meta.statusTrace && meta.statusTrace.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] text-zinc-400 dark:text-zinc-500">
          {meta.statusTrace.map((e, idx) => (
            <span key={idx} className="flex items-center gap-1.5">
              <span className="text-zinc-300 dark:text-zinc-600">
                {idx === 0 ? "trace:" : "→"}
              </span>
              <span>{e.label.replace(/…$/, "")}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Very small markdown-ish renderer: bold, inline code, line breaks.
 * Avoids pulling in a markdown library for a prototype.
 */
function renderContent(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  const lines = text.split("\n");
  lines.forEach((line, lineIdx) => {
    // Tokenize bold and inline code per line.
    const tokens: React.ReactNode[] = [];
    let remaining = line;
    let key = 0;
    while (remaining.length > 0) {
      const bold = remaining.match(/\*\*(.+?)\*\*/);
      const code = remaining.match(/`([^`]+)`/);

      type NextMatch = { index: number; len: number; node: React.ReactNode };
      let nextMatch: NextMatch | null = null;
      if (bold) {
        nextMatch = {
          index: bold.index ?? 0,
          len: bold[0].length,
          node: (
            <strong key={`b-${lineIdx}-${key++}`} className="font-semibold">
              {bold[1]}
            </strong>
          ),
        };
      }
      if (code && (!nextMatch || (code.index ?? 0) < nextMatch.index)) {
        nextMatch = {
          index: code.index ?? 0,
          len: code[0].length,
          node: (
            <code
              key={`c-${lineIdx}-${key++}`}
              className="rounded bg-zinc-200/80 px-1 py-0.5 text-[0.85em] font-mono dark:bg-zinc-700/60"
            >
              {code[1]}
            </code>
          ),
        };
      }

      if (!nextMatch) {
        tokens.push(remaining);
        break;
      }
      if (nextMatch.index > 0) {
        tokens.push(remaining.slice(0, nextMatch.index));
      }
      tokens.push(nextMatch.node);
      remaining = remaining.slice(nextMatch.index + nextMatch.len);
    }
    parts.push(<span key={`l-${lineIdx}`}>{tokens}</span>);
    if (lineIdx < lines.length - 1) {
      parts.push(<br key={`br-${lineIdx}`} />);
    }
  });
  return parts;
}
