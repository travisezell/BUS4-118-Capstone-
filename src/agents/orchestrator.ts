/**
 * Orchestrator
 *
 * PRD §7: a LangGraph-style state graph that routes a single user
 * message through the four agents:
 *
 *   Intake -> Knowledge -> Workflow -> Escalation -> User
 *
 * For the prototype this is a hand-written state machine (no LangGraph
 * dependency required). The shape mirrors LangGraph's `StateGraph`:
 * nodes mutate a shared `AgentState`, transitions are conditional, and
 * every node can write `statusEvents` so the UI can show what's
 * happening.
 *
 * If you want to swap in real LangGraph later, port each `step*`
 * function into a node and reuse the same `AgentState` type.
 */

import { logRequest } from "../lib/metrics";
import { decide as decideEscalation } from "./escalation";
import { classify } from "./intake";
import { retrieve } from "./knowledge";
import type {
  AgentState,
  ChatResponse,
  Message,
  StatusEvent,
} from "./types";
import { run as runWorkflow } from "./workflow";

function pushStatus(state: AgentState, event: Omit<StatusEvent, "at">) {
  state.statusEvents.push({ ...event, at: Date.now() });
}

function emptyState(
  userMessage: string,
  conversationHistory: Message[]
): AgentState {
  return {
    userMessage,
    conversationHistory,
    statusEvents: [],
    startedAt: Date.now(),
  };
}

async function stepIntake(state: AgentState): Promise<void> {
  pushStatus(state, { kind: "classifying", label: "Classifying request…" });
  const result = classify(state.userMessage);
  state.intent = result.intent;
  state.entities = result.entities;
  state.confidence = result.confidence;
}

async function stepKnowledge(state: AgentState): Promise<void> {
  if (!state.intent) return;
  // Ticket Status doesn't need a doc lookup before the tool call —
  // the tool returns structured data and Knowledge formats it after.
  if (state.intent === "ticket_status") return;

  pushStatus(state, {
    kind: "searching_docs",
    label: "Searching IT documentation…",
  });
  const result = await retrieve(state.userMessage, state.intent, {
    toolName: state.entities?.toolName,
    ticketId: state.entities?.ticketId,
  });
  state.retrievedChunks = result.retrievedChunks;
  state.groundedAnswer = result.groundedAnswer;
  state.retrievalHit = result.retrievalHit;
}

async function stepWorkflow(state: AgentState) {
  // Decide which status label to show based on intent.
  if (state.intent === "access_help") {
    pushStatus(state, {
      kind: "submitting_request",
      label: "Submitting access request…",
    });
  } else if (state.intent === "account_help") {
    pushStatus(state, {
      kind: "calling_tool",
      label: "Checking account recovery options…",
    });
  } else if (state.intent === "ticket_status") {
    pushStatus(state, {
      kind: "checking_ticket",
      label: "Checking ticket status…",
    });
  }

  const result = await runWorkflow(state);
  state.toolCalls = result.toolCalls;
  state.toolResults = result.toolResults;
  return result;
}

/**
 * For ticket_status, after the Workflow Agent fetches the raw status,
 * the Knowledge Agent translates it into plain language. We do this
 * inline rather than re-entering Knowledge to keep the state graph
 * readable.
 */
function explainTicketStatus(state: AgentState): string | undefined {
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

function buildAccessAnswer(state: AgentState): string {
  const result = state.toolResults?.[0];
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

function buildAccountAnswer(state: AgentState): string {
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

function buildFinalAnswer(state: AgentState): string {
  switch (state.intent) {
    case "access_help":
      return buildAccessAnswer(state);
    case "account_help":
      return buildAccountAnswer(state);
    case "ticket_status": {
      const explained = explainTicketStatus(state);
      if (explained) return explained;
      return state.groundedAnswer ?? "I couldn't retrieve that ticket.";
    }
    case "general_qa":
      return state.groundedAnswer ?? "I couldn't find an answer in our docs.";
    default:
      return "I'm not sure how to help with that yet.";
  }
}

/**
 * Top-level entrypoint. Runs Intake -> Knowledge -> Workflow ->
 * Escalation, returns a `ChatResponse`.
 */
export async function handleMessage(
  userMessage: string,
  conversationHistory: Message[] = []
): Promise<ChatResponse> {
  const state = emptyState(userMessage, conversationHistory);

  // 1. Intake
  await stepIntake(state);

  // 2. Knowledge (skipped for ticket_status — see stepKnowledge)
  await stepKnowledge(state);

  // 3. Workflow
  const wf = await stepWorkflow(state);

  // 4. Escalation
  const escalation = decideEscalation(state, wf);
  if (escalation.escalate) {
    pushStatus(state, { kind: "escalating", label: "Escalating to human IT…" });
    state.escalationFlag = true;
    state.escalationReason = escalation.reason;
    state.escalationSummary = escalation.summary;
    state.finalAnswer = escalation.userMessage;
  } else {
    pushStatus(state, { kind: "responding", label: "Composing response…" });
    state.finalAnswer = buildFinalAnswer(state);
  }

  state.finishedAt = Date.now();
  const latencyMs = state.finishedAt - state.startedAt;

  // Telemetry
  logRequest({
    userMessage: state.userMessage,
    intent: state.intent ?? "unknown",
    confidence: state.confidence ?? 0,
    retrievalHit: state.retrievalHit ?? false,
    toolsCalled: (state.toolCalls ?? []).map((c) => c.name),
    escalated: state.escalationFlag ?? false,
    latencyMs,
    timestamp: state.finishedAt,
  });

  return {
    answer: state.finalAnswer ?? "",
    intent: state.intent ?? "unknown",
    entities: state.entities ?? {},
    confidence: state.confidence ?? 0,
    retrievedSources: (state.retrievedChunks ?? []).map((c) => c.source),
    toolResults: state.toolResults ?? [],
    escalated: state.escalationFlag ?? false,
    escalationReason: state.escalationReason,
    statusEvents: state.statusEvents,
    latencyMs,
  };
}
