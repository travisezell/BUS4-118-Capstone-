/**
 * Tool catalog.
 *
 * PRD §9.1 / §10.2: tools are exposed as a typed, standardized
 * interface. The Workflow Agent calls them through `mcpServer` (see
 * `./server.ts`), never directly.
 *
 * The same tool definitions are consumed two ways:
 *
 *   1. The in-process `MCPServer` (this repo's default, used by tests)
 *      validates `inputSchema` and calls `handler` directly.
 *
 *   2. The real Model Context Protocol server (`scripts/mcp-server.ts`)
 *      exposes them over stdio using JSON Schema and `@modelcontextprotocol/sdk`.
 *      The schema is generated from `inputSchema` so we have one source of truth.
 *
 * Each tool declares:
 *   - name, description (for tool discovery),
 *   - inputSchema (typed, runtime-validated),
 *   - handler (the actual implementation).
 */

import {
  createAccessRequest,
  createAccountTicket,
  getTicketStatus,
  searchTickets,
  updateTicketWithNote,
} from "../data/tickets";
import {
  isJiraConfigured,
  jiraGetTicketStatus,
  jiraCreateAccessRequest,
  jiraCreateAccountTicket,
  jiraSearchTickets,
  jiraUpdateTicketWithNote,
} from "../data/jira-adapter";
import type { ToolResult } from "../agents/types";

/**
 * Minimal field type. Extend with more types as needed.
 * The shape stays small on purpose — it converts cleanly to JSON Schema.
 */
export interface FieldDef {
  type: "string" | "number" | "boolean";
  description?: string;
}

export type Schema = Record<string, FieldDef>;

function validate(
  input: unknown,
  schema: Schema
): { ok: true } | { ok: false; error: string } {
  if (!input || typeof input !== "object") {
    return { ok: false, error: "Input must be an object." };
  }
  const obj = input as Record<string, unknown>;
  for (const [key, def] of Object.entries(schema)) {
    if (!(key in obj)) {
      return { ok: false, error: `Missing field: ${key}` };
    }
    if (typeof obj[key] !== def.type) {
      return {
        ok: false,
        error: `Field ${key} must be ${def.type}, got ${typeof obj[key]}.`,
      };
    }
  }
  return { ok: true };
}

/**
 * Convert our internal schema to JSON Schema, which is what the
 * MCP SDK expects for `inputSchema` in tool registration.
 */
export function toJsonSchema(schema: Schema): {
  type: "object";
  properties: Record<string, { type: string; description?: string }>;
  required: string[];
  additionalProperties: false;
} {
  const properties: Record<string, { type: string; description?: string }> = {};
  for (const [key, def] of Object.entries(schema)) {
    properties[key] = { type: def.type };
    if (def.description) properties[key].description = def.description;
  }
  return {
    type: "object",
    properties,
    required: Object.keys(schema),
    additionalProperties: false,
  };
}

export interface Tool {
  name: string;
  description: string;
  inputSchema: Schema;
  /** Run the tool. Implementations should never throw — return ok:false. */
  handler: (args: Record<string, unknown>) => Promise<ToolResult>;
}

export const tools: Tool[] = [
  {
    name: "create_access_request",
    description:
      "Submit a new access request for a tool/app on behalf of a user.",
    inputSchema: {
      app_name: { type: "string", description: "Name of the tool or app, e.g. 'Figma'." },
      user_id: { type: "string", description: "Requesting user identifier (e.g. email)." },
    },
    handler: async (args) => {
      const v = validate(args, {
        app_name: { type: "string" },
        user_id: { type: "string" },
      });
      if (!v.ok)
        return { name: "create_access_request", ok: false, error: v.error };
      const result = isJiraConfigured()
        ? await jiraCreateAccessRequest(
            args.app_name as string,
            args.user_id as string
          )
        : createAccessRequest(args.app_name as string, args.user_id as string);
      return { name: "create_access_request", ok: true, data: result };
    },
  },
  {
    name: "create_account_ticket",
    description:
      "Open an account-support ticket (lockout, password, MFA, suspected compromise).",
    inputSchema: {
      user_id: { type: "string", description: "Affected user identifier." },
      summary: { type: "string", description: "Brief description of the issue." },
    },
    handler: async (args) => {
      const v = validate(args, {
        user_id: { type: "string" },
        summary: { type: "string" },
      });
      if (!v.ok)
        return { name: "create_account_ticket", ok: false, error: v.error };
      const result = isJiraConfigured()
        ? await jiraCreateAccountTicket(
            args.user_id as string,
            args.summary as string
          )
        : createAccountTicket(
            args.user_id as string,
            args.summary as string
          );
      return { name: "create_account_ticket", ok: true, data: result };
    },
  },
  {
    name: "get_ticket_status",
    description: "Look up the current state of an existing ticket.",
    inputSchema: {
      ticket_id: { type: "string", description: "Ticket identifier (INC-... or REQ-...)." },
    },
    handler: async (args) => {
      const v = validate(args, { ticket_id: { type: "string" } });
      if (!v.ok)
        return { name: "get_ticket_status", ok: false, error: v.error };
      const result = isJiraConfigured()
        ? await jiraGetTicketStatus(args.ticket_id as string)
        : getTicketStatus(args.ticket_id as string);
      if (!result) {
        return {
          name: "get_ticket_status",
          ok: false,
          error: `Ticket not found: ${args.ticket_id}`,
        };
      }
      return { name: "get_ticket_status", ok: true, data: result };
    },
  },
  {
    name: "update_ticket_with_note",
    description: "Append a note to an existing ticket.",
    inputSchema: {
      ticket_id: { type: "string", description: "Ticket identifier." },
      note: { type: "string", description: "Free-form note to append." },
    },
    handler: async (args) => {
      const v = validate(args, {
        ticket_id: { type: "string" },
        note: { type: "string" },
      });
      if (!v.ok)
        return { name: "update_ticket_with_note", ok: false, error: v.error };
      const ok = isJiraConfigured()
        ? await jiraUpdateTicketWithNote(
            args.ticket_id as string,
            args.note as string
          )
        : updateTicketWithNote(
            args.ticket_id as string,
            args.note as string
          );
      if (!ok) {
        return {
          name: "update_ticket_with_note",
          ok: false,
          error: `Ticket not found: ${args.ticket_id}`,
        };
      }
      return {
        name: "update_ticket_with_note",
        ok: true,
        data: { ok: true, ticket_id: args.ticket_id },
      };
    },
  },
  {
    name: "search_tickets",
    description:
      "Find a user's open tickets by email and/or subject keyword when no ticket ID is available.",
    inputSchema: {
      email: {
        type: "string",
        description:
          "User email to filter by. Pass an empty string to ignore.",
      },
      subject_query: {
        type: "string",
        description:
          "Substring matched against the ticket summary and app name (e.g. 'Figma', 'VPN'). Pass an empty string to match anything.",
      },
    },
    handler: async (args) => {
      const v = validate(args, {
        email: { type: "string" },
        subject_query: { type: "string" },
      });
      if (!v.ok)
        return { name: "search_tickets", ok: false, error: v.error };
      const results = isJiraConfigured()
        ? await jiraSearchTickets({
            email: (args.email as string) || undefined,
            subjectQuery: (args.subject_query as string) || undefined,
          })
        : searchTickets({
            email: (args.email as string) || undefined,
            subjectQuery: (args.subject_query as string) || undefined,
          });
      return {
        name: "search_tickets",
        ok: true,
        data: {
          count: results.length,
          tickets: results.map((t) => ({
            id: t.id,
            summary: t.summary,
            state: t.state,
            owner: t.owner,
            last_update: t.last_update,
            next_action: t.next_action,
          })),
        },
      };
    },
  },
];
