# Testing & Validation

This document summarizes how we test the system and the metrics we report. It maps to PRD §13 (Success Metrics) and §14 (Validation & Testing Plan).

---

## Goals

We want to demonstrate that our multi-agent IT support assistant:

- Classifies requests correctly (≥ 85% routing accuracy).
- Retrieves relevant documentation (≥ 80% retrieval hit rate).
- Runs workflows correctly when needed.
- Produces useful responses quickly (< 5 s for non-tool responses).
- Escalates appropriately when it should not auto-resolve.

---

## Test Types

1. **Unit tests** — `tests/scenarios.test.ts` covers each agent's contract:
   - Intake classification + entity extraction.
   - Knowledge retrieval logic.
   - Workflow tool calls.
   - Escalation decisions.

2. **Scenario / flow tests** — end-to-end through the orchestrator for each of the three flows.

---

## 12 Test Scenarios

Four scenarios per flow.

### Access Help (4 scenarios)

1. **Happy path.** User asks for access to a known tool.
   - Expect: `access_help` intent, correct policy retrieved, access request created or clear self-service steps.
2. **Missing tool name.** User says "I need access" without naming the tool.
   - Expect: Intake asks a clarifying question; no tool call until clarified.
3. **Unsupported tool.** Tool is not in the policy KB.
   - Expect: Clear "unsupported" response and an escalation, no broken tool call.
4. **Duplicate request.** User already has an open access request for the same tool.
   - Expect: Reference to the existing request rather than a new one.

### Account Help (4 scenarios)

1. **Happy path.** User reports a locked account with a standard cause.
   - Expect: `account_help` intent, correct recovery steps, resolves without a ticket if the steps succeed.
2. **Skipped self-service.** User explicitly wants a ticket immediately.
   - Expect: Assistant walks through steps once, then creates the ticket with the context attached.
3. **Unclear account.** User does not specify which account/system.
   - Expect: Clarification question; no tool call until clarified.
4. **Risky request.** Suspected compromise.
   - Expect: Early escalation with clear explanation and high priority flag.

### Ticket Status (4 scenarios)

1. **Happy path.** User provides a valid ticket ID.
   - Expect: Status returned plus a plain-language explanation and next steps.
2. **Invalid ticket ID.** ID does not exist.
   - Expect: "Not found" message with a suggestion to check the ID.
3. **Multiple matches.** Description matches several open tickets.
   - Expect: Assistant lists candidates and asks which one to use.
4. **Stale or blocked ticket.** Ticket has not moved in days.
   - Expect: Explanation that the ticket is stalled and an offer to add a follow-up note.

---

## Metrics

We compute:

- **Routing accuracy** — % of requests where `intent` matches the expected flow. Target ≥ 85%.
- **Retrieval hit rate** — % of answers grounded on a relevant doc chunk. Target ≥ 80%.
- **Auto-resolve rate** — % of requests resolved without escalation. Target ≥ 60%.
- **Average latency** — average time from user message to response. Target < 5 s for non-tool responses.
- **Escalation rate** — % of requests escalated. Reported, not optimized down (honest escalation is a feature).

Per-flow metrics are also tracked:

- **Access:** routing accuracy, retrieval hit rate, request completion rate, average response time.
- **Account:** routing accuracy, guided-resolution rate, ticket-creation success rate, average response time.
- **Ticket Status:** routing accuracy, lookup success rate, qualitative explanation clarity, average response time.

---

## How to Run Tests

```bash
npm test            # all unit + scenario tests
npm run test:watch  # watch mode
```

Live metrics during a session are exposed at `GET /api/metrics`.

End-to-end scenario tests live in `tests/scenarios.test.ts` and cover one happy path plus three edge cases per flow.

---

## Test Output Format

Each scenario produces a structured result for the rubric submission:

```json
{
  "scenarioId": "access-1",
  "expectedIntent": "access_help",
  "actualIntent": "access_help",
  "routingCorrect": true,
  "retrievalHit": true,
  "toolCalled": "create_access_request",
  "escalated": false,
  "latencyMs": 412,
  "pass": true
}
```

The aggregate report (computed in `tests/scenarios.test.ts`) is the artifact we cite for PRD §13.
