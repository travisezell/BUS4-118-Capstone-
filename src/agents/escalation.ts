/**
 * Escalation Agent
 *
 * PRD §7.1: monitors for low confidence, missing fields, risky patterns,
 * or repeated failure; produces a structured handoff package for human
 * IT including classification, retrieved evidence, and what was tried.
 */

import type { AgentState } from "./types";

const CONFIDENCE_THRESHOLD = 0.5;

export interface EscalationDecision {
  escalate: boolean;
  reason?: string;
  summary?: string;
  /** Human-readable response to send back to the user. */
  userMessage?: string;
}

function buildSummary(state: AgentState, reason: string): string {
  const lines: string[] = [];
  lines.push(`**Handoff to human IT**`);
  lines.push(`Reason: ${reason}`);
  lines.push("");
  lines.push(`Original message: "${state.userMessage}"`);
  if (state.intent) {
    lines.push(
      `Classified intent: \`${state.intent}\` (confidence ${(
        (state.confidence ?? 0) * 100
      ).toFixed(0)}%)`
    );
  }
  if (state.entities && Object.keys(state.entities).length > 0) {
    lines.push(`Entities: ${JSON.stringify(state.entities)}`);
  }
  if (state.retrievedChunks && state.retrievedChunks.length > 0) {
    const sources = state.retrievedChunks.map((c) => c.source).join(", ");
    lines.push(`Docs consulted: ${sources}`);
  }
  if (state.toolResults && state.toolResults.length > 0) {
    lines.push(
      `Tools tried: ${state.toolResults
        .map(
          (r) => `${r.name} -> ${r.ok ? "ok" : `error: ${r.error ?? "unknown"}`}`
        )
        .join("; ")}`
    );
  }
  return lines.join("\n");
}

/**
 * Decide whether to escalate based on the full agent state.
 *
 * Escalation triggers:
 *   1. The Workflow Agent flagged it (missing entities, tool failure,
 *      or risky pattern like suspected compromise).
 *   2. Intent confidence is below the threshold.
 *   3. The Knowledge Agent returned no usable retrieval for an intent
 *      that needs grounded policy text (access_help / account_help /
 *      general_qa).
 */
export function decide(
  state: AgentState,
  workflowFlag: { needsEscalation: boolean; reason?: string }
): EscalationDecision {
  // 1. Workflow-driven escalation always wins.
  if (workflowFlag.needsEscalation && workflowFlag.reason) {
    const reason = workflowFlag.reason;
    return {
      escalate: true,
      reason,
      summary: buildSummary(state, reason),
      userMessage: buildUserMessage(state, reason),
    };
  }

  // 2. Low confidence on intent.
  if ((state.confidence ?? 0) < CONFIDENCE_THRESHOLD) {
    const reason = "Low confidence in intent classification.";
    return {
      escalate: true,
      reason,
      summary: buildSummary(state, reason),
      userMessage: buildUserMessage(state, reason),
    };
  }

  // 3. RAG miss on an intent that depends on grounded policy.
  const needsGrounding =
    state.intent === "access_help" ||
    state.intent === "account_help" ||
    state.intent === "general_qa";
  if (needsGrounding && state.retrievalHit === false) {
    const reason = "No matching IT policy was found for this request.";
    return {
      escalate: true,
      reason,
      summary: buildSummary(state, reason),
      userMessage: buildUserMessage(state, reason),
    };
  }

  return { escalate: false };
}

function buildUserMessage(state: AgentState, reason: string): string {
  // Friendlier handling when the user clearly wants something but
  // didn't give us enough to act on. Avoids the cold "low confidence"
  // wording in the common "I need a new ticket" case.
  if (state.entities?.clarificationNeeded === "ticket_category") {
    return [
      "I'd like to help — could you tell me a bit more about what's going on?",
      "",
      "For example:",
      "- **Software access** (\"I need access to Figma\")",
      "- **Account problem** (\"I'm locked out\" or \"my password isn't working\")",
      "- **Existing ticket** (\"What's the status of INC-1042?\")",
      "",
      "If none of those fit, let me know what you're trying to do and I'll either help directly or pass it to human IT with the right context.",
    ].join("\n");
  }

  return [
    `I'm not confident I can resolve this on my own, so I'm handing it off to human IT.`,
    ``,
    `**What I'm sending them:**`,
    `- Your original request: "${state.userMessage}"`,
    state.intent ? `- My best guess at the category: ${state.intent}` : null,
    state.entities && Object.keys(state.entities).length > 0
      ? `- What I extracted: ${JSON.stringify(state.entities)}`
      : null,
    state.toolResults && state.toolResults.length > 0
      ? `- What I tried: ${state.toolResults
          .map((r) => r.name)
          .join(", ")}`
      : null,
    ``,
    `Reason for handoff: ${reason}`,
  ]
    .filter(Boolean)
    .join("\n");
}
