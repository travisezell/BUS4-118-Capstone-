"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";

// ─── Types ────────────────────────────────────────────────────────────

import type { Ticket, TicketState } from "@/app/types/support";

type FilterTab = "all" | "open" | "waiting" | "closed";

// ─── Helpers ──────────────────────────────────────────────────────────

const STATE_BADGE: Record<
  TicketState,
  { label: string; className: string }
> = {
  open: { label: "Open", className: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" },
  in_progress: { label: "In Progress", className: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300" },
  waiting_on_user: { label: "Waiting on You", className: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300" },
  waiting_on_approval: { label: "Pending Approval", className: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300" },
  stale: { label: "Stale", className: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300" },
  resolved: { label: "Resolved", className: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300" },
  closed: { label: "Closed", className: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400" },
};

function StateBadge({ state }: { state: TicketState }) {
  const b = STATE_BADGE[state] ?? STATE_BADGE["open"];
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${b.className}`}>
      {b.label}
    </span>
  );
}

function matchesFilter(ticket: Ticket, tab: FilterTab): boolean {
  if (tab === "all") return true;
  if (tab === "open") return ticket.state === "open" || ticket.state === "in_progress" || ticket.state === "stale";
  if (tab === "waiting") return ticket.state === "waiting_on_user" || ticket.state === "waiting_on_approval";
  if (tab === "closed") return ticket.state === "closed" || ticket.state === "resolved";
  return true;
}

// ─── Main page ────────────────────────────────────────────────────────

export default function TicketsPage() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterTab>("all");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Auto-refresh every 30 s, paused when tab is hidden.
  const loadTickets = useCallback(async () => {
    try {
      const res = await fetch("/api/tickets");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { tickets: Ticket[] };
      setTickets(data.tickets ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load tickets");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const bootstrapId = setTimeout(() => {
      void loadTickets();
    }, 0);

    const id = setInterval(() => {
      if (!document.hidden) {
        void loadTickets();
      }
    }, 30_000);

    return () => {
      clearTimeout(bootstrapId);
      clearInterval(id);
    };
  }, [loadTickets]);

  const filtered = tickets.filter(
    (t) =>
      matchesFilter(t, filter) &&
      (search.trim() === "" ||
        t.summary.toLowerCase().includes(search.toLowerCase()) ||
        t.id.toLowerCase().includes(search.toLowerCase()))
  );

  const selected = tickets.find((t) => t.id === selectedId) ?? null;

  const TABS: { key: FilterTab; label: string }[] = [
    { key: "all", label: "All" },
    { key: "open", label: "Active" },
    { key: "waiting", label: "Waiting" },
    { key: "closed", label: "Closed" },
  ];

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:py-10">
      {/* Page header */}
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">My Tickets</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            All support tickets in this project — refreshes every 30 s
          </p>
        </div>
        <Link
          href="/"
          className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-700 transition hover:border-blue-400 hover:text-blue-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:border-blue-500 dark:hover:text-blue-300"
        >
          ← Chat
        </Link>
      </div>

      {/* Filter bar + search */}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-2">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setFilter(tab.key)}
              className={[
                "rounded-full px-3 py-1 text-xs font-medium transition",
                filter === tab.key
                  ? "bg-blue-600 text-white"
                  : "border border-zinc-200 bg-white text-zinc-600 hover:border-blue-400 hover:text-blue-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400",
              ].join(" ")}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by ID or summary…"
          className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm shadow-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-200 dark:border-zinc-700 dark:bg-zinc-900 dark:focus:ring-blue-900/40 sm:w-64"
        />
      </div>

      {/* Main content */}
      {loading ? (
        <div className="flex items-center gap-2 py-16 text-sm text-zinc-500">
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-blue-500" />
          Loading tickets…
        </div>
      ) : error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-900/20 dark:text-red-300">
          {error}
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-16 text-center text-sm text-zinc-400">
          No tickets match the current filter.
        </div>
      ) : (
        <div className="relative flex gap-4">
          {/* Ticket table */}
          <div className={["flex-1 overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900", selected ? "hidden sm:block" : ""].join(" ")}>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-100 bg-zinc-50 text-left text-xs font-medium text-zinc-500 dark:border-zinc-800 dark:bg-zinc-800/50 dark:text-zinc-400">
                  <th className="px-4 py-3">ID</th>
                  <th className="px-4 py-3">Summary</th>
                  <th className="hidden px-4 py-3 sm:table-cell">Status</th>
                  <th className="hidden px-4 py-3 md:table-cell">Owner</th>
                  <th className="hidden px-4 py-3 lg:table-cell">Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {filtered.map((t) => (
                  <tr
                    key={t.id}
                    onClick={() => setSelectedId(t.id === selectedId ? null : t.id)}
                    className={[
                      "cursor-pointer transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/50",
                      t.id === selectedId
                        ? "bg-blue-50 dark:bg-blue-900/10"
                        : "",
                    ].join(" ")}
                  >
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-zinc-700 dark:text-zinc-300">
                      {t.id}
                    </td>
                    <td className="px-4 py-3 text-zinc-900 dark:text-zinc-100">
                      <div className="line-clamp-2">{t.summary}</div>
                      <div className="mt-1 sm:hidden">
                        <StateBadge state={t.state} />
                      </div>
                    </td>
                    <td className="hidden whitespace-nowrap px-4 py-3 sm:table-cell">
                      <StateBadge state={t.state} />
                    </td>
                    <td className="hidden px-4 py-3 text-zinc-500 md:table-cell dark:text-zinc-400">
                      {t.owner}
                    </td>
                    <td className="hidden whitespace-nowrap px-4 py-3 text-zinc-500 lg:table-cell dark:text-zinc-400">
                      {t.last_update}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Detail panel */}
          {selected && (
            <TicketDetail
              ticket={selected}
              onClose={() => setSelectedId(null)}
              onNoteAdded={loadTickets}
            />
          )}
        </div>
      )}
    </div>
  );
}

// ─── Ticket detail panel ──────────────────────────────────────────────

function TicketDetail({
  ticket,
  onClose,
  onNoteAdded,
}: {
  ticket: Ticket;
  onClose: () => void;
  onNoteAdded: () => void;
}) {
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  async function addNote() {
    const trimmed = note.trim();
    if (!trimmed) return;
    setSaving(true);
    setNoteError(null);
    try {
      const res = await fetch(`/api/tickets/${ticket.id}/note`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: trimmed }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setNote("");
      onNoteAdded();
    } catch (err) {
      setNoteError(err instanceof Error ? err.message : "Failed to save note");
    } finally {
      setSaving(false);
    }
  }

  return (
    <aside className="w-full sm:w-80 md:w-96 flex-shrink-0 rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 overflow-hidden flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-100 bg-zinc-50 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-800/50">
        <div>
          <span className="font-mono text-xs font-semibold text-zinc-700 dark:text-zinc-300">
            {ticket.id}
          </span>
          <div className="mt-0.5">
            <StateBadge state={ticket.state} />
          </div>
        </div>
        <button
          onClick={onClose}
          className="rounded p-1 text-zinc-400 transition hover:bg-zinc-200 hover:text-zinc-700 dark:hover:bg-zinc-700 dark:hover:text-zinc-200"
          aria-label="Close"
        >
          ✕
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 text-sm">
        <div>
          <p className="font-medium text-zinc-900 dark:text-zinc-100">
            {ticket.summary}
          </p>
          {ticket.app_name && (
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              App: <span className="font-medium">{ticket.app_name}</span>
            </p>
          )}
        </div>

        <dl className="space-y-2 text-xs text-zinc-600 dark:text-zinc-400">
          <div className="flex gap-2">
            <dt className="w-24 shrink-0 font-medium text-zinc-500">Owner</dt>
            <dd>{ticket.owner}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-24 shrink-0 font-medium text-zinc-500">Last updated</dt>
            <dd>{ticket.last_update}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-24 shrink-0 font-medium text-zinc-500">Next step</dt>
            <dd>{ticket.next_action}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-24 shrink-0 font-medium text-zinc-500">Reporter</dt>
            <dd className="break-all">{ticket.user_id}</dd>
          </div>
        </dl>

        {/* Notes */}
        {ticket.notes.length > 0 && (
          <div>
            <h3 className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 mb-2 uppercase tracking-wide">
              Notes
            </h3>
            <ul className="space-y-2">
              {ticket.notes.map((n, i) => (
                <li
                  key={i}
                  className="rounded-lg bg-zinc-50 px-3 py-2 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                >
                  {n}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Add note */}
      <div className="border-t border-zinc-100 dark:border-zinc-800 p-3 space-y-2">
        <textarea
          ref={textareaRef}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          placeholder="Add a note…"
          className="w-full resize-none rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-200 dark:border-zinc-700 dark:bg-zinc-900 dark:focus:ring-blue-900/40"
        />
        {noteError && (
          <p className="text-xs text-red-600 dark:text-red-400">{noteError}</p>
        )}
        <button
          onClick={addNote}
          disabled={saving || note.trim().length === 0}
          className="w-full rounded-lg bg-blue-600 py-1.5 text-xs font-medium text-white transition hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Add note"}
        </button>
      </div>
    </aside>
  );
}
