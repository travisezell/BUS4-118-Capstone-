/**
 * Jira → Ticket adapter.
 *
 * Maps Jira REST API responses to the app's internal `Ticket` interface
 * so the rest of the codebase (MCP tools, API routes) doesn't need to
 * know whether data is coming from Jira or the mock store.
 */

import type { Ticket, TicketState } from "./tickets";
import type { JiraIssue } from "../../infrastructure/lib/jira";
import {
  getIssue,
  createIssue,
  searchIssues,
  listProjectIssues,
  addComment,
  isJiraConfigured,
} from "../../infrastructure/lib/jira";

// ────────────────────────────────────────────────────────────────────
// Status mapping
// ────────────────────────────────────────────────────────────────────

const STATUS_MAP: Record<string, TicketState> = {
  "to do": "open",
  "open": "open",
  "new": "open",
  "in progress": "in_progress",
  "in-progress": "in_progress",
  "waiting for customer": "waiting_on_user",
  "waiting on customer": "waiting_on_user",
  "waiting for support": "waiting_on_approval",
  "pending approval": "waiting_on_approval",
  "waiting for approval": "waiting_on_approval",
  "stale": "stale",
  "resolved": "resolved",
  "done": "closed",
  "closed": "closed",
};

function mapStatus(jiraStatus: string): TicketState {
  return STATUS_MAP[jiraStatus.toLowerCase()] ?? "open";
}

// ────────────────────────────────────────────────────────────────────
// Type mapping
// ────────────────────────────────────────────────────────────────────

function mapIssueType(typeName: string): Ticket["type"] {
  const t = typeName.toLowerCase();
  if (t.includes("access") || t.includes("request") || t.includes("service"))
    return "access";
  if (t.includes("account") || t.includes("password") || t.includes("mfa"))
    return "account";
  return "general";
}

// ────────────────────────────────────────────────────────────────────
// Conversion
// ────────────────────────────────────────────────────────────────────

/**
 * Extract plain text from an Atlassian Document Format (ADF) node, or
 * return the value as-is if it is already a string.
 */
function adfToText(node: unknown): string {
  if (!node) return "";
  if (typeof node === "string") return node;
  if (typeof node !== "object") return String(node);

  type AdfNode = { type?: string; text?: string; content?: AdfNode[] };
  const adf = node as AdfNode;

  if (adf.type === "text" && typeof adf.text === "string") return adf.text;
  if (Array.isArray(adf.content)) {
    return adf.content.map(adfToText).join(" ");
  }
  return "";
}

export function jiraIssueToTicket(issue: JiraIssue): Ticket {
  const f = issue.fields;
  const status = mapStatus(f.status.name);
  const lastUpdate = (f.updated ?? f.created).slice(0, 10);
  const owner = f.assignee?.displayName ?? "Unassigned";

  // Pull comments out for notes
  const notes = (f.comment?.comments ?? []).map(
    (c) => `${c.author.displayName}: ${adfToText(c.body)}`
  );

  // Derive a next_action hint from status
  const nextAction = deriveNextAction(status, f.summary);

  return {
    id: issue.key,
    type: mapIssueType(f.issuetype.name),
    user_id: f.reporter?.emailAddress ?? "unknown",
    app_name: extractAppName(f.summary),
    summary: f.summary,
    state: status,
    owner,
    last_update: lastUpdate,
    next_action: nextAction,
    notes,
  };
}

function deriveNextAction(state: TicketState, summary: string): string {
  switch (state) {
    case "open":
      return "Ticket is open and awaiting assignment.";
    case "in_progress":
      return "An IT agent is actively working on this.";
    case "waiting_on_user":
      return "We need more information from you to proceed.";
    case "waiting_on_approval":
      return "Waiting for manager approval.";
    case "stale":
      return `Ticket has been idle. Add a comment to bump it.`;
    case "resolved":
    case "closed":
      return "No further action — resolved.";
    default:
      return `Issue: ${summary}`;
  }
}

/** Try to pull an app name from summaries like "Access request for Figma". */
function extractAppName(summary: string): string | undefined {
  const m = summary.match(
    /\b(?:access|request)\s+(?:for|to)\s+([A-Za-z0-9_.\-]+)/i
  );
  return m?.[1];
}

// ────────────────────────────────────────────────────────────────────
// Public adapter functions (same signatures as src/data/tickets.ts)
// ────────────────────────────────────────────────────────────────────

export { isJiraConfigured };

export async function jiraGetTicketStatus(ticket_id: string): Promise<{
  state: TicketState;
  owner: string;
  last_update: string;
  next_action: string;
} | null> {
  try {
    const issue = await getIssue(ticket_id);
    const t = jiraIssueToTicket(issue);
    return {
      state: t.state,
      owner: t.owner,
      last_update: t.last_update,
      next_action: t.next_action,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // 404 → ticket not found; surface as null.
    if (msg.includes("404")) return null;
    throw err;
  }
}

export async function jiraCreateAccessRequest(
  app_name: string,
  user_id: string
): Promise<{ request_id: string; status: TicketState }> {
  const result = await createIssue({
    summary: `Access request for ${app_name}`,
    description: `Access request submitted by ${user_id} for ${app_name}.`,
    issuetype: "Task",
  });
  return { request_id: result.key, status: "waiting_on_approval" };
}

export async function jiraCreateAccountTicket(
  user_id: string,
  summary: string
): Promise<{ ticket_id: string; status: TicketState }> {
  const result = await createIssue({
    summary,
    description: `Account support request from ${user_id}. ${summary}`,
    issuetype: "Task",
  });
  return { ticket_id: result.key, status: "open" };
}

export async function jiraSearchTickets(args: {
  email?: string;
  subjectQuery?: string;
}): Promise<Ticket[]> {
  const cfg = { projectKey: process.env.JIRA_PROJECT_KEY ?? "" };

  const clauses: string[] = [`project = ${cfg.projectKey}`];
  if (args.subjectQuery) {
    // Escape double quotes in the query string
    const escaped = args.subjectQuery.replace(/"/g, '\\"');
    clauses.push(`summary ~ "${escaped}"`);
  }
  // Exclude done/closed
  clauses.push('status not in ("Done", "Closed", "Resolved")');

  const jql = clauses.join(" AND ") + " ORDER BY updated DESC";
  const result = await searchIssues(jql, 20);
  return result.issues.map(jiraIssueToTicket);
}

export async function jiraListTickets(maxResults = 50): Promise<Ticket[]> {
  const result = await listProjectIssues(maxResults);
  return result.issues.map(jiraIssueToTicket);
}

export async function jiraUpdateTicketWithNote(
  ticket_id: string,
  note: string
): Promise<boolean> {
  try {
    await addComment(ticket_id, note);
    return true;
  } catch {
    return false;
  }
}
