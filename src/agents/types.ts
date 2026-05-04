/**
 * Shared types for the multi-agent IT support pipeline.
 *
 * These types follow the PRD §7.3 "State Object" — every node of the
 * orchestrator reads and writes a single `AgentState` instance.
 */

export type Intent =
  | "access_help"
  | "account_help"
  | "ticket_status"
  | "general_qa"
  | "greeting"
  | "out_of_scope"
  | "unknown";

export interface Entities {
  toolName?: string;
  accountId?: string;
  ticketId?: string;
  cause?: string;
  /**
   * Set when the user's intent is recognizable in shape but missing the
   * detail needed to act. e.g. "I need a new ticket" — we know they want
   * to create something but don't know what category. The Escalation
   * Agent uses this to build a friendlier "could you tell me more?"
   * message instead of a generic "low confidence" handoff.
   */
  clarificationNeeded?: string;
}

export interface Message {
  role: "user" | "assistant";
  content: string;
}

export interface RetrievedChunk {
  id: string;
  source: string;
  content: string;
  score: number;
}

export interface ToolCall {
  name: string;
  args: Record<string, unknown>;
}

export interface ToolResult {
  name: string;
  ok: boolean;
  data?: Record<string, unknown>;
  error?: string;
}

export type StatusEventKind =
  | "classifying"
  | "searching_docs"
  | "calling_tool"
  | "submitting_request"
  | "checking_ticket"
  | "escalating"
  | "responding";

export interface StatusEvent {
  kind: StatusEventKind;
  label: string;
  at: number; // epoch ms
}

export interface AgentState {
  // Inputs
  userMessage: string;
  conversationHistory: Message[];

  // Intake
  intent?: Intent;
  entities?: Entities;
  confidence?: number;

  // Knowledge
  retrievedChunks?: RetrievedChunk[];
  groundedAnswer?: string;
  retrievalHit?: boolean;

  // Workflow
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];

  // Escalation
  escalationFlag?: boolean;
  escalationReason?: string;
  escalationSummary?: string;

  // Final response
  finalAnswer?: string;
  statusEvents: StatusEvent[];

  // Telemetry
  startedAt: number;
  finishedAt?: number;
}

export interface ChatResponse {
  answer: string;
  intent: Intent;
  entities: Entities;
  confidence: number;
  retrievedSources: string[];
  toolResults: ToolResult[];
  escalated: boolean;
  escalationReason?: string;
  statusEvents: StatusEvent[];
  latencyMs: number;
}
