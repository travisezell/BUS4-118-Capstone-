export interface ToolResultMeta {
  name: string;
  ok: boolean;
  error?: string;
}

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
  last_update: string;
  next_action: string;
  notes: string[];
}
