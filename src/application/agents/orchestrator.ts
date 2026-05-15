/**
 * Orchestrator — LangGraph StateGraph
 *
 * PRD §7 requires a state graph that routes a user message through
 * four agents:
 *
 *   Intake  →  Knowledge  →  Workflow  →  Escalation  →  User
 *
 * This module wires those agents into a real `@langchain/langgraph`
 * `StateGraph`. The agents themselves (`intake.ts`, `knowledge.ts`,
 * `workflow.ts`, `escalation.ts`) are unchanged — they remain pure
 * functions over `AgentState`. The graph just orchestrates them.
 *
 * Why LangGraph?
 *  - Conditional edges express the routing rules (intent / confidence)
 *    declaratively, instead of buried inside `if`/`else`.
 *  - Standard idiom that other LangChain tooling (LangSmith, the
 *    LangGraph Studio visualizer) can introspect.
 *  - Each node's I/O is explicit, which makes the agents easier to
 *    swap or test independently.
 *
 * Edge layout:
 *
 *      START
 *        │
 *        ▼
 *      intake
 *        │
 *        ├─[ ticket_status ]──────────────────► workflow
 *        ├─[ unknown / very low confidence ]──► escalation
 *        └─[ access_help / account_help / general_qa ]──► knowledge
 *                                                            │
 *                                                            ▼
 *                                                         workflow
 *                                                            │
 *                                                            ▼
 *                                                       (decide
 *                                                       escalation)
 *                                                            │
 *                                       ┌────────────────────┴───────────────┐
 *                                       │                                    │
 *                                       ▼                                    ▼
 *                                  escalation                            respond
 *                                       │                                    │
 *                                       └────────────► END ◄─────────────────┘
 */

import { END, START, StateGraph, Annotation } from "@langchain/langgraph";

import { logRequest } from "../../infrastructure/lib/metrics";
import { decide as decideEscalation } from "./escalation";
import { classify } from "./intake";
import { retrieve } from "./knowledge";
import type {
  AgentState,
  ChatResponse,
  Entities,
  Intent,
  Message,
  RetrievedChunk,
  StatusEvent,
  ToolCall,
  ToolResult,
} from "./types";
import { run as runWorkflow } from "./workflow";

// ──────────────────────────────────────────────────────────────────────
// Graph state schema
//
// `Annotation` defines the shape and reducer for each field. For most
// fields the reducer is "last write wins" — except `statusEvents`,
// which we accumulate so the UI can show progress.
// ──────────────────────────────────────────────────────────────────────

const GraphState = Annotation.Root({
  // Inputs
  userMessage: Annotation<string>,
  conversationHistory: Annotation<Message[]>({
    reducer: (_prev, next) => next,
    default: () => [],
  }),

  // Intake outputs
  intent: Annotation<Intent | undefined>,
  entities: Annotation<Entities | undefined>,
  confidence: Annotation<number | undefined>,

  // Knowledge outputs
  retrievedChunks: Annotation<RetrievedChunk[] | undefined>,
  groundedAnswer: Annotation<string | undefined>,
  retrievalHit: Annotation<boolean | undefined>,

  // Workflow outputs
  toolCalls: Annotation<ToolCall[] | undefined>,
  toolResults: Annotation<ToolResult[] | undefined>,
  workflowFlag: Annotation<{ needsEscalation: boolean; reason?: string } | undefined>,

  // Escalation outputs
  escalationFlag: Annotation<boolean | undefined>,
  escalationReason: Annotation<string | undefined>,
  escalationSummary: Annotation<string | undefined>,

  // Final
  finalAnswer: Annotation<string | undefined>,

  // Trace
  statusEvents: Annotation<StatusEvent[]>({
    reducer: (prev, next) => [...(prev ?? []), ...(next ?? [])],
    default: () => [],
  }),
  startedAt: Annotation<number>,
  finishedAt: Annotation<number | undefined>,
});

type GraphStateType = typeof GraphState.State;
type GraphUpdate = Partial<GraphStateType>;

// ──────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────

function statusEvent(kind: StatusEvent["kind"], label: string): StatusEvent {
  return { kind, label, at: Date.now() };
}

/** Convert a graph state slice to the `AgentState` the agent helpers expect. */
function toAgentState(s: GraphStateType): AgentState {
  return {
    userMessage: s.userMessage,
    conversationHistory: s.conversationHistory,
    statusEvents: s.statusEvents,
    startedAt: s.startedAt,
    intent: s.intent,
    entities: s.entities,
    confidence: s.confidence,
    retrievedChunks: s.retrievedChunks,
    groundedAnswer: s.groundedAnswer,
    retrievalHit: s.retrievalHit,
    toolCalls: s.toolCalls,
    toolResults: s.toolResults,
    escalationFlag: s.escalationFlag,
    escalationReason: s.escalationReason,
    escalationSummary: s.escalationSummary,
    finalAnswer: s.finalAnswer,
    finishedAt: s.finishedAt,
  };
}

// ──────────────────────────────────────────────────────────────────────
// Nodes
// ──────────────────────────────────────────────────────────────────────

async function intakeNode(state: GraphStateType): Promise<GraphUpdate> {
  const result = classify(state.userMessage, state.conversationHistory);
  return {
    intent: result.intent,
    entities: result.entities,
    confidence: result.confidence,
    statusEvents: [statusEvent("classifying", "Classifying request…")],
  };
}

async function knowledgeNode(state: GraphStateType): Promise<GraphUpdate> {
  if (!state.intent) return {};
  const result = await retrieve(state.userMessage, state.intent, {
    toolName: state.entities?.toolName,
    ticketId: state.entities?.ticketId,
  });
  return {
    retrievedChunks: result.retrievedChunks,
    groundedAnswer: result.groundedAnswer,
    retrievalHit: result.retrievalHit,
    statusEvents: [
      statusEvent("searching_docs", "Searching IT documentation…"),
    ],
  };
}

async function workflowNode(state: GraphStateType): Promise<GraphUpdate> {
  // Pick a status label per intent so the UI can show progress.
  const events: StatusEvent[] = [];
  if (state.intent === "access_help") {
    events.push(
      statusEvent("submitting_request", "Submitting access request…")
    );
  } else if (state.intent === "account_help") {
    events.push(
      statusEvent("calling_tool", "Checking account recovery options…")
    );
  } else if (state.intent === "ticket_status") {
    events.push(statusEvent("checking_ticket", "Checking ticket status…"));
  }

  const wf = await runWorkflow(toAgentState(state));
  return {
    toolCalls: wf.toolCalls,
    toolResults: wf.toolResults,
    workflowFlag: {
      needsEscalation: wf.needsEscalation ?? false,
      reason: wf.reason,
    },
    statusEvents: events,
  };
}

async function escalationNode(state: GraphStateType): Promise<GraphUpdate> {
  const decision = decideEscalation(toAgentState(state), {
    needsEscalation: state.workflowFlag?.needsEscalation ?? false,
    reason: state.workflowFlag?.reason,
  });
  if (!decision.escalate) {
    // Shouldn't happen — `decide()` is only called when we routed here —
    // but be defensive.
    return {
      escalationFlag: false,
    };
  }
  return {
    escalationFlag: true,
    escalationReason: decision.reason,
    escalationSummary: decision.summary,
    finalAnswer: decision.userMessage,
    statusEvents: [statusEvent("escalating", "Escalating to human IT…")],
  };
}

async function respondNode(state: GraphStateType): Promise<GraphUpdate> {
  return {
    finalAnswer: buildFinalAnswer(state),
    escalationFlag: false,
    statusEvents: [statusEvent("responding", "Composing response…")],
  };
}

// ──────────────────────────────────────────────────────────────────────
// Conditional routers
// ──────────────────────────────────────────────────────────────────────

/**
 * After Intake — route based on intent and confidence.
 * - `greeting` and `out_of_scope` skip the whole pipeline; respond directly.
 * - `ticket_status` skips Knowledge (the tool returns structured data).
 * - `unknown` with low confidence goes to Escalation; "I need a new ticket"-
 *   style underspecified requests get a friendly clarification handoff.
 * - everything else does Knowledge → Workflow.
 */
function routeAfterIntake(
  state: GraphStateType
): "knowledge" | "workflow" | "escalation" | "respond" {
  if (state.intent === "greeting" || state.intent === "out_of_scope") {
    return "respond";
  }
  if (state.intent === "ticket_status") return "workflow";
  if (state.intent === "unknown" && (state.confidence ?? 0) < 0.5) {
    return "escalation";
  }
  return "knowledge";
}

/**
 * After Workflow — decide whether to escalate or respond. We delegate
 * the actual decision to the Escalation Agent's `decide()` so the
 * policy is in one place.
 */
function routeAfterWorkflow(state: GraphStateType): "escalation" | "respond" {
  const decision = decideEscalation(toAgentState(state), {
    needsEscalation: state.workflowFlag?.needsEscalation ?? false,
    reason: state.workflowFlag?.reason,
  });
  return decision.escalate ? "escalation" : "respond";
}

// ──────────────────────────────────────────────────────────────────────
// Final-answer composition (per intent)
// ──────────────────────────────────────────────────────────────────────

function explainTicketStatus(state: GraphStateType): string | undefined {
  const result = state.toolResults?.find(
    (r) => r.name === "get_ticket_status" && r.ok
  );
  if (!result?.data) return undefined;

  const d = result.data as {
    state: string;
    owner: string;
    last_update: string;
    next_action: string;
  };

  const plain: Record<string, string> = {
    open: "is open and waiting to be picked up by IT",
    in_progress: "is being worked on by IT right now",
    waiting_on_user: "is waiting on a response from you",
    waiting_on_approval: "is waiting on a manager approval",
    resolved: "has been resolved",
    closed: "is closed",
    stale: "has not been updated in several days and may be stuck",
  };
  const verbalState =
    plain[d.state] ?? `is currently in state \`${d.state}\``;

  return [
    `Your ticket ${verbalState}.`,
    `Assigned to: **${d.owner}**`,
    `Last updated: ${d.last_update}`,
    `Next step: ${d.next_action}`,
  ].join("\n");
}

/**
 * Format the result of a search_tickets call (when the user asked about
 * a ticket without giving an ID, but did provide an email or subject
 * keyword). Returns undefined if no matching tickets were found so the
 * caller can fall through to the not-found path.
 */
function explainTicketSearch(state: GraphStateType): string | undefined {
  const result = state.toolResults?.find(
    (r) => r.name === "search_tickets" && r.ok
  );
  if (!result?.data) return undefined;
  const data = result.data as {
    count: number;
    tickets: Array<{
      id: string;
      summary: string;
      state: string;
      owner: string;
      last_update: string;
      next_action: string;
    }>;
  };
  if (data.count === 0) return undefined;

  if (data.count === 1) {
    const t = data.tickets[0];
    return [
      `I found one matching open ticket: **${t.id}** — ${t.summary}.`,
      `Status: \`${t.state}\` · Owner: **${t.owner}** · Last updated: ${t.last_update}`,
      `Next step: ${t.next_action}`,
    ].join("\n");
  }

  // Multiple matches — list them so the user can pick.
  const lines = [
    `I found ${data.count} open tickets that match. Which one did you mean?`,
    ``,
  ];
  for (const t of data.tickets.slice(0, 5)) {
    lines.push(`- **${t.id}** — ${t.summary} (\`${t.state}\`, updated ${t.last_update})`);
  }
  if (data.count > 5) {
    lines.push(`- ...and ${data.count - 5} more`);
  }
  return lines.join("\n");
}

function buildAccessAnswer(state: GraphStateType): string {
  // The access flow may run search_tickets first (duplicate check) then
  // create_access_request. Pull the create result specifically.
  const result =
    state.toolResults?.find((r) => r.name === "create_access_request") ??
    state.toolResults?.[0];
  const doc = state.groundedAnswer ?? "";
  if (!result) return doc || "I couldn't find a matching access policy.";

  const data = result.data as Record<string, unknown> | undefined;
  if (data?.duplicate) {
    return [
      `You already have an open access request for **${state.entities?.toolName}** — request ID \`${data.request_id}\`, status \`${data.status}\`.`,
      `I haven't created a duplicate. You can ask me for the status of that request any time.`,
      "",
      doc,
    ]
      .filter(Boolean)
      .join("\n\n");
  }
  return [
    `I've submitted an access request for **${state.entities?.toolName}** — request ID \`${data?.request_id}\`, status \`${data?.status}\`.`,
    "",
    doc,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function buildAccountAnswer(state: GraphStateType): string {
  const ticketResult = state.toolResults?.find(
    (r) => r.name === "create_account_ticket"
  );
  const doc = state.groundedAnswer ?? "";
  if (!ticketResult) {
    return [`Here's what to try first:`, doc].filter(Boolean).join("\n\n");
  }
  const data = ticketResult.data as Record<string, unknown> | undefined;
  return [
    `I've opened account support ticket \`${data?.ticket_id}\` for you (status: \`${data?.status}\`).`,
    "",
    `In the meantime, here's what our policy says:`,
    doc,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function buildFinalAnswer(state: GraphStateType): string {
  switch (state.intent) {
    case "access_help":
      return buildAccessAnswer(state);
    case "account_help":
      return buildAccountAnswer(state);
    case "ticket_status": {
      const explained = explainTicketStatus(state);
      if (explained) return explained;
      const searched = explainTicketSearch(state);
      if (searched) return searched;
      return state.groundedAnswer ?? "I couldn't retrieve that ticket.";
    }
    case "general_qa":
      return state.groundedAnswer ?? "I couldn't find an answer in our docs.";
    case "greeting":
      return [
        "Hi! I can help with three kinds of IT requests:",
        "",
        "- **Access requests** — \"I need access to Figma\"",
        "- **Account problems** — \"I'm locked out of my account\"",
        "- **Ticket status** — \"What's the status of INC-1042?\"",
        "",
        "I can also answer general IT questions like password rules, Wi-Fi setup, and escalation tiers. What can I help with?",
      ].join("\n");
    case "out_of_scope":
      return [
        "That doesn't look like an IT question — I focus on access requests, account issues, ticket status, and general IT FAQs.",
        "",
        "If you need help with HR, facilities, or payroll, those are handled by separate teams. For IT-related questions, I'm here.",
      ].join("\n");
    default:
      return "I'm not sure how to help with that yet.";
  }
}

// ──────────────────────────────────────────────────────────────────────
// Build the graph
// ──────────────────────────────────────────────────────────────────────

const graph = new StateGraph(GraphState)
  .addNode("intake", intakeNode)
  .addNode("knowledge", knowledgeNode)
  .addNode("workflow", workflowNode)
  .addNode("escalation", escalationNode)
  .addNode("respond", respondNode)
  .addEdge(START, "intake")
  .addConditionalEdges("intake", routeAfterIntake, {
    knowledge: "knowledge",
    workflow: "workflow",
    escalation: "escalation",
    respond: "respond",
  })
  .addEdge("knowledge", "workflow")
  .addConditionalEdges("workflow", routeAfterWorkflow, {
    escalation: "escalation",
    respond: "respond",
  })
  .addEdge("escalation", END)
  .addEdge("respond", END);

const compiled = graph.compile();

// ──────────────────────────────────────────────────────────────────────
// Public entrypoint
// ──────────────────────────────────────────────────────────────────────

/**
 * Run a single user turn through the graph.
 *
 * `handleMessage` is the only thing the rest of the app calls — the
 * underlying graph implementation can change without touching the API
 * route or the test suite.
 */
export async function handleMessage(
  userMessage: string,
  conversationHistory: Message[] = []
): Promise<ChatResponse> {
  const startedAt = Date.now();
  const final = await compiled.invoke({
    userMessage,
    conversationHistory,
    startedAt,
    statusEvents: [],
  });

  const finishedAt = Date.now();
  const latencyMs = finishedAt - startedAt;

  // Telemetry
  logRequest({
    userMessage: final.userMessage,
    intent: final.intent ?? "unknown",
    confidence: final.confidence ?? 0,
    retrievalHit: final.retrievalHit ?? false,
    toolsCalled: (final.toolCalls ?? []).map((c) => c.name),
    escalated: final.escalationFlag ?? false,
    latencyMs,
    timestamp: finishedAt,
  });

  return {
    answer: final.finalAnswer ?? "",
    intent: final.intent ?? "unknown",
    entities: final.entities ?? {},
    confidence: final.confidence ?? 0,
    retrievedSources: (final.retrievedChunks ?? []).map((c) => c.source),
    toolResults: final.toolResults ?? [],
    escalated: final.escalationFlag ?? false,
    escalationReason: final.escalationReason,
    statusEvents: final.statusEvents,
    latencyMs,
  };
}

/**
 * Streaming variant of `handleMessage`. Yields events as the graph
 * progresses through each agent so the UI can show real time progress
 * instead of waiting for the full pipeline to finish.
 *
 * Event shapes:
 *   { kind: "status", label: string }   from each agent as it starts
 *   { kind: "intent", intent, confidence, entities }   after Intake
 *   { kind: "sources", sources: string[] }   after Knowledge
 *   { kind: "tools", toolResults }   after Workflow
 *   { kind: "answer_chunk", text: string }   piece of the final answer
 *   { kind: "done", final: ChatResponse }   end of stream
 */
export async function* handleMessageStreaming(
  userMessage: string,
  conversationHistory: Message[] = []
): AsyncGenerator<StreamEvent, void, unknown> {
  const startedAt = Date.now();

  // We accumulate partial state from each node update so we can build a
  // proper ChatResponse at the end. LangGraph's `stream` yields one
  // entry per node execution.
  let accumulated: Partial<GraphStateType> = {
    userMessage,
    conversationHistory,
    startedAt,
    statusEvents: [],
  };

  // Track which events we've already emitted so we don't double emit.
  let emittedIntent = false;
  let emittedSources = false;
  let emittedTools = false;

  const stream = await compiled.stream(
    {
      userMessage,
      conversationHistory,
      startedAt,
      statusEvents: [],
    },
    { streamMode: "updates" }
  );

  for await (const update of stream) {
    // `update` is { nodeName: partialStateUpdate } from LangGraph.
    for (const [nodeName, partial] of Object.entries(update)) {
      if (!partial || typeof partial !== "object") continue;
      const p = partial as Partial<GraphStateType>;
      accumulated = { ...accumulated, ...p };

      // Emit status events as they arrive (from any node's emit).
      if (p.statusEvents && p.statusEvents.length > 0) {
        for (const ev of p.statusEvents) {
          yield {
            kind: "status",
            label: ev.label,
            stage: ev.kind,
            node: nodeName,
          };
        }
      }

      // After intake, emit the classification.
      if (!emittedIntent && p.intent !== undefined) {
        emittedIntent = true;
        yield {
          kind: "intent",
          intent: p.intent ?? "unknown",
          confidence: p.confidence ?? 0,
          entities: p.entities ?? {},
        };
      }

      // After knowledge, emit retrieved sources.
      if (!emittedSources && p.retrievedChunks !== undefined) {
        emittedSources = true;
        yield {
          kind: "sources",
          sources: (p.retrievedChunks ?? []).map((c) => c.source),
        };
      }

      // After workflow, emit tool results.
      if (!emittedTools && p.toolResults !== undefined) {
        emittedTools = true;
        yield {
          kind: "tools",
          toolResults: p.toolResults ?? [],
        };
      }
    }
  }

  // Final answer streams word-by-word for a more dynamic feel.
  const finalAnswer = accumulated.finalAnswer ?? "";
  const words = finalAnswer.split(/(\s+)/); // keep whitespace
  for (const word of words) {
    yield { kind: "answer_chunk", text: word };
    // tiny delay so the streaming is visible to the eye
    await new Promise((r) => setTimeout(r, 8));
  }

  const finishedAt = Date.now();
  const latencyMs = finishedAt - startedAt;

  // Telemetry (same as non streaming path).
  logRequest({
    userMessage,
    intent: accumulated.intent ?? "unknown",
    confidence: accumulated.confidence ?? 0,
    retrievalHit: accumulated.retrievalHit ?? false,
    toolsCalled: (accumulated.toolCalls ?? []).map((c) => c.name),
    escalated: accumulated.escalationFlag ?? false,
    latencyMs,
    timestamp: finishedAt,
  });

  yield {
    kind: "done",
    final: {
      answer: finalAnswer,
      intent: accumulated.intent ?? "unknown",
      entities: accumulated.entities ?? {},
      confidence: accumulated.confidence ?? 0,
      retrievedSources: (accumulated.retrievedChunks ?? []).map((c) => c.source),
      toolResults: accumulated.toolResults ?? [],
      escalated: accumulated.escalationFlag ?? false,
      escalationReason: accumulated.escalationReason,
      statusEvents: accumulated.statusEvents ?? [],
      latencyMs,
    },
  };
}

export type StreamEvent =
  | { kind: "status"; label: string; stage: string; node: string }
  | {
      kind: "intent";
      intent: Intent;
      confidence: number;
      entities: Entities;
    }
  | { kind: "sources"; sources: string[] }
  | { kind: "tools"; toolResults: ToolResult[] }
  | { kind: "answer_chunk"; text: string }
  | { kind: "done"; final: ChatResponse };