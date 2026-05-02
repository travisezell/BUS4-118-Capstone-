/**
 * MCP-style tool catalog.
 *
 * PRD §9.1 / §10.2: tools are exposed as a typed, standardized
 * interface. The Workflow Agent calls them through `mcpServer` (see
 * `./server.ts`), never directly. This separation means we can swap in
 * a real MCP transport later without touching agent code.
 *
 * Each tool declares:
 *   - name, description (for tool discovery),
 *   - input schema (lightweight runtime validation),
 *   - output schema (for downstream typing),
 *   - handler (the actual implementation).
 */

import {
  createAccessRequest,
  createAccountTicket,
  getTicketStatus,
  updateTicketWithNote,
} from "../data/tickets";
import type { ToolResult } from "../agents/types";

/** Minimal schema validator (we don't take a Zod dependency for the prototype). */
type Schema = Record<string, "string" | "number" | "boolean">;

function validate(input: unknown, schema: Schema): { ok: true } | { ok: false; error: string } {
  if (!input || typeof input !== "object") {
    return { ok: false, error: "Input must be an object." };
  }
  const obj = input as Record<string, unknown>;
  for (const [key, expected] of Object.entries(schema)) {
    if (!(key in obj)) {
      return { ok: false, error: `Missing field: ${key}` };
    }
    if (typeof obj[key] !== expected) {
      return {
        ok: false,
        error: `Field ${key} must be ${expected}, got ${typeof obj[key]}.`,
      };
    }
  }
  return { ok: true };
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
    inputSchema: { app_name: "string", user_id: "string" },
    handler: async (args) => {
      const v = validate(args, { app_name: "string", user_id: "string" });
      if (!v.ok) return { name: "create_access_request", ok: false, error: v.error };
      const result = createAccessRequest(
        args.app_name as string,
        args.user_id as string
      );
      return { name: "create_access_request", ok: true, data: result };
    },
  },
  {
    name: "create_account_ticket",
    description:
      "Open an account-support ticket (lockout, password, MFA, suspected compromise).",
    inputSchema: { user_id: "string", summary: "string" },
    handler: async (args) => {
      const v = validate(args, { user_id: "string", summary: "string" });
      if (!v.ok) return { name: "create_account_ticket", ok: false, error: v.error };
      const result = createAccountTicket(
        args.user_id as string,
        args.summary as string
      );
      return { name: "create_account_ticket", ok: true, data: result };
    },
  },
  {
    name: "get_ticket_status",
    description: "Look up the current state of an existing ticket.",
    inputSchema: { ticket_id: "string" },
    handler: async (args) => {
      const v = validate(args, { ticket_id: "string" });
      if (!v.ok) return { name: "get_ticket_status", ok: false, error: v.error };
      const result = getTicketStatus(args.ticket_id as string);
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
    inputSchema: { ticket_id: "string", note: "string" },
    handler: async (args) => {
      const v = validate(args, { ticket_id: "string", note: "string" });
      if (!v.ok) return { name: "update_ticket_with_note", ok: false, error: v.error };
      const ok = updateTicketWithNote(
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
];
