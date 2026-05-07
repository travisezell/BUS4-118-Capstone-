"use client";

import { useEffect, useRef, useState } from "react";

type Role = "user" | "assistant";

interface ToolResultMeta {
  name: string;
  ok: boolean;
  error?: string;
}

interface ChatMessage {
  id?: string;
  role: Role;
  content: string;
  meta?: {
    intent?: string;
    confidence?: number;
    sources?: string[];
    toolResults?: ToolResultMeta[];
    escalated?: boolean;
    escalationReason?: string;
    latencyMs?: number;
    statusTrace?: { kind: string; label: string }[];
  };
}

// Mirror of the StreamEvent union exported by the orchestrator.
type StreamEvent =
  | { kind: "status"; label: string; stage: string; node: string }
  | {
      kind: "intent";
      intent: string;
      confidence: number;
      entities: Record<string, unknown>;
    }
  | { kind: "sources"; sources: string[] }
  | { kind: "tools"; toolResults: ToolResultMeta[] }
  | { kind: "answer_chunk"; text: string }
  | {
      kind: "done";
      final: {
        answer: string;
        intent: string;
        confidence: number;
        retrievedSources: string[];
        toolResults: ToolResultMeta[];
        escalated: boolean;
        escalationReason?: string;
        latencyMs: number;
      };
    }
  | { kind: "error"; message: string };

const SAMPLE_PROMPTS: { label: string; prompt: string }[] = [
  { label: "🔑 Access · Figma", prompt: "I need access to Figma for the design review" },
  { label: "🔒 Account · locked out", prompt: "I'm locked out of my account" },
  { label: "🎫 Ticket · status", prompt: "what's the status of that?" },
  { label: "❓ Q&A · passwords", prompt: "What are the password requirements?" },
];

const WELCOME =
  "Hi — I'm your IT support assistant. I can help with **access requests**, **account lockouts**, and **ticket status**, plus general IT questions. Try a quick prompt below or just type your question.";

// ─────────────────────────────────────────────────────────────────────
// Live status stepper
// ─────────────────────────────────────────────────────────────────────

interface Stage {
  label: string;
  ms: number;
}

const STAGE_INTAKE: Stage = { label: "Classifying request…", ms: 250 };
const STAGE_KNOWLEDGE: Stage = { label: "Searching IT documentation…", ms: 900 };
const STAGE_WORKFLOW_ACCESS: Stage = { label: "Submitting access request…", ms: 700 };
const STAGE_WORKFLOW_ACCOUNT: Stage = { label: "Checking account recovery options…", ms: 700 };
const STAGE_WORKFLOW_TICKET: Stage = { label: "Looking up ticket status…", ms: 600 };
const STAGE_RESPOND: Stage = { label: "Composing response…", ms: 400 };

function predictStages(message: string): Stage[] {
  const m = message.toLowerCase();
  const trimmed = message.trim();

  if (
    /^(?:hi|hello|hey|yo|sup|hiya|howdy|good\s*(?:morning|afternoon|evening)|thanks?|thank\s*you|ok|okay|cool|test|\??)\s*[!.?]*\s*$/i.test(trimmed) ||
    /\bwhat (?:can|do) you (?:do|help)\b/.test(m) ||
    /\bwho are you\b/.test(m)
  ) {
    return [STAGE_INTAKE, STAGE_RESPOND];
  }

  // Match explicit ticket IDs: INC-/REQ-/ACC- (mock store) or B1GC- (Jira project key).
  if (/\b(?:inc|req|acc|b1gc)-\d+\b/i.test(message) || /\b(?:status|ticket|update)\b/.test(m)) {
    return [STAGE_INTAKE, STAGE_WORKFLOW_TICKET, STAGE_RESPOND];
  }

  if (/\b(?:access|account.*to|provision|figma|slack|jira|github|notion|want to use|set me up)\b/.test(m)) {
    return [STAGE_INTAKE, STAGE_KNOWLEDGE, STAGE_WORKFLOW_ACCESS, STAGE_RESPOND];
  }

  if (/\b(?:locked|lockout|password|sign[- ]?in|mfa|2fa|compromised|hacked|my account|can't log)\b/.test(m)) {
    return [STAGE_INTAKE, STAGE_KNOWLEDGE, STAGE_WORKFLOW_ACCOUNT, STAGE_RESPOND];
  }

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

    const predicted = predictStages(userText);
    setStatusLabel(predicted[0].label);

    const placeholderId = `pending-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setMessages((prev) => [
      ...prev,
      { id: placeholderId, role: "assistant", content: "", meta: { statusTrace: [] } },
    ]);

    try {
      const history = messages
        .filter((m) => m.role !== "assistant" || m.content !== WELCOME)
        .map((m) => ({ role: m.role, content: m.content }));

      const res = await fetch("/api/chat?stream=1", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: userText, history }),
      });

      if (!res.ok || !res.body) {
        const errBody = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(errBody.error ?? `HTTP ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      const collectedTrace: { kind: string; label: string }[] = [];
      let answerText = "";
      let partialMeta: ChatMessage["meta"] = { statusTrace: [] };

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let nlIdx;
        while ((nlIdx = buffer.indexOf("\n\n")) !== -1) {
          const rawEvent = buffer.slice(0, nlIdx);
          buffer = buffer.slice(nlIdx + 2);
          if (!rawEvent.startsWith("data: ")) continue;

          let event: StreamEvent;
          try {
            event = JSON.parse(rawEvent.slice(6)) as StreamEvent;
          } catch {
            continue;
          }

          if (event.kind === "status") {
            setStatusLabel(event.label);
            collectedTrace.push({ kind: event.stage, label: event.label });
          } else if (event.kind === "answer_chunk") {
            answerText += event.text;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === placeholderId ? { ...m, content: answerText } : m
              )
            );
          } else if (event.kind === "intent") {
            partialMeta = { ...partialMeta, intent: event.intent, confidence: event.confidence };
          } else if (event.kind === "sources") {
            partialMeta = { ...partialMeta, sources: event.sources };
          } else if (event.kind === "tools") {
            partialMeta = { ...partialMeta, toolResults: event.toolResults };
          } else if (event.kind === "done") {
            partialMeta = {
              intent: event.final.intent,
              confidence: event.final.confidence,
              sources: event.final.retrievedSources,
              toolResults: event.final.toolResults,
              escalated: event.final.escalated,
              escalationReason: event.final.escalationReason,
              latencyMs: event.final.latencyMs,
              statusTrace: collectedTrace,
            };
            answerText = event.final.answer;
          } else if (event.kind === "error") {
            throw new Error(event.message);
          }
        }
      }

      setStatusLabel(null);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === placeholderId
            ? { ...m, content: answerText, meta: partialMeta }
            : m
        )
      );
    } catch (err) {
      setStatusLabel(null);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === placeholderId
            ? {
                ...m,
                content: `Sorry — I couldn't reach the server. (${
                  err instanceof Error ? err.message : "unknown error"
                })`,
              }
            : m
        )
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-[calc(100vh-3.5rem)] w-full max-w-3xl flex-col px-4 py-6 sm:py-8">
      {/* Sample prompts — above the chat window for prominence */}
      <div className="mb-3">
        <p className="mb-2 text-xs font-medium text-zinc-500 dark:text-zinc-400">
          Quick start — pick a scenario:
        </p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {SAMPLE_PROMPTS.map((p) => (
            <button
              key={p.label}
              type="button"
              disabled={pending}
              onClick={() => send(p.prompt)}
              className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-left text-xs text-zinc-700 transition hover:border-blue-400 hover:bg-blue-50 hover:text-blue-700 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:border-blue-500 dark:hover:bg-blue-900/20 dark:hover:text-blue-300"
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Chat scroll area */}
      <section
        ref={scrollRef}
        className="flex-1 space-y-4 overflow-y-auto rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
        style={{ minHeight: 380 }}
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

      {/* Input */}
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
        LangGraph · RAG · Live MCP + Jira integration · Mock ticket store fallback. See{" "}
        <code>/api/metrics</code> and <code>/api/health</code>.
      </footer>
    </main>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  const escalated = !isUser && message.meta?.escalated;
  return (
    <div className={isUser ? "flex justify-end" : "flex justify-start"}>
      <div
        className={[
          "max-w-[88%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
          isUser
            ? "bg-blue-600 text-white"
            : escalated
              ? "border border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-900/60 dark:bg-amber-900/20 dark:text-amber-100"
              : "border border-zinc-200 bg-zinc-50 text-zinc-900 dark:border-zinc-800 dark:bg-zinc-800/50 dark:text-zinc-100",
        ].join(" ")}
      >
        {/* Escalation badge */}
        {escalated && (
          <div className="mb-2 flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-100 px-2.5 py-1.5 text-xs font-semibold text-amber-800 dark:border-amber-700 dark:bg-amber-900/40 dark:text-amber-200">
            <span>🔴</span>
            <span>Escalated to human IT</span>
            {message.meta?.escalationReason && (
              <span className="ml-1 font-normal text-amber-700 dark:text-amber-300">
                — {message.meta.escalationReason}
              </span>
            )}
          </div>
        )}
        <div>{renderContent(message.content)}</div>
        {!isUser && message.meta && <MessageMeta meta={message.meta} />}
      </div>
    </div>
  );
}

function MessageMeta({ meta }: { meta: NonNullable<ChatMessage["meta"]> }) {
  const items: string[] = [];
  if (meta.intent) items.push(`intent: ${meta.intent}`);
  if (typeof meta.confidence === "number")
    items.push(`confidence: ${(meta.confidence * 100).toFixed(0)}%`);
  if (typeof meta.latencyMs === "number") items.push(`${meta.latencyMs} ms`);

  return (
    <div className="mt-2 space-y-1.5">
      {/* Tool call results */}
      {meta.toolResults && meta.toolResults.length > 0 && (
        <div className="flex flex-wrap gap-x-2 gap-y-1">
          {meta.toolResults.map((r, i) => (
            <span
              key={i}
              className={[
                "inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[10px]",
                r.ok
                  ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300"
                  : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
              ].join(" ")}
            >
              <span>tool:</span>
              <code>{r.name}</code>
              <span>{r.ok ? "✓" : "✗"}</span>
            </span>
          ))}
        </div>
      )}

      {/* Metadata row */}
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

      {/* Status trace */}
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
 * Markdown-ish renderer: bold, inline code, bullet lists, line breaks.
 */
function renderContent(text: string): React.ReactNode {
  const lines = text.split("\n");
  const parts: React.ReactNode[] = [];
  let listItems: React.ReactNode[] = [];
  let lineIdx = 0;

  function flushList() {
    if (listItems.length > 0) {
      parts.push(
        <ul key={`ul-${lineIdx}`} className="my-1 ml-4 list-disc space-y-0.5">
          {listItems}
        </ul>
      );
      listItems = [];
    }
  }

  for (const line of lines) {
    const isBullet = /^[-*]\s+/.test(line);
    if (isBullet) {
      listItems.push(
        <li key={`li-${lineIdx}`}>{inlineTokens(line.replace(/^[-*]\s+/, ""), lineIdx)}</li>
      );
    } else {
      flushList();
      if (line.trim() === "") {
        parts.push(<br key={`br-${lineIdx}`} />);
      } else {
        parts.push(
          <span key={`l-${lineIdx}`} className="block">
            {inlineTokens(line, lineIdx)}
          </span>
        );
      }
    }
    lineIdx++;
  }
  flushList();
  return parts;
}

/** Tokenize bold and inline code within a single line. */
function inlineTokens(line: string, lineIdx: number): React.ReactNode[] {
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
    if (nextMatch.index > 0) tokens.push(remaining.slice(0, nextMatch.index));
    tokens.push(nextMatch.node);
    remaining = remaining.slice(nextMatch.index + nextMatch.len);
  }
  return tokens;
}
