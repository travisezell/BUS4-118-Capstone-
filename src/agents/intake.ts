/**
 * Intake Agent
 *
 * PRD §7.1: classifies the user message into one of
 *   { access_help, account_help, ticket_status, general_qa }
 * and extracts entities (toolName, accountId, ticketId, cause).
 *
 * Implementation strategy
 * -----------------------
 * In production this would call an LLM with a JSON-schema-constrained
 * prompt. For the prototype we use a fast, deterministic rule-based
 * classifier that:
 *   - is good enough to demo the multi-agent flow,
 *   - is testable without API keys, and
 *   - exposes a single `classify()` function the LLM-backed
 *     implementation can replace later.
 *
 * The pluggable LLM interface is in `src/lib/llm.ts`. To swap in a real
 * LLM, change `classify()` to call `llm.generateResponse(...)` with the
 * intent-classification prompt and JSON-parse the result.
 */

import type { Entities, Intent } from "./types";

interface IntakeResult {
  intent: Intent;
  entities: Entities;
  confidence: number;
}

// Common application/tool names we expect to see. Everything else is
// captured by the heuristic regex below.
const KNOWN_TOOLS = [
  "figma",
  "slack",
  "github",
  "jira",
  "notion",
  "salesforce",
  "tableau",
  "confluence",
  "okta",
  "zoom",
  "aws",
  "gcp",
  "azure",
  "datadog",
  "looker",
  "miro",
];

const ACCESS_KEYWORDS = [
  "access",
  "permission",
  "permissions",
  "request access",
  "get into",
  "can't get into",
  "cannot access",
  "need access",
  "add me to",
  "grant",
  "license",
];

const ACCOUNT_KEYWORDS = [
  "locked",
  "lock out",
  "lockout",
  "locked out",
  "can't log in",
  "cannot log in",
  "can't login",
  "password",
  "reset password",
  "forgot password",
  "mfa",
  "two factor",
  "2fa",
  "compromised",
  "hacked",
  "suspicious",
];

const TICKET_KEYWORDS = [
  "ticket",
  "case",
  "incident",
  "request status",
  "what's the status",
  "where is my",
  "any update on",
];

function lower(s: string): string {
  return s.toLowerCase();
}

function any(haystack: string, needles: string[]): boolean {
  return needles.some((n) => haystack.includes(n));
}

/** Extract a ticket-like identifier (e.g. INC-1042, TKT123, #501). */
function extractTicketId(message: string): string | undefined {
  // Prefer alphanumeric IDs like INC-1042, TKT-99, TASK_42
  const alpha = message.match(/\b([A-Z]{2,5}[-_]?\d{2,6})\b/);
  if (alpha) return alpha[1].toUpperCase();

  // Then #123 or "ticket 1042"
  const hash = message.match(/#\s*(\d{2,8})/);
  if (hash) return hash[1];

  const word = message.match(/\b(?:ticket|case|incident)\s+(?:#|number\s+)?(\d{2,8})\b/i);
  if (word) return word[1];

  return undefined;
}

/** Words that are NOT real tool names — placeholders, articles, generics. */
const GENERIC_TOOL_WORDS = new Set([
  "a",
  "an",
  "the",
  "tool",
  "tools",
  "app",
  "apps",
  "application",
  "applications",
  "software",
  "thing",
  "stuff",
  "system",
  "service",
  "platform",
  "something",
  "anything",
  "everything",
  "it",
]);

/** Extract a known tool/app name. */
function extractToolName(message: string): string | undefined {
  const lc = lower(message);
  for (const tool of KNOWN_TOOLS) {
    if (lc.includes(tool)) {
      // Title-case for display
      return tool.charAt(0).toUpperCase() + tool.slice(1);
    }
  }

  // Heuristic: "access to X" or "into X" where X is a capitalized word.
  const m =
    message.match(/access\s+(?:to|for)\s+([A-Za-z][\w.+-]{2,30})/i) ||
    message.match(/into\s+([A-Z][\w.+-]{2,30})/);
  if (m) {
    const candidate = m[1];
    if (GENERIC_TOOL_WORDS.has(candidate.toLowerCase())) {
      return undefined;
    }
    return candidate;
  }

  return undefined;
}

/** Extract a probable account identifier (email, username). */
function extractAccountId(message: string): string | undefined {
  const email = message.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  if (email) return email[0];
  return undefined;
}

/**
 * Extract an observed cause (e.g. "too many attempts", "forgot password",
 * "suspected compromise"). Compromise detection is intentionally broad —
 * users almost never use the literal word "compromised" when they're
 * actually compromised. They say things like "someone logged into my
 * account from another country and I didn't do it." Each natural-
 * language pattern below maps a real-world phrasing to the canonical
 * `suspected_compromise` cause so Workflow can route to a P1 ticket.
 */
function extractCause(message: string): string | undefined {
  const lc = lower(message);

  // ──────────────────────────────────────────────────────────────────
  // Suspected compromise — checked first because it's the highest-
  // priority cause and it can co-occur with other signals (e.g. "I'm
  // locked out and someone else is using my account").
  // ──────────────────────────────────────────────────────────────────

  // Direct vocabulary
  if (
    lc.includes("compromised") ||
    lc.includes("hacked") ||
    lc.includes("suspicious") ||
    lc.includes("phished") ||
    lc.includes("stolen") ||
    lc.includes("unauthorized") ||
    lc.includes("unauthorised") ||
    lc.includes("breach")
  ) {
    return "suspected_compromise";
  }

  // "Someone else" / not-me phrasing
  if (
    /\bsomeone\s+(?:else|is|has|got|logged|signed)\b/i.test(message) ||
    /\b(?:wasn'?t|isn'?t|not)\s+me\b/i.test(message) ||
    /\bi\s+(?:didn'?t|never)\s+(?:do|log|sign|change|reset|share)\b/i.test(message)
  ) {
    return "suspected_compromise";
  }

  // Unfamiliar location / device signals
  if (
    /\b(?:another|different|unfamiliar|unknown|strange|weird)\s+(?:country|location|place|city|state|device|computer|machine|ip)\b/i.test(
      message
    ) ||
    /\bfrom\s+(?:another|a different|somewhere|some\s*place)\b/i.test(message) ||
    /\b(?:unrecognized|unrecognised)\s+(?:device|location|login|sign-?in)\b/i.test(message)
  ) {
    return "suspected_compromise";
  }

  // Account changed without consent
  if (
    /\bpassword\s+(?:got|was|has been)\s+changed\b/i.test(message) ||
    /\bsecurity\s+alert\b/i.test(message) ||
    /\bidentity\s+theft\b/i.test(message)
  ) {
    return "suspected_compromise";
  }

  // ──────────────────────────────────────────────────────────────────
  // Other causes
  // ──────────────────────────────────────────────────────────────────
  if (lc.includes("too many attempts") || lc.includes("too many tries"))
    return "too_many_attempts";
  if (lc.includes("forgot") || lc.includes("forgotten"))
    return "forgot_password";
  if (lc.includes("mfa") || lc.includes("two factor") || lc.includes("2fa"))
    return "mfa_issue";

  return undefined;
}

export function classify(userMessage: string): IntakeResult {
  const lc = lower(userMessage.trim());
  const entities: Entities = {};

  const ticketId = extractTicketId(userMessage);
  if (ticketId) entities.ticketId = ticketId;

  const toolName = extractToolName(userMessage);
  if (toolName) entities.toolName = toolName;

  const accountId = extractAccountId(userMessage);
  if (accountId) entities.accountId = accountId;

  const cause = extractCause(userMessage);
  if (cause) entities.cause = cause;

  // High-confidence early exit: any signal of account compromise routes
  // straight to account_help so Workflow can open a P1 ticket and
  // Escalation can flag it for Security review. We do this BEFORE the
  // normal keyword scoring because phrasings like "someone logged into
  // my account from another country" don't contain the literal word
  // "compromised" — they'd otherwise fall through to `unknown`.
  if (cause === "suspected_compromise") {
    return {
      intent: "account_help",
      entities,
      confidence: 0.9,
    };
  }

  // Score each intent. The order of checks matters because some keywords
  // overlap (e.g. "ticket" could appear in an access request).
  const hasTicketKw = any(lc, TICKET_KEYWORDS);
  const hasAccessKw = any(lc, ACCESS_KEYWORDS);
  const hasAccountKw = any(lc, ACCOUNT_KEYWORDS);

  // Ticket Status: explicit ticket keyword + status-style phrasing
  // OR an extracted ticket ID with a "status/where/update" cue.
  if (
    (hasTicketKw && /(status|update|where|progress|stuck)/i.test(lc)) ||
    (entities.ticketId && /(status|update|where|progress|open|stuck)/i.test(lc))
  ) {
    return {
      intent: "ticket_status",
      entities,
      confidence: entities.ticketId ? 0.95 : 0.75,
    };
  }

  // Account Help — look for lockout/password/MFA cues.
  if (hasAccountKw) {
    return {
      intent: "account_help",
      entities,
      // Confidence is higher when we extracted a cause too.
      confidence: entities.cause ? 0.9 : 0.75,
    };
  }

  // Access Help — explicit access cues.
  if (hasAccessKw) {
    return {
      intent: "access_help",
      entities,
      // Lower confidence when we couldn't pick out the tool name —
      // the orchestrator will route this to clarification/escalation.
      confidence: entities.toolName ? 0.9 : 0.55,
    };
  }

  // Generic ticket reference without status phrasing — still treat as
  // ticket_status but with lower confidence.
  if (hasTicketKw || entities.ticketId) {
    return {
      intent: "ticket_status",
      entities,
      confidence: 0.6,
    };
  }

  // Q&A fallback for things like "what are the password rules" or
  // "how do I connect to wifi".
  if (
    /password (rule|requirement|policy)/i.test(lc) ||
    /\bwi-?fi\b/i.test(lc) ||
    /\bescalation\b/i.test(lc) ||
    /\bsla\b/i.test(lc) ||
    /how (do|can) i\b/i.test(lc)
  ) {
    return {
      intent: "general_qa",
      entities,
      confidence: 0.7,
    };
  }

  return {
    intent: "unknown",
    entities,
    confidence: 0.2,
  };
}
