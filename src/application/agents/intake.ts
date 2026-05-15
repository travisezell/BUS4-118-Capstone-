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

import type { Entities, Intent, Message } from "./types";

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
  // Natural-language patterns for "I want to use Tool X"
  "want to use",
  "would like to use",
  "set me up with",
  "set up with",
  "onboard me to",
  "provision",
];

const ACCOUNT_KEYWORDS = [
  "locked",
  "lock out",
  "lockout",
  "locked out",
  "can't log in",
  "cannot log in",
  "can't login",
  "cannot login",
  "can't sign in",
  "cannot sign in",
  "can't get in",
  "password",
  "reset password",
  "forgot password",
  "mfa",
  "two factor",
  "2fa",
  "compromised",
  "hacked",
  "suspicious",
  // Natural-language phrasings for "my login isn't working"
  "my account is",
  "account is broken",
  "account isn't working",
  "account is not working",
  "login not working",
  "login isn't working",
  "login isn't",
  "login doesn't",
  "login is broken",
  "with my login",
  "with my sign-in",
  "with my sign in",
  "sign-in not working",
  "sign in not working",
  "wrong password",
];

const TICKET_KEYWORDS = [
  "ticket",
  "case",
  "incident",
  "request status",
  "what's the status",
  "where is my",
  "where's my",
  "any update on",
  "did my request",
  "did my ticket",
  "go through",
];

/**
 * Phrases that indicate the user wants to *create* a ticket, not check
 * the status of one. These are intentionally specific so we don't catch
 * "what's the status of my open ticket" (that's a status lookup).
 */
const CREATE_TICKET_PATTERNS: RegExp[] = [
  /\b(?:create|open|file|submit|raise|start)\s+(?:a|an|new)?\s*ticket\b/i,
  /\b(?:i\s*)?(?:need|want|would like)\s+(?:a|an|new)?\s*(?:new\s+)?ticket\b/i,
  /\bnew ticket\b/i,
];

/**
 * Greetings, capability questions, and other non-help messages.
 * The system responds with a friendly capability summary instead of
 * escalating to a Tier 2 ticket — those would be noise for IT staff.
 */
const GREETING_PATTERNS: RegExp[] = [
  /^\s*(?:hi|hello|hey|yo|sup|hiya|howdy|greetings?)\s*[!.?]*\s*$/i,
  /^\s*(?:good\s*(?:morning|afternoon|evening))\s*[!.?]*\s*$/i,
  /^\s*(?:thanks?|thank\s*you|thx|ty)\s*[!.?]*\s*$/i,
  /^\s*(?:ok|okay|cool|got it|nice|sure)\s*[!.?]*\s*$/i,
  /^\s*\??\s*$/, // bare "?" or empty-ish input
  /^\s*test\s*[!.?]*\s*$/i,
  /^\s*(?:i\s+need\s+help|help\s*me)\s*[!.?]*\s*$/i, // standalone "I need help" / "help me"
  /\bwhat (?:can|do) you (?:do|help)\b/i,
  /\bwho are you\b/i,
  /\bare you (?:a |an )?(?:bot|ai|robot|human)\b/i,
];

/**
 * Out-of-scope topics — things that aren't IT but might come our way.
 * We respond with a polite "this isn't something I can help with"
 * rather than escalating to IT, since IT shouldn't get HR/facility
 * questions either.
 */
const OUT_OF_SCOPE_PATTERNS: RegExp[] = [
  /\b(?:office|building)\s+(?:hours?|open|closed)\b/i,
  /\b(?:parking|cafeteria|lunch|kitchen|conference room)\b/i,
  /\b(?:hr|payroll|benefits|pto|vacation|salary|paycheck)\b/i,
  /\b(?:badge|keycard|access card)\b/i, // physical access, not software
  /\bweather\b/i,
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
  const alpha = message.match(/\b([A-Z][A-Z0-9]{1,9}[-_]?\d{1,6})\b/);
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

/**
 * Detect referential follow-ups like "what's the status of that?",
 * "is it done?", "any update?", "the request I just made". Returns
 * true when the message is short and uses a pronoun or generic
 * reference to the previous turn rather than naming a specific
 * ticket or tool.
 */
const FOLLOWUP_PATTERNS: RegExp[] = [
  /\b(?:status of|update on)\s+(?:that|it|this|my (?:request|ticket))\b/i,
  /^\s*(?:any|got an?)\s+(?:update|news)\b/i,
  /^\s*(?:is|has)\s+(?:that|it|this|my (?:request|ticket))\s+(?:done|ready|approved|finished|resolved)/i,
  /\b(?:what about|how about)\s+(?:that|it|this)\b/i,
  /\bthe\s+(?:request|ticket|one)\s+(?:i\s+(?:just\s+)?(?:made|opened|filed|submitted)|from\s+(?:earlier|before|just now))\b/i,
  /^\s*(?:check|look up)\s+(?:that|it|the\s+status)\b/i,
];

/**
 * Pull the most recently surfaced ticket ID from the conversation
 * history. Looks at the assistant's previous responses for ticket-like
 * identifiers (INC-XXXX, REQ-XXXX, etc.) the system has already
 * created or referenced. Used when the user follows up with "what's
 * the status of that?" without restating the ID.
 */
function findRecentTicketIdInHistory(
  history: Message[]
): string | undefined {
  // Walk backwards through history (most recent first).
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i];
    if (msg.role !== "assistant") continue;
    const match = msg.content.match(/\b([A-Z][A-Z0-9]{1,9}[-_]?\d{1,6})\b/);
    if (match) return match[1].toUpperCase();
  }
  return undefined;
}

export function classify(
  userMessage: string,
  history: Message[] = []
): IntakeResult {
  const lc = lower(userMessage.trim());
  const entities: Entities = {};

  // Greetings, "what can you do", thanks, etc. — return a friendly
  // capability message, never escalate to a Tier 2 ticket.
  if (GREETING_PATTERNS.some((re) => re.test(userMessage))) {
    return {
      intent: "greeting",
      entities,
      confidence: 0.95,
    };
  }

  // Out-of-scope — facilities, HR, payroll, weather, etc. Politely
  // decline rather than escalate; these aren't IT problems and
  // escalating them creates noise for IT staff.
  if (OUT_OF_SCOPE_PATTERNS.some((re) => re.test(userMessage))) {
    return {
      intent: "out_of_scope",
      entities,
      confidence: 0.85,
    };
  }

  const ticketId = extractTicketId(userMessage);
  if (ticketId) entities.ticketId = ticketId;

  const toolName = extractToolName(userMessage);
  if (toolName) entities.toolName = toolName;

  const accountId = extractAccountId(userMessage);
  if (accountId) entities.accountId = accountId;

  const cause = extractCause(userMessage);
  if (cause) entities.cause = cause;

  // Follow-up reference resolution. When the user asks a referential
  // question like "what's the status of that?" or "any update?" without
  // restating the ticket ID, look back through the conversation
  // history for the most recently surfaced ID and use it.
  const isFollowUp = FOLLOWUP_PATTERNS.some((re) => re.test(userMessage));
  if (isFollowUp && !entities.ticketId && history.length > 0) {
    const recentTicketId = findRecentTicketIdInHistory(history);
    if (recentTicketId) {
      entities.ticketId = recentTicketId;
      // Confident this is a status check on the referenced ticket.
      return {
        intent: "ticket_status",
        entities,
        confidence: 0.85,
      };
    }
  }

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

  // "I need a new ticket" / "create a ticket" without any other intent
  // signal. We know the user wants to create something but not what
  // category. Route to `unknown` with a clarification flag so the
  // Escalation Agent shows a friendly "tell me more" message instead
  // of a generic "low confidence" handoff.
  const wantsToCreateTicket = CREATE_TICKET_PATTERNS.some((re) =>
    re.test(userMessage)
  );
  if (wantsToCreateTicket) {
    // Only route to clarification if we don't have other intent signals.
    // "create a ticket for figma access" should still go to access_help.
    const hasOtherIntent =
      any(lc, ACCESS_KEYWORDS) ||
      any(lc, ACCOUNT_KEYWORDS) ||
      entities.toolName ||
      entities.cause;
    if (!hasOtherIntent) {
      entities.clarificationNeeded = "ticket_category";
      return {
        intent: "unknown",
        entities,
        confidence: 0.4,
      };
    }
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
