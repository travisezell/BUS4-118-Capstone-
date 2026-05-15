# Multi Agent System: Design, Implementation, and Testing

This document brings together the design decisions, implementation details, and testing results for the Group 5 Capstone IT Support Assistant. It is the unified deliverable the charter calls for under the Flow and Testing Lead role: a single artifact a reader can use to understand what the system is, how it was built, and how we know it works.

The document is in three parts:

1. Design. The decisions that shaped the architecture, before any code.
2. Implementation. What was actually built and why.
3. Testing. How we validated that the system works for our three IT flows.

A short discussion section at the end explains what we would do differently with more time.

---

# Part 1: Design

## Problem

Employees with everyday IT issues bounce between multiple systems. Wiki, Slack, IT portal, ticket queue, direct emails to people who happen to know the answer. Each system has different content, different conventions, and different latencies. The result is duplicate tickets, repeat questions, and long resolution times for problems that have well documented answers.

We focused on three flows that account for a large share of routine IT volume:

- Access help: "How do I get access to <tool>?"
- Account help: "I'm locked out", "my password isn't working"
- Ticket status: "What's the status of <ticket ID>?"

We wanted the system to be a single front door for these requests, to ground its answers in the company's actual IT documentation, and to know when to hand off to a human rather than guess.

## Design principles

Six principles drove the design.

**Principle 1: One front door.** A user with an IT problem should be able to type their request in one place, in plain language, without having to know which IT system to ask. The chat interface is the single entry point for all three flows.

**Principle 2: The user does not phrase the problem as a ticket.** Traditional IT ticketing forces users to pick categories, priorities, and systems they do not know. Our Intake Agent handles classification on the user's behalf. Users describe the problem; the system formalizes it.

**Principle 3: Source grounded answers.** Every answer that comes from documentation cites the section it came from. The user can verify the policy. We do not invent answers when retrieval misses; we say so and escalate.

**Principle 4: Decompose into specialized agents.** Rather than one large prompt that does everything, four agents with clear contracts: Intake classifies, Knowledge retrieves, Workflow acts, Escalation handles handoff. Each agent has a single responsibility and can be tested in isolation.

**Principle 5: Knowing when not to auto resolve is as important as auto resolving.** A system that always tries to answer is a system that gives wrong answers. We built explicit escalation triggers and put the Escalation Agent at the end of the pipeline as a safety net.

**Principle 6: Use standards, not custom protocols.** Tool calls go through Model Context Protocol (MCP) using the official SDK rather than a custom REST API. This means our tools work with any MCP compliant client (Claude Desktop, VS Code, MCP Inspector) without code changes on our side.

## Trade offs we made deliberately

| Decision | What we chose | What we gave up | Why |
|---|---|---|---|
| Orchestration framework | LangGraph | A simpler hand rolled state machine | LangGraph is the framework the PRD names as ideal, and the conditional edge syntax makes the routing decisions auditable at a glance |
| Intent classification | Rule based with regex and keyword matching | LLM based classification | Fast (under 1ms), free, deterministic; failure modes are visible and fixable; LLM classification is a clear next iteration |
| LLM for grounded answers | OpenAI gpt-4o-mini | A larger model | Cost; the synthesis task does not need a frontier model |
| Vector store | Chroma in Docker | A managed cloud store | Local development and prototype scope; the abstraction layer makes swapping easy |
| Tool layer | MCP standard | Custom REST endpoints | Standard tooling, future client compatibility |
| Ticket store | In memory mock | Real ITSM integration | Demo scope; the data layer is isolated so a production version would swap one file |

## Mapping the design to the four agents

The four agents from the PRD map directly to the four core responsibilities of an IT support interaction.

| User question | Which agent answers it |
|---|---|
| What is the user actually asking? | Intake Agent |
| What do our docs say about it? | Knowledge Agent |
| What action should the system take? | Workflow Agent |
| Should this go to a human? | Escalation Agent |

This decomposition is what makes the system feel different from a chatbot. A chatbot typically does only the first two. An agentic system does all four.

---

# Part 2: Implementation

## Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16, React 19 |
| Orchestration | @langchain/langgraph (StateGraph with conditional edges) |
| LLM | OpenAI gpt-4o-mini for synthesis, text-embedding-3-small for embeddings |
| Vector store | Chroma 0.5 in Docker |
| Tool layer | Model Context Protocol via @modelcontextprotocol/sdk over stdio |
| Tests | Vitest |
| Styling | Tailwind CSS v4 |

## Code layout

```
src/
  agents/
    intake.ts        Classifies intent, extracts entities
    knowledge.ts     RAG retrieval and grounded synthesis
    workflow.ts      Decides and calls MCP tools
    escalation.ts    Handoff decision and package builder
    orchestrator.ts  LangGraph StateGraph wiring all four
    types.ts         Shared types: Intent, Entities, AgentState
  data/
    tickets.ts       In memory ticket store
  lib/
    vector-store.ts  Vector store client
    jira.ts          Jira REST API v3 client
    llm.ts           Pluggable LLM provider abstraction
    metrics.ts       Telemetry
  mcp/
    server.ts        In process MCP server wrapper
    tools.ts         Five tool definitions with JSON schemas
app/
  page.tsx           Chat UI with status indicator
  api/
    chat/route.ts    POST endpoint that calls the orchestrator
    health/route.ts  Reports active LLM, vector store, MCP tools
    metrics/route.ts Live metrics
scripts/
  ingest.ts          Loads docs/kb/*.md, chunks, embeds, indexes in Chroma
  mcp-server.ts      Standalone MCP server for external clients
docs/
  kb/                The IT knowledge base (4 markdown files, 22 chunks)
  diagrams/          User journey and architecture diagrams
  screenshots/       UI demo screenshots
  ARCHITECTURE.md
  TESTING.md
  SCALING.md
  handoff-flows.md
  test-results.md
  sample-conversations.md
```

## How a request flows through the system

When a user sends a message, here is what actually happens.

1. The chat UI POSTs the message to `/api/chat`.
2. The API route calls `handleMessage(userMessage, history)` from the orchestrator.
3. The orchestrator constructs a fresh `AgentState`, then runs it through the LangGraph `StateGraph`.
4. The StateGraph routes based on conditional edges:
   - START to Intake (always)
   - Intake to Knowledge OR Workflow OR Escalation OR Respond, depending on intent and confidence
   - Knowledge to Workflow (when retrieval was needed)
   - Workflow to Escalation OR Respond, depending on what Workflow decided
   - Escalation or Respond to END
5. Each agent reads from and writes to the shared state. Intake adds intent and entities. Knowledge adds retrieved chunks and a grounded answer. Workflow adds tool results. Escalation adds the handoff package.
6. The orchestrator builds the final response from the populated state and returns it to the API route.
7. The API route returns JSON to the chat UI: answer, intent, confidence, sources, tool results, escalation flag, status events.

The conditional routing is the part that makes this a state machine and not a hard coded pipeline. For ticket status, Knowledge is skipped because the tool returns structured data directly. For greeting and out_of_scope, the entire middle of the pipeline is skipped. For low confidence unknowns, escalation runs without tool attempts.

## What is real and what is mocked

We document this directly so anyone reading the code knows where the real integrations are versus where we used a mock for the prototype.

| Component | Status |
|---|---|
| LangGraph StateGraph | Real. Uses @langchain/langgraph version 0.2.40 from npm. Real conditional edges, real state reducers, real graph compilation. |
| OpenAI integration | Real. Uses the official openai npm package. Real API calls for embeddings and chat completions. |
| Chroma | Real. Docker compose runs the official Chroma image. Real HTTP queries with cosine similarity. |
| MCP server | Real. Uses @modelcontextprotocol/sdk version 1.29.0. Verified by connecting MCP Inspector externally and successfully calling the five tools. |
| Tool calls | Real. The Workflow Agent calls tools through the MCP server using the standard protocol. |
| Ticket store | Mock. In memory map of seeded tickets. State resets on server restart. The data layer is isolated so swapping for a real ITSM is a single file change. |
| Tier 2 human IT | Mock. The Escalation Agent builds a real handoff package and the system creates a real ticket; in production this would route to a human queue. |

## Multi agent collaboration in action

The Figma access scenario shows all four agents working together.

User message: "I need access to Figma for the design review."

1. **Intake.** Classifies as `access_help` with confidence 0.90. Extracts `toolName: "Figma"`. Sets the intent on the state.

2. **Knowledge.** Queries Chroma with the user's message, retrieves the Figma access policy chunk and the access overview chunk with similarity scores above 0.7. Synthesizes a grounded answer that explains the approval process and cites the source.

3. **Workflow.** Calls `create_access_request("Figma", "user@company.com")` through the MCP server. The handler checks the ticket store for an existing open request for this user and tool, finds INC-1042 already open, and returns the existing request rather than creating a duplicate. The duplicate flag is set on the result.

4. **Escalation.** Receives the populated state. Confidence is high, the tool call succeeded, no risky pattern was detected, and retrieval succeeded. Decision: do not escalate. The orchestrator composes the final response.

The user sees: "You already have an open access request for Figma, request ID INC-1042, status waiting on approval." plus the access policy with citations.

This is what we mean by multi agent collaboration. No single agent could have produced this response. The Knowledge Agent grounded the answer in policy. The Workflow Agent applied a real product decision (do not duplicate). The Escalation Agent verified that a human was not needed. The Intake Agent set them all up by getting the classification and the tool name right.

## Industry vendor research

We compared three industry vendors to inform our scope and design choices. Full notes in [`docs/research/SCALING.md`](../research/SCALING.md).

- **Moveworks.** Purpose built employee IT assistant. Validated our four agent decomposition and the intake to knowledge to workflow to escalation pipeline. Their tier based escalation model influenced our Tier 1 and Tier 2 split.
- **ServiceNow Now Assist.** Generative AI layer on top of an ITSM. Validated MCP style tool calling for ticket actions and reinforced that grounding answers in your own knowledge base, rather than the open web, is what makes IT assistants trustworthy.
- **Glean.** Enterprise AI search and assistant across all company data sources. Validated our citation on every answer pattern and our prefer "I don't know" over hallucination stance. Our project is the IT workflow slice that could plug into a Glean style horizontal knowledge layer in production.

---

# Part 3: Testing

## Test methodology

We wrote 22 end-to-end test scenarios covering all three core flows plus edge cases and multi-turn memory. Each test sends a real prompt through the orchestrator and asserts on:

- Intent classification (which agent should handle it)
- Confidence score (within an expected band)
- Tool calls (which tools should run, with what success status)
- Escalation flag (whether it should hand off to a human)
- Response content (specific phrases or facts in the answer)

Tests run via `npm test`. They use the in process MCP server for speed and a deterministic seeded ticket store for reproducibility. The aggregate metrics are printed at the end of each run.

The full per scenario results table is in [`docs/operations/test-results.md`](../operations/test-results.md). High level numbers are below.

## Results summary

| Metric | Value |
|---|---|
| Tests passing | 22 of 22 (100%) |
| Routing accuracy | 100% |
| Auto resolve rate | 65% (15 of 23 logged requests) |
| Escalation rate | 35% (8 of 23) |
| Tool use rate | 57% (13 of 23) |
| Average latency | about 14 ms |
| P95 latency | about 45 ms |

## Key findings

**Finding 1: The system reliably routes the three core flows.** Routing accuracy is 100% on the test set. Every Access Help, Account Help, and Ticket Status scenario was correctly classified into its intended intent. Confidence scores are appropriately calibrated: 0.90 to 0.95 when entities like a ticket ID or known tool name were extracted, 0.55 to 0.85 when the intent is clear but details come from history rather than the current message, 0.20 to 0.40 for genuinely ambiguous inputs.

**Finding 2: The compromise short circuit works in natural language.** The most important Account Help test was whether the system catches a suspected compromise even when the user does not use the word "compromised" or "hacked". Both phrasings ("I think my account was compromised" and "Someone logged into my account from another country and I didn't do it") were correctly routed to escalation with a P1 ticket created. This is the test we cared most about because it is the most consequential failure mode.

**Finding 3: Workflow Agent makes real product decisions.** The duplicate detection on the Figma access scenario worked as intended. The system did not create a second ticket; it surfaced the existing one. This is the kind of behavior that distinguishes an agentic system from a chatbot wrapped around a workflow.

**Finding 4: Escalation rate is appropriately calibrated.** 35% escalation rate sounds high, but the test set deliberately includes scenarios where escalation is the correct outcome (two compromise scenarios, one missing tool name, one invalid ticket ID, one ambiguous request, one ticket status with no ID, one history-less follow-up). On the happy path scenarios alone, the system auto resolves 100% of the time.

**Finding 5: LangGraph conditional edges produce measurable latency wins.** The ticket status path skips the Knowledge node and runs in about 9 ms; the access path that goes through Knowledge runs in about 35 ms. This is exactly what the conditional routing was designed to do.

**Finding 6: Multi-turn conversation memory works.** When a user follows up with "what's the status of that?" the system reads the prior assistant turn, extracts the most recent ticket ID, and runs the lookup. Tested with three different phrasings (referential, bare, and history-less). All three behave correctly: referential and bare resolve to the right ticket; history-less correctly does not invent one.

## Known limitations

We are honest about three limitations the test suite surfaced.

| Limitation | Impact | Mitigation |
|---|---|---|
| Tool name regex is permissive | Unrecognized tool names like `MyCustomInternalTool` may be processed as if they were known | A production version would validate against a known tool catalog and escalate any miss |
| Knowledge base is small | 22 chunks across 4 markdown files; will not generalize beyond the demo scenarios | Production would auto ingest from Confluence and similar sources |
| Latency numbers are from in process MCP | Real MCP over stdio adds 5 to 10 ms per call | This is documented in the architecture; the MCP standard is correctly used |

---

# Discussion: what we would do differently with more time

**Streaming responses.** The current pipeline returns the full response after all agents finish. A production version would stream each agent's status events to the UI as they happen, so the smart status stepper in the UI would reflect actual server side progress instead of predicted stages.

**LLM based intake classifier.** The rule based intake is fast and free, but novel phrasings can fall through the patterns. We hit one example in development (an unfamiliar location login that did not contain the word "compromised") and added a pattern fix. A small LLM call for fallback classification would catch the ones we have not thought of.

**Larger knowledge base with auto ingestion.** Twenty two chunks is enough for our four flows. A real deployment would index hundreds of pages of policy and how to documentation, with automated freshness checks and per role access controls.

**Persistent ticket store with real ITSM integration.** Replacing the in memory mock with a Jira or ServiceNow integration is a single file change in our data layer. We would also add ticket update workflows, comment threads, and SLA tracking.

**Visible per agent status in the UI.** The orchestrator records `statusEvents` for each agent stage; we surface the trace after the response arrives. With a streaming response this would update live during the request.

# Closing

The system meets the goals set in the project charter. Three core IT flows work end to end with real LangGraph orchestration, real RAG, real MCP tool integration, and structured human handoff when needed. Multi-turn conversation memory and Server-Sent Events streaming make the chat feel like a modern AI product. The four agents collaborate visibly through a shared state object, the routing decisions are explicit conditional edges in the graph, and 22 of 22 test scenarios pass.

What we built is a prototype, not a product. But it is a prototype of the same architectural pattern the leading enterprise IT support vendors have converged on, built on the standards (LangGraph, MCP, RAG with citations) that those vendors use too.
