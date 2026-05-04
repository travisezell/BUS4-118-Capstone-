/**
 * 12 end-to-end test scenarios — PRD §14.
 *
 * Four scenarios per flow (Access, Account, Ticket Status). Each test
 * runs a real user message through the orchestrator and asserts the
 * agent decisions: intent, retrieval, tool call, escalation.
 *
 * Run with:
 *   npm test
 *
 * The aggregate metrics (routing accuracy, retrieval hit rate,
 * auto-resolve rate, average latency) are emitted at the end of the
 * suite for inspection.
 */

import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { handleMessage } from "../src/agents/orchestrator";
import { reset, summarize } from "../src/lib/metrics";

beforeAll(() => {
  reset();
});

afterAll(() => {
  const s = summarize();
  // Print the aggregate summary so a CI run captures it.
  // eslint-disable-next-line no-console
  console.log("\n=== Aggregate Metrics (PRD §13) ===");
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(s, null, 2));
});

describe("Access Help (PRD §14.1)", () => {
  it("happy path: known tool, complete info, request submitted", async () => {
    const res = await handleMessage("How do I get access to Figma?");
    expect(res.intent).toBe("access_help");
    expect(res.entities.toolName?.toLowerCase()).toBe("figma");
    expect(res.escalated).toBe(false);
    expect(
      res.toolResults.some((r) => r.name === "create_access_request" && r.ok)
    ).toBe(true);
  });

  it("missing tool name: clarification / escalation, no broken tool call", async () => {
    const res = await handleMessage("I need access to a tool, can you help?");
    expect(res.intent).toBe("access_help");
    expect(res.escalated).toBe(true);
    // No successful tool call should fire when we can't identify the tool.
    const successfulCreate = res.toolResults.find(
      (r) => r.name === "create_access_request" && r.ok
    );
    expect(successfulCreate).toBeUndefined();
  });

  it("unsupported tool: still classified, escalated cleanly", async () => {
    // The tool isn't on our policy list, but we should still classify
    // intent and either submit a request that goes to procurement or
    // escalate. We accept either path as correct behavior.
    const res = await handleMessage(
      "I need access to ObscureToolX for a project."
    );
    expect(res.intent).toBe("access_help");
    // Either escalate, or a request was created (procurement path).
    const handled =
      res.escalated ||
      res.toolResults.some(
        (r) => r.name === "create_access_request" && r.ok
      );
    expect(handled).toBe(true);
  });

  it("duplicate request: references existing one rather than creating new", async () => {
    // First request creates one
    await handleMessage("How do I get access to Notion?");
    // Second request from the same user for the same tool must dedupe
    const res = await handleMessage("Can I get access to Notion?");
    const result = res.toolResults.find(
      (r) => r.name === "create_access_request"
    );
    expect(result?.ok).toBe(true);
    expect((result?.data as Record<string, unknown>).duplicate).toBe(true);
  });
});

describe("Account Help (PRD §14.2)", () => {
  it("happy path: standard lockout, guided self-service succeeds", async () => {
    const res = await handleMessage(
      "My account is locked because of too many attempts."
    );
    expect(res.intent).toBe("account_help");
    expect(res.entities.cause).toBe("too_many_attempts");
    expect(res.escalated).toBe(false);
    // The grounded answer (recovery steps) is what resolves it.
    expect(res.answer.length).toBeGreaterThan(20);
  });

  it("skipped self-service: user wants a ticket immediately", async () => {
    const res = await handleMessage(
      "Just open a ticket for my locked account please."
    );
    expect(res.intent).toBe("account_help");
    expect(
      res.toolResults.some(
        (r) => r.name === "create_account_ticket" && r.ok
      )
    ).toBe(true);
  });

  it("unclear account: classifies but lower confidence", async () => {
    const res = await handleMessage("I can't log in.");
    expect(res.intent).toBe("account_help");
    // Low confidence cases should either ask or escalate, not silently
    // pretend to fix something.
    expect(res.confidence).toBeLessThan(0.85);
  });

  it("risky request: suspected compromise escalates with high priority", async () => {
    const res = await handleMessage(
      "I think my account was compromised, there are emails I didn't send."
    );
    expect(res.intent).toBe("account_help");
    expect(res.entities.cause).toBe("suspected_compromise");
    expect(res.escalated).toBe(true);
    // We still create a ticket for the SOC; we just also escalate.
    expect(
      res.toolResults.some(
        (r) => r.name === "create_account_ticket" && r.ok
      )
    ).toBe(true);
  });

  it("risky request (natural-language phrasing): unfamiliar-location login still escalates", async () => {
    // Regression for a real demo failure (May 2026): the user phrasing did
    // not contain the literal words "compromised"/"hacked"/"suspicious",
    // so the keyword classifier fell through to `unknown` and escalation
    // was generic instead of routing to a Security ticket.
    const res = await handleMessage(
      "Someone logged into my account from another country and I didn't do it"
    );
    expect(res.intent).toBe("account_help");
    expect(res.entities.cause).toBe("suspected_compromise");
    expect(res.escalated).toBe(true);
    expect(
      res.toolResults.some(
        (r) => r.name === "create_account_ticket" && r.ok
      )
    ).toBe(true);
  });
});

describe("Ticket Status (PRD §14.3)", () => {
  it("happy path: valid ticket ID, status retrieved", async () => {
    const res = await handleMessage("What's the status of ticket INC-1042?");
    expect(res.intent).toBe("ticket_status");
    expect(res.entities.ticketId).toBe("INC-1042");
    expect(res.escalated).toBe(false);
    expect(
      res.toolResults.some((r) => r.name === "get_ticket_status" && r.ok)
    ).toBe(true);
  });

  it("invalid ticket ID: handles gracefully, no crash", async () => {
    const res = await handleMessage(
      "What's the status of ticket INC-99999?"
    );
    expect(res.intent).toBe("ticket_status");
    expect(res.escalated).toBe(true);
    const lookup = res.toolResults.find((r) => r.name === "get_ticket_status");
    expect(lookup?.ok).toBe(false);
  });

  it("multiple matches / no ID: classifies and escalates for clarification", async () => {
    const res = await handleMessage(
      "What's the status of my open tickets?"
    );
    expect(res.intent).toBe("ticket_status");
    // Without an ID we must escalate / ask, not guess a ticket.
    expect(res.escalated).toBe(true);
  });

  it("stale ticket: retrieved and explained as stalled", async () => {
    const res = await handleMessage("Status on INC-0907 please.");
    expect(res.intent).toBe("ticket_status");
    expect(res.entities.ticketId).toBe("INC-0907");
    expect(res.escalated).toBe(false);
    expect(res.answer.toLowerCase()).toMatch(/stuck|stalled|stale|idle/);
  });
});

describe("Edge cases (PRD §14.4)", () => {
  it("greeting: returns capability message, no escalation", async () => {
    const res = await handleMessage("hi");
    expect(res.intent).toBe("greeting");
    expect(res.escalated).toBe(false);
    expect(res.answer.toLowerCase()).toMatch(/access|account|ticket/);
  });

  it("'what can you do': returns capability message, no escalation", async () => {
    const res = await handleMessage("What can you do?");
    expect(res.intent).toBe("greeting");
    expect(res.escalated).toBe(false);
  });

  it("'I need a new ticket' alone: clarification handoff, not generic 'low confidence'", async () => {
    const res = await handleMessage("I need a new ticket");
    // Routes to unknown but with clarification flag — escalation message
    // should ask for category, not say "low confidence".
    expect(res.intent).toBe("unknown");
    expect(res.entities.clarificationNeeded).toBe("ticket_category");
    expect(res.escalated).toBe(true);
    // The friendlier message lists the categories.
    expect(res.answer.toLowerCase()).toMatch(/software access|account|existing ticket/);
  });

  it("out-of-scope (office hours): polite redirect, not escalation", async () => {
    const res = await handleMessage("Is the office open today?");
    expect(res.intent).toBe("out_of_scope");
    expect(res.escalated).toBe(false);
    expect(res.answer.toLowerCase()).toMatch(/it|hr|facilities/);
  });

  it("natural-language account problem ('my account is broken'): classifies as account_help", async () => {
    const res = await handleMessage("My account is broken");
    expect(res.intent).toBe("account_help");
    expect(res.escalated).toBe(false);
  });

  it("ticket status by subject keyword (no ID, but says 'Figma'): finds open ticket via search_tickets", async () => {
    const res = await handleMessage("any update on my Figma ticket?");
    expect(res.intent).toBe("ticket_status");
    // Workflow should attempt search_tickets and find INC-1042 (Figma access).
    const searchResult = res.toolResults.find((r) => r.name === "search_tickets");
    expect(searchResult).toBeDefined();
    expect(searchResult?.ok).toBe(true);
    // Either the ticket was found (no escalation) or we fall back gracefully.
    // The seeded INC-1042 has app_name Figma and is open, so we expect a match.
    expect(res.escalated).toBe(false);
    expect(res.answer).toContain("INC-1042");
  });
});

describe("Conversation memory (multi-turn)", () => {
  it("'what's the status of that?' resolves to the ticket from a prior assistant turn", async () => {
    // Simulate a prior turn where the assistant referenced INC-1042.
    const history = [
      { role: "user" as const, content: "I need access to Figma" },
      {
        role: "assistant" as const,
        content:
          "I've submitted an access request for **Figma** — request ID `INC-1042`, status `waiting_on_approval`.",
      },
    ];
    const res = await handleMessage("what's the status of that?", history);
    expect(res.intent).toBe("ticket_status");
    expect(res.entities.ticketId).toBe("INC-1042");
    expect(res.escalated).toBe(false);
    expect(res.answer).toMatch(/manager approval|waiting/i);
  });

  it("'any update?' as a bare follow-up pulls the ticket from history", async () => {
    const history = [
      { role: "user" as const, content: "I'm locked out" },
      {
        role: "assistant" as const,
        content:
          "I've opened account support ticket `ACC-2001` for you (status: `open`).",
      },
    ];
    const res = await handleMessage("any update?", history);
    expect(res.intent).toBe("ticket_status");
    expect(res.entities.ticketId).toBe("ACC-2001");
  });

  it("follow-up with no history falls through normally (no fake ticket extraction)", async () => {
    const res = await handleMessage("what's the status of that?", []);
    // No history means no ticket to reference. Should not invent one.
    expect(res.entities.ticketId).toBeUndefined();
  });
});
