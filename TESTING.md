# Testing & Validation

This document summarizes how we test the system and which metrics we track.

---

## Goals

We want to demonstrate that our multi-agent IT support assistant:

- Classifies requests correctly.
- Retrieves relevant documentation.
- Runs workflows correctly when needed.
- Produces useful responses quickly.
- Escalates appropriately when it should not auto-resolve.[file:139][file:140]

---

## Test Types

1. **Unit Tests**
   - Intake classification
   - Knowledge retrieval logic
   - Workflow tool calls
   - Escalation decisions

2. **Scenario / Flow Tests**
   - End-to-end tests for each of the 3 primary flows.

---

## Test Scenarios

### Access Help (4 scenarios)

1. **Happy path** — user asks for access to a known tool.
   - Expect: `access_help` intent, correct policy retrieved, access request created or clear self-service steps.[file:139]

2. Missing tool name.
   - Expect: Intake asks clarifying question; no tool call until clarified.

3. Unsupported tool.
   - Expect: Clear “unsupported” response + optional escalation, no broken tool calls.

4. Duplicate request (user already has open request).
   - Expect: Reference to existing request rather than creating a new one.

### Account Help (4 scenarios)

1. **Happy path** — user reports locked account with standard cause.
   - Expect: `account_help` intent, correct recovery steps, resolve without ticket if steps succeed.[file:139]

2. User skipped self-service.
   - Expect: Assistant walks through steps first, only then offers ticket.

3. Unclear account (no system specified).
   - Expect: Clarification question; no teation until clarified.

4. Risky request (possible compromise).
   - Expect: Early escalation with clear explanation.

### Ticket Status (4 scenarios)

1. **Happy path** — user provides valid ticket ID.
   - Expect: status returned + plain-language explanation and next steps.[file:139][file:140]

2. Invalid ticket ID.
   - Expect: “Not found” message and suggestion to check ID or provide more info.

3. Multiple tickets match description.
   - Expect: Assistant lists candidates and asks which one to use.

4. Stale/blocked ticket.
   - Expect: Explanation that ticket is stalled and suggestion to follow up.

---

## Metrics

We compute:

- **Routing Accuracy** – % of requests where `intent` matches the expected flow.
- **Retrieval Hit Rate** – % of answers where a relevant document snippet was used.
- **Auto-Resolve Rate** – % of requests resolved without escalation.
- **Average Latency** – average time from user message to response.
- **Escalation Rate** – % of requests escalated to human IT.140]

---

## How to Run Tests

Example commands (adjust to your setup):

```bash
npm run test          # unit + scenario tests
npm run test:watch    # watch mode during development
npm run test:coverage # coverage report
```

End-to-end flow tests should be grouped in something like `tests/scenarios.test.ts` and cover one happy path plus edge cases per flow.[file:140]

