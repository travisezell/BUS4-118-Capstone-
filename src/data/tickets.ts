/**
 * Mock ticket store.
 *
 * PRD §9.1: tools operate on tickets. We keep a small in-memory store so
 * the four IT tools have something to read and write.
 *
 * Seeded with a handful of tickets so the 12 test scenarios have
 * realistic data to query — including a stale one and a closed one
 * (PRD §14.3 scenarios 3 and 4).
 */

export type TicketState =
  | "open"
  | "in_progress"
  | "waiting_on_user"
  | "waiting_on_approval"
  | "resolved"
  | "closed"
  | "stale";

export interface Ticket {
  id: string;
  type: "access" | "account" | "general";
  user_id: string;
  app_name?: string;
  summary: string;
  state: TicketState;
  owner: string;
  last_update: string; // ISO date string for human-readable output
  next_action: string;
  notes: string[];
}

const tickets: Map<string, Ticket> = new Map();

function isoDaysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

// Seed data — referenced by the 12 test scenarios.
const seed: Ticket[] = [
  {
    id: "INC-1042",
    type: "access",
    user_id: "user@company.com",
    app_name: "Figma",
    summary: "Figma access for the design review",
    state: "waiting_on_approval",
    owner: "Manager Approval Queue",
    last_update: isoDaysAgo(1),
    next_action:
      "Waiting on your manager to approve. Ping them on Slack if it's urgent.",
    notes: [],
  },
  {
    id: "INC-1043",
    type: "general",
    user_id: "user@company.com",
    summary: "Laptop replacement after spill",
    state: "in_progress",
    owner: "Endpoint Engineering",
    last_update: isoDaysAgo(0),
    next_action:
      "A replacement laptop was shipped today. You'll receive tracking info via email.",
    notes: ["Shipped via overnight courier."],
  },
  {
    id: "INC-1044",
    type: "general",
    user_id: "user@company.com",
    summary: "VPN intermittent disconnects",
    state: "waiting_on_user",
    owner: "Networking",
    last_update: isoDaysAgo(2),
    next_action:
      "We need the time and frequency of your last 3 disconnects to reproduce.",
    notes: [],
  },
  // Stale ticket — PRD §14.3 scenario 4.
  {
    id: "INC-0907",
    type: "general",
    user_id: "user@company.com",
    summary: "Request for spare monitor",
    state: "stale",
    owner: "Facilities IT",
    last_update: isoDaysAgo(8),
    next_action:
      "Ticket has been idle for 8 business days. We can bump it with a follow-up note.",
    notes: [],
  },
  // Resolved/closed ticket.
  {
    id: "INC-0850",
    type: "account",
    user_id: "user@company.com",
    summary: "MFA reset after lost phone",
    state: "closed",
    owner: "Identity",
    last_update: isoDaysAgo(14),
    next_action: "No further action — closed.",
    notes: ["MFA was reset after identity verification."],
  },
];

for (const t of seed) tickets.set(t.id, t);

let counter = 2000;
function nextId(prefix: string): string {
  counter += 1;
  return `${prefix}-${counter}`;
}

// ────────────────────────────────────────────────────────────────────
// Tool-backing operations
// ────────────────────────────────────────────────────────────────────

export function createAccessRequest(app_name: string, user_id: string): {
  request_id: string;
  status: TicketState;
} {
  const id = nextId("REQ");
  const ticket: Ticket = {
    id,
    type: "access",
    user_id,
    app_name,
    summary: `Access request for ${app_name}`,
    state: "waiting_on_approval",
    owner: "Manager Approval Queue",
    last_update: new Date().toISOString().slice(0, 10),
    next_action: `Waiting on manager approval for ${app_name} access.`,
    notes: [],
  };
  tickets.set(id, ticket);
  return { request_id: id, status: ticket.state };
}

export function createAccountTicket(user_id: string, summary: string): {
  ticket_id: string;
  status: TicketState;
} {
  const id = nextId("ACC");
  const ticket: Ticket = {
    id,
    type: "account",
    user_id,
    summary,
    state: "open",
    owner: "Identity Help Desk",
    last_update: new Date().toISOString().slice(0, 10),
    next_action: "An IT agent will pick this up shortly.",
    notes: [],
  };
  tickets.set(id, ticket);
  return { ticket_id: id, status: ticket.state };
}

export function getTicketStatus(ticket_id: string): {
  state: TicketState;
  owner: string;
  last_update: string;
  next_action: string;
} | null {
  const t = tickets.get(ticket_id.toUpperCase()) ?? tickets.get(ticket_id);
  if (!t) return null;
  return {
    state: t.state,
    owner: t.owner,
    last_update: t.last_update,
    next_action: t.next_action,
  };
}

export function updateTicketWithNote(ticket_id: string, note: string): boolean {
  const t = tickets.get(ticket_id.toUpperCase()) ?? tickets.get(ticket_id);
  if (!t) return false;
  t.notes.push(note);
  t.last_update = new Date().toISOString().slice(0, 10);
  // A note from the user bumps a waiting_on_user ticket back into the queue.
  if (t.state === "waiting_on_user") t.state = "in_progress";
  return true;
}

export function findOpenAccessRequestForUser(
  user_id: string,
  app_name: string
): Ticket | undefined {
  for (const t of tickets.values()) {
    if (
      t.type === "access" &&
      t.user_id === user_id &&
      t.app_name?.toLowerCase() === app_name.toLowerCase() &&
      t.state !== "closed" &&
      t.state !== "resolved"
    ) {
      return t;
    }
  }
  return undefined;
}

export function listTickets(user_id?: string): Ticket[] {
  const all = [...tickets.values()];
  return user_id ? all.filter((t) => t.user_id === user_id) : all;
}

export function getTicket(id: string): Ticket | undefined {
  return tickets.get(id.toUpperCase()) ?? tickets.get(id);
}
