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
  };
}

const SAMPLE_PROMPTS: { label: string; prompt: string }[] = [
  { label: "Access · Figma", prompt: "How do I get access to Figma?" },
  {
    label: "Account · locked out",
    prompt: "My account is locked, what should I do?",
  },
  { label: "Ticket · status", prompt: "What's the status of ticket INC-1042?" },
  {
    label: "Q&A · password rules",
    prompt: "What are the password requirements?",
  },
];

const WELCOME =
  "Hi — I'm your IT support assistant. I can help with **access requests**, **account lockouts**, and **ticket status**, plus general IT questions like password rules and Wi-Fi setup. Try one of the quick prompts below or just type your request.";

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

    // Show a rolling status while we wait — the orchestrator returns the
    // real list of statusEvents in the response, but we want some
    // movement on screen during the request.
    const stages = [
      "Classifying request…",
      "Searching IT documentation…",
      "Calling tools…",
    ];
    let i = 0;
    setStatusLabel(stages[0]);
    const tick = setInterval(() => {
      i = Math.min(i + 1, stages.length - 1);
      setStatusLabel(stages[i]);
    }, 600);

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
      clearInterval(tick);
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
          },
        },
      ]);
    } catch (err) {
      clearInterval(tick);
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
              Multi-agent · RAG · MCP-style tools · Group 5 BUS 118S
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
        Mock prototype — no real ITSM integration. See <code>/api/metrics</code>{" "}
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
    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-zinc-500 dark:text-zinc-400">
      {items.map((t) => (
        <span key={t}>{t}</span>
      ))}
      {meta.sources && meta.sources.length > 0 && (
        <span>
          sources: <code>{meta.sources.join(", ")}</code>
        </span>
      )}
    </div>
  );
}

/**
 * Very small markdown-ish renderer: bold, inline code, line breaks.
 * Avoids pulling in a markdown library for a prototype.
 */
function renderContent(text: string): React.ReactNode {
  const lines = text.split("\n");
  return lines.map((line, i) => (
    <span key={i}>
      {renderInline(line)}
      {i < lines.length - 1 && <br />}
    </span>
  ));
}

function renderInline(text: string): React.ReactNode {
  // Replace **bold** and `code`
  const parts: React.ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    const token = match[0];
    if (token.startsWith("**")) {
      parts.push(<strong key={`b${key++}`}>{token.slice(2, -2)}</strong>);
    } else {
      parts.push(
        <code
          key={`c${key++}`}
          className="rounded bg-zinc-200 px-1 py-0.5 text-[12px] dark:bg-zinc-700"
        >
          {token.slice(1, -1)}
        </code>
      );
    }
    lastIndex = match.index + token.length;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts;
}
