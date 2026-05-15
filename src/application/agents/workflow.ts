/**
 * Workflow Agent
 *
 * PRD §7.1 / §9: decides which tool to call and calls it through the
 * MCP-style tool server. Tools are wrapped in try/catch; failures are
 * surfaced to the Escalation Agent rather than shown raw to the user.
 */

import { mcpServer } from "../../infrastructure/mcp/server";
import type { AgentState, ToolCall, ToolResult } from "./types";

interface WorkflowResult {
  toolCalls: ToolCall[];
  toolResults: ToolResult[];
  needsEscalation: boolean;
  /** Reason to surface to the Escalation Agent; matches its `decide()` API. */
  reason?: string;
}

/** Default user identifier when none is extracted (prototype only). */
const DEFAULT_USER_ID = "user@company.com";

export async function run(state: AgentState): Promise<WorkflowResult> {
  const calls: ToolCall[] = [];
  const results: ToolResult[] = [];

  if (!state.intent) {
    return { toolCalls: [], toolResults: [], needsEscalation: false };
  }

  switch (state.intent) {
    case "access_help": {
      const toolName = state.entities?.toolName;
      const userId = state.entities?.accountId ?? DEFAULT_USER_ID;

      if (!toolName) {
        // Intake didn't extract a tool name — kick to escalation rather
        // than fire a useless tool call.
        return {
          toolCalls: [],
          toolResults: [],
          needsEscalation: true,
          reason: "No tool/app name was provided in the request.",
        };
      }

      // Duplicate-request guard — PRD §14.1 scenario 4.
      // Query through MCP so it routes to Jira when configured, mock otherwise.
      const dupSearchCall: ToolCall = {
        name: "search_tickets",
        args: { email: userId, subject_query: toolName },
      };
      const dupSearchResult = await mcpServer.call(
        dupSearchCall.name,
        dupSearchCall.args
      );
      const dupData = dupSearchResult.data as
        | {
            count: number;
            tickets: Array<{ id: string; state: string; summary: string }>;
          }
        | undefined;
      const existing = dupData?.tickets?.find((t) => {
        // Match if the ticket summary contains the tool name (case-insensitive)
        // and the ticket isn't closed/resolved.
        const summary = (t.summary ?? "").toLowerCase();
        const tool = toolName.toLowerCase();
        const isOpen = !["closed", "resolved", "done"].includes(
          (t.state ?? "").toLowerCase()
        );
        return isOpen && summary.includes(tool);
      });
      if (existing) {
        const dupResult: ToolResult = {
          name: "create_access_request",
          ok: true,
          data: {
            duplicate: true,
            request_id: existing.id,
            status: existing.state,
            note: "An open access request for this tool already exists.",
          },
        };
        return {
          toolCalls: [
            dupSearchCall,
            {
              name: "create_access_request",
              args: { app_name: toolName, user_id: userId },
            },
          ],
          toolResults: [dupSearchResult, dupResult],
          needsEscalation: false,
        };
      }

      const call: ToolCall = {
        name: "create_access_request",
        args: { app_name: toolName, user_id: userId },
      };
      calls.push(call);
      results.push(await mcpServer.call(call.name, call.args));
      break;
    }

    case "account_help": {
      const userId = state.entities?.accountId ?? DEFAULT_USER_ID;
      const cause = state.entities?.cause ?? "unspecified";

      // Risky cases (suspected compromise) skip self-service and go
      // straight to a ticket + escalation.
      if (cause === "suspected_compromise") {
        const summary = `Suspected account compromise reported by ${userId}. Original message: "${state.userMessage}"`;
        const call: ToolCall = {
          name: "create_account_ticket",
          args: { user_id: userId, summary },
        };
        calls.push(call);
        results.push(await mcpServer.call(call.name, call.args));

        return {
          toolCalls: calls,
          toolResults: results,
          needsEscalation: true,
          reason:
            "Suspected compromise — flagged as high priority for security review.",
        };
      }

      // Standard lockout/password flows resolve via the documented
      // self-service steps from the Knowledge Agent. The Workflow Agent
      // only opens a ticket if the user has explicitly asked for one
      // (e.g. "skip self-service" scenario, PRD §14.2 scenario 2).
      const wantsTicketNow = /\b(open|create|file|skip).*ticket\b/i.test(
        state.userMessage
      );
      if (wantsTicketNow) {
        const summary = `Account help requested. Cause: ${cause}. Original message: "${state.userMessage}"`;
        const call: ToolCall = {
          name: "create_account_ticket",
          args: { user_id: userId, summary },
        };
        calls.push(call);
        results.push(await mcpServer.call(call.name, call.args));
      }
      // Otherwise no tool call — the Knowledge Agent's grounded answer
      // contains the recovery steps and the user can self-serve.
      break;
    }

    case "ticket_status": {
      const ticketId = state.entities?.ticketId;
      if (!ticketId) {
        // No ticket ID — try a lookup by email and/or subject keyword
        // before giving up. This handles requests like "any update on
        // my Figma ticket?" or "where's my VPN request?" where the user
        // has identifiers other than an ID.
        const email = state.entities?.accountId;
        const subjectQuery = extractSubjectQuery(state.userMessage);
        if (email || subjectQuery) {
          const call: ToolCall = {
            name: "search_tickets",
            args: {
              email: email ?? "",
              subject_query: subjectQuery ?? "",
            },
          };
          calls.push(call);
          const result = await mcpServer.call(call.name, call.args);
          results.push(result);

          const data = result.data as
            | { count: number; tickets: unknown[] }
            | undefined;
          if (result.ok && data && data.count > 0) {
            // Found something — let the orchestrator format it.
            break;
          }
        }
        return {
          toolCalls: calls,
          toolResults: results,
          needsEscalation: true,
          reason: "No ticket ID was provided.",
        };
      }
      const call: ToolCall = {
        name: "get_ticket_status",
        args: { ticket_id: ticketId },
      };
      calls.push(call);
      const result = await mcpServer.call(call.name, call.args);
      results.push(result);

      if (!result.ok) {
        return {
          toolCalls: calls,
          toolResults: results,
          needsEscalation: true,
          reason: `Ticket ${ticketId} could not be found.`,
        };
      }
      break;
    }

    case "general_qa":
    case "unknown":
    default:
      // No tool calls; Knowledge or Escalation handles these.
      break;
  }

  return { toolCalls: calls, toolResults: results, needsEscalation: false };
}

/**
 * Extract a likely subject keyword from messages like
 *   "any update on my Figma ticket"
 *   "where's my VPN request"
 *   "what's happening with my access request"
 *
 * Returns the keyword (lowercase) or undefined if nothing salient is found.
 * This is intentionally simple: a small list of high-value subject words
 * that appear in our seeded tickets (Figma, VPN, laptop, monitor) plus
 * generic "access" and "ticket" we already match elsewhere.
 */
function extractSubjectQuery(message: string): string | undefined {
  const m = message.toLowerCase();
  const subjects = [
    "figma",
    "slack",
    "jira",
    "github",
    "notion",
    "salesforce",
    "vpn",
    "laptop",
    "monitor",
    "wifi",
    "wi-fi",
    "mfa",
    "password",
  ];
  for (const s of subjects) {
    if (m.includes(s)) return s;
  }
  return undefined;
}
