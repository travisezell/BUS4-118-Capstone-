# Agent Handoff Flows

This document walks through how the four agents pass control to each other for each of the three IT flows the system supports. The handoff logic itself lives in `src/agents/orchestrator.ts` as a LangGraph `StateGraph` with conditional edges. This document is the human readable version of that state machine.

For each scenario we describe:

- The path through the graph (which agent runs in which order)
- The conditions that trigger each handoff
- What can go wrong at each step and what the system does about it

A glossary at the end defines the four agent roles and the shared `AgentState` they all read and write.

## The four agents in one paragraph

The Intake Agent classifies the user's message and pulls out entities. The Knowledge Agent retrieves relevant IT documentation from the Chroma vector store and synthesizes a grounded answer. The Workflow Agent decides whether a tool call is needed and runs it through the MCP server. The Escalation Agent gets the final say on whether the system should auto resolve or hand the request to a human. Every agent reads from and writes to a single shared `AgentState` object, so the orchestrator is the only thing that knows the full graph layout.

## Scenario 1: Access Help

The user wants access to a tool or app. Examples include "I need access to Figma" or "Can you set me up with Jira."

### Path through the graph

```
START
  |
  v
Intake Agent
  |
  v  (intent = access_help)
Knowledge Agent
  |
  v  (always)
Workflow Agent
  |
  v  (conditional)
[Escalation Agent]    OR    [Respond]
  |                            |
  v                            v
END                           END
```

### Step by step

**1. Intake.** The Intake Agent classifies the message as `access_help` if it sees access keywords like "access", "permission", "want to use", or "set me up with". It also tries to extract a tool name (Figma, Jira, GitHub, and so on from the known tools list, or any plausible identifier from the message text). Confidence is 0.90 if a tool name was extracted, 0.55 if the access intent is clear but no tool name was found.

**2. Knowledge.** Always runs after Intake for `access_help`. Embeds the user's message via OpenAI and queries Chroma for the top 3 chunks. The retrieval is biased toward access policy chunks. The Knowledge Agent synthesizes a grounded answer with source citations.

**3. Workflow.** Decides what to do based on what Intake extracted.

- If a tool name was extracted and there is no existing open request for that user and tool, the Workflow Agent calls `create_access_request(app_name, user_id)` through the MCP server. The handler in `src/data/tickets.ts` creates a new request and returns the request ID and status.
- If a tool name was extracted but there is already an open request for the same user and tool, the Workflow Agent does NOT create a duplicate. It returns the existing request ID and marks `data.duplicate = true` so the orchestrator can phrase the response as "you already have an open request" instead of confirming a new submission.
- If no tool name was extracted, the Workflow Agent flags `needsEscalation = true` with reason "Missing tool name for access request" and skips the tool call.

**4. Escalation.** Runs only if Workflow flagged escalation OR if Intake's confidence is below 0.50. For Access Help, the most common escalation trigger is a missing tool name. The Escalation Agent builds a structured handoff package (original message, intent, extracted entities, tools attempted, reason) and the orchestrator returns the escalation card to the user.

### What can go wrong

| Failure mode | What the system does |
|---|---|
| User does not name a tool | Escalation Agent asks the user (via the handoff message) to specify which tool they need |
| Tool name is captured but is not in the company catalog | Workflow still attempts the request; access policy retrieval may return weak matches; if confidence stays low the response is a best effort answer with appropriate caveats |
| User already has an open request for the same tool | Workflow detects the duplicate and surfaces the existing ticket ID instead of creating a second one |
| OpenAI or Chroma is unreachable | Knowledge falls back to keyword search on the in memory store; the response notes the degraded retrieval |

## Scenario 2: Account Help

The user has an account problem. Examples include "I'm locked out", "my password isn't working", "someone logged into my account from another country."

### Path through the graph

```
START
  |
  v
Intake Agent
  |
  v  (intent = account_help)
Knowledge Agent
  |
  v  (always)
Workflow Agent
  |
  v  (conditional)
[Escalation Agent]    OR    [Respond]
  |                            |
  v                            v
END                           END
```

### Step by step

**1. Intake.** The Intake Agent has two paths into `account_help`:

- **Standard path.** The message contains an account keyword like "locked", "password", "MFA", "sign in", "login is broken", and so on. Confidence 0.75.
- **Compromise short circuit.** If the Intake Agent detects any signal of account compromise (literal vocabulary like "compromised" or "hacked", OR natural language patterns like "from another country", "I didn't do it", "wasn't me", "unrecognized device"), it sets `entities.cause = "suspected_compromise"` and routes straight to `account_help` with confidence 0.90, regardless of which other keywords are or aren't present. This early exit happens before the normal keyword scoring so the system never misses a security signal because the user used the wrong vocabulary.

**2. Knowledge.** Always runs after Intake for `account_help`. Retrieves the lockout policy, password reset steps, MFA reset guidance, and the suspected compromise policy as relevant.

**3. Workflow.** The decision tree:

- If `cause == "suspected_compromise"`, always create an account ticket (P1 priority for security review) AND set `needsEscalation = true` with reason "Suspected compromise, flagged as high priority for security review."
- If the user explicitly asked for a ticket ("please open a ticket", "I want to file a ticket"), create the account ticket without escalating.
- Otherwise (routine lockout, forgot password, and so on), do NOT create a ticket. The Knowledge Agent's grounded self service steps are the response.

**4. Escalation.** Runs only when:

- `cause == "suspected_compromise"` (always escalates, even though we created a ticket)
- Intake confidence is below 0.50

For routine lockouts, the Escalation Agent does not run. The response is the grounded recovery steps from Knowledge.

### What can go wrong

| Failure mode | What the system does |
|---|---|
| User describes compromise without using the word | Compromise short circuit catches it via natural language patterns and routes to security ticket plus escalation |
| User describes a routine problem in vague terms ("my account is broken") | Intake classifies as account_help with 0.75 confidence; Knowledge returns generic recovery steps |
| User explicitly demands a ticket for a routine issue | Workflow creates the ticket as requested rather than forcing self service |
| MFA reset request | Knowledge surfaces the MFA reset section, which says IT must do it in person; system does NOT create a ticket because the policy is to come to the IT desk |

## Scenario 3: Ticket Status

The user wants to know the status of an existing ticket. Examples include "What's the status of INC-1042?" or "Any update on my request?"

### Path through the graph

```
START
  |
  v
Intake Agent
  |
  v  (intent = ticket_status . Knowledge node is SKIPPED)
Workflow Agent
  |
  v  (conditional)
[Escalation Agent]    OR    [Respond]
  |                            |
  v                            v
END                           END
```

This is the ONE flow where the Knowledge Agent is skipped. The Workflow Agent calls the ticket store, which returns structured data; the response is composed directly from that data, no document retrieval needed. This is implemented as a LangGraph conditional edge: `routeAfterIntake` returns `"workflow"` instead of `"knowledge"` when the intent is `ticket_status`. The result is noticeably lower latency on this path (typically under 10ms in tests, against 8 to 50ms for the other flows).

### Step by step

**1. Intake.** Two paths into `ticket_status`:

- **Strong path.** The message contains a recognizable ticket ID (INC, REQ, or ACC followed by digits). Confidence 0.95 with the ID extracted into `entities.ticketId`.
- **Weak path.** The message contains ticket related keywords ("status", "update", "where is my") but no ID. Confidence 0.75.

**2. Workflow.** Decides:

- If a ticket ID was extracted, call `get_ticket_status(ticket_id)` through MCP. Response is the structured ticket record.
- If the tool returns "not found", flag `needsEscalation = true` with reason "Ticket {id} not found." This triggers Escalation.
- If no ID was extracted, do not attempt a tool call; flag `needsEscalation = true` with reason "No ticket ID was provided." The Escalation Agent then asks the user to provide one.

**3. Escalation.** Runs only when:

- The ticket lookup failed (ID was provided but not found)
- No ticket ID was provided

For the happy path with a valid ID, no escalation. The orchestrator composes the response from the structured ticket data, including a plain language translation of the ticket state ("waiting on a manager approval" instead of `"waiting_on_approval"`) and a clear next step.

### What can go wrong

| Failure mode | What the system does |
|---|---|
| Ticket ID does not exist | Workflow tool returns ok = false; Escalation triggered with the failed lookup reason |
| User asks about ticket status without giving an ID | Workflow does not attempt a lookup; Escalation Agent asks the user for a ticket ID |
| User asks about a stale ticket | Tool returns the stale state; orchestrator surfaces the "ticket has been idle" message and offers to bump it |

## Cross cutting handoff principles

Three principles apply to all three flows.

**Single shared state.** The `AgentState` object is the only thing that crosses agent boundaries. There are no side channels. This is what lets each agent be tested in isolation, and what makes the LangGraph state machine readable.

**Escalation is the safety net, not the default.** The system always tries to auto resolve first. Escalation is a deliberate decision based on confidence, tool failure, or risky pattern detection. The Escalation Agent is the only agent that can mark the request as needing a human, and it does so with a structured handoff package so the human receives full context.

**Tools are MCP standard.** Every tool call by the Workflow Agent goes through the MCP server, not through direct function calls. The same server can be plugged into Claude Desktop, VS Code, or MCP Inspector with no code changes. Agents do not bypass the MCP layer.

## Glossary

| Term | Meaning |
|---|---|
| AgentState | Shared mutable record passed through the graph. Defined in `src/agents/types.ts`. |
| Intent | One of `access_help`, `account_help`, `ticket_status`, `general_qa`, `greeting`, `out_of_scope`, `unknown`. Set by Intake. |
| Entities | Extracted structured data from the user's message: tool name, ticket ID, account ID, cause, clarification needed flag. |
| Confidence | Intake's self assessment of classification quality, 0.0 to 1.0. Drives escalation logic. |
| Conditional edge | A LangGraph routing primitive that picks the next node based on a function of the current state. Used twice in our graph: after Intake and after Workflow. |
| Handoff package | The structured data the Escalation Agent sends to a human: original message, intent, entities, tools attempted, reason for escalation. |
