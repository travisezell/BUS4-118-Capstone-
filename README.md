# Group 5 · Multi-Agent IT Support Assistant

**BUS 118S Capstone Project**

An AI-powered internal IT support assistant that combines a multi-agent
architecture, retrieval-augmented generation (RAG) over real IT
documentation, and Model Context Protocol (MCP) tools to resolve common
IT requests through a single chat interface.

---

## Problem

For everyday IT issues, employees bounce between multiple systems —
searching a wiki, trying a portal, and finally opening a ticket — even
when the answer already exists in documentation. This creates long
queues, duplicate tickets, and repetitive work for IT staff on highly
repeatable problems: access requests, account lockouts, and ticket
status questions.

Our system provides one front door: the user describes their problem in
chat, the assistant understands the request, retrieves the relevant IT
documentation, and either guides them through self-service or triggers a
support action (submit a request, open a ticket, look up status) before
escalating to a human only when needed.

---

## What we built

A 4-agent pipeline wired together by an orchestrator, with real RAG and
real MCP tool integration.

| Agent | Responsibility |
|---|---|
| **Intake** | Classifies the user message into one of `access_help`, `account_help`, `ticket_status`, `general_qa` and extracts entities (tool name, ticket ID, account, cause). |
| **Knowledge** | RAG over IT documentation — embeds the query with OpenAI, retrieves top-k chunks from Chroma, synthesizes a grounded answer with citations to the source markdown files. |
| **Workflow** | Calls IT tools (`create_access_request`, `create_account_ticket`, `get_ticket_status`, `update_ticket_with_note`) through a real MCP server. |
| **Escalation** | Decides when not to auto-resolve. Builds a structured handoff (original message + extracted entities + what was tried + reason) for human IT. |

Three IT flows are fully implemented end-to-end (access help, account
help, ticket status), plus a knowledge-only Q&A path for general IT
questions like Wi-Fi setup and password rules.

---

## Architecture

```
                                 ┌─────────────────────┐
                                 │   Chat UI (Next.js) │
                                 └──────────┬──────────┘
                                            │
                                ┌───────────▼───────────┐
                                │     Orchestrator      │
                                │  (conditional routing │
                                │  on intent + conf.)   │
                                └───────────┬───────────┘
                                            │
              ┌─────────────────────────────┼────────────────────────────┐
              │                             │                            │
       ┌──────▼─────┐               ┌───────▼──────┐             ┌───────▼──────┐
       │  Intake    │               │  Knowledge   │             │  Workflow    │
       │  Agent     │               │  Agent       │             │  Agent       │
       └────────────┘               └──────┬───────┘             └──────┬───────┘
                                           │                            │
                                  ┌────────▼────────┐          ┌────────▼────────┐
                                  │  Vector Store   │          │   MCP Server    │
                                  │   (Chroma)      │          │  (stdio + SDK)  │
                                  └────────┬────────┘          └────────┬────────┘
                                           │                            │
                                  ┌────────▼────────┐          ┌────────▼────────┐
                                  │  OpenAI         │          │ 4 IT support    │
                                  │  Embeddings     │          │ tools           │
                                  └─────────────────┘          └─────────────────┘

         ┌──────────────────────────────────┐
         │   Escalation Agent  (final gate) │
         └──────────────────────────────────┘
```

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for component-level
detail and message flow.

---

## Demo flows

| Prompt | Outcome |
|---|---|
| `I need access to Figma for the design review` | Detects existing open request, cites Figma access policy, does **not** create a duplicate. |
| `I'm locked out of my account` | Returns self-service recovery steps from the lockout policy. No ticket needed. |
| `What's the status of INC-1042?` | Calls `get_ticket_status` via MCP, returns "waiting on manager approval" with a clear next step. |
| `Someone logged into my account from another country and I didn't do it` | Detects suspected compromise (no literal "compromised" word required), opens a P1 account ticket, escalates to Security. |

Each response includes intent, confidence, latency, and source citations
to the exact markdown section that grounded the answer.

---

## Features

- ✅ Multi-agent orchestration via LangGraph `StateGraph` (Intake → Knowledge → Workflow → Escalation) with conditional edges based on intent + confidence
- ✅ Real RAG: OpenAI embeddings (`text-embedding-3-small`) + Chroma vector store
- ✅ Real MCP integration via the official `@modelcontextprotocol/sdk` over stdio (works with Claude Desktop, MCP Inspector, etc.)
- ✅ 4 working IT tools: access requests, account tickets, ticket status, ticket updates
- ✅ Grounded answers with source citations to `docs/kb/*.md`
- ✅ Escalation Agent with structured handoff to human IT
- ✅ 13 vitest scenario tests, all passing
- ✅ Pluggable LLM provider — swap OpenAI for Gemini/Ollama with no agent code changes
- ✅ Health and metrics endpoints (`/api/health`, `/api/metrics`)

---

## Quick start

### Prerequisites

- Node.js 20+
- (For real RAG) Docker Desktop running + an OpenAI API key

### Path A — mock mode (no API key, no Chroma)

```bash
git clone https://github.com/travisezell/BUS4-118-Capstone-.git
cd BUS4-118-Capstone-
npm install
npm test           # 13/13 scenarios should pass
npm run dev
```

Visit `http://localhost:3000`. Agents run with deterministic mocks so
you can verify the orchestration without spending API credits.

### Path B — real RAG (OpenAI + Chroma)

```bash
# 1. Install + start Chroma
npm install
docker compose up -d

# 2. Configure environment
cp .env.example .env.local
# then edit .env.local and set:
#   LLM_PROVIDER=openai
#   OPENAI_API_KEY=sk-...
#   VECTOR_STORE=chroma
#   CHROMA_URL=http://localhost:8000

# 3. Load IT docs into Chroma (load → chunk → embed → store)
npm run ingest

# 4. Run the dev server
npm run dev
```

Verify the stack is wired up at `http://localhost:3000/api/health`:

```json
{
  "ok": true,
  "llm":         { "provider": "openai", "chatModel": "gpt-4o-mini", "embeddingModel": "text-embedding-3-small" },
  "vectorStore": { "backend": "chroma",  "chromaUrl": "http://localhost:8000" },
  "mcpTools":    ["create_access_request", "create_account_ticket", "get_ticket_status", "update_ticket_with_note"]
}
```

> **Cost check:** ingestion is ~$0.0001. A 50-prompt demo costs ~$0.01.
> $5 of OpenAI credits is more than enough.

---

## Project structure

```
app/
  api/
    chat/route.ts          # Main chat endpoint — orchestrates the 4 agents
    tickets/route.ts       # List tickets
    tickets/[id]/route.ts  # Read a single ticket
    metrics/route.ts       # Aggregate metrics endpoint
    health/route.ts        # Reports active LLM / vector store / MCP tools
  page.tsx                 # Chat UI with intent + confidence + sources display
  layout.tsx               # Root layout
  globals.css              # Tailwind + theme

src/
  agents/
    types.ts               # Shared agent state + types
    intake.ts              # Intent classification + entity extraction
    knowledge.ts           # RAG retrieval + grounded answer synthesis
    workflow.ts            # Tool calls via MCP server
    escalation.ts          # Human handoff logic
    orchestrator.ts        # Routes a message through the 4 agents
  lib/
    llm.ts                 # LLMProvider interface + MockProvider + OpenAIProvider
    vector-store.ts        # VectorStore interface + InMemoryVectorStore + ChromaVectorStore
    metrics.ts             # In-memory metrics logger
  mcp/
    tools.ts               # 4 IT tool definitions (name, schema, handler)
    server.ts              # In-process server + StdioMCPClient (real MCP)
  data/
    knowledge-base.ts      # Default in-memory KB (used in mock mode)
    tickets.ts             # In-memory ticket store with seeded scenarios

tests/
  scenarios.test.ts        # 13 end-to-end scenarios

scripts/
  ingest.ts                # Loads docs/kb/*.md → chunks → embeds → Chroma
  mcp-server.ts            # Standalone MCP server (stdio transport)

docs/
  ARCHITECTURE.md          # Component-level detail
  TESTING.md               # 13 test scenarios documented
  SCALING.md               # Vendor research (Moveworks, ServiceNow Now Assist)
  kb/                      # Source IT documentation (markdown)
    access-policies.md
    account-guidance.md
    ticket-faqs.md
    general-it-faqs.md

docker-compose.yml         # Chroma service for local development
.env.example               # Environment variable template
```

---

## Testing

```bash
npm test            # run all 13 scenarios
npm run test:watch  # watch mode
```

The test suite covers:

- **Access help** (4 scenarios): happy path, missing tool name, unsupported tool, duplicate request
- **Account help** (5 scenarios): standard lockout, skip-self-service, unclear, suspected compromise (vocabulary), suspected compromise (natural-language phrasing)
- **Ticket status** (4 scenarios): valid ID, invalid ID, no ID, stale ticket

See [`docs/TESTING.md`](docs/TESTING.md) for scenario-level detail.

Tests run against the mock providers so they pass on a fresh clone with
no API key — that's intentional, the real RAG path is reserved for the
live demo.

---

## Metrics

The system tracks (PRD §13):

| Metric | Target | Current (test suite) |
|---|---|---|
| Routing accuracy | ≥85% | 100% |
| Retrieval hit rate | ≥80% | 71% |
| Auto-resolve rate | ≥60% | 64% |
| Average latency | <5s | <1ms (mock) / ~500ms (OpenAI) |
| Escalation rate | — | 36% |

Live metrics from `/api/metrics`.

---

## Tech stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16 + React 19 |
| Orchestration | LangGraph `@langchain/langgraph` (StateGraph with conditional edges) |
| LLM | OpenAI `gpt-4o-mini` (chat) + `text-embedding-3-small` (embeddings) |
| Vector store | Chroma 0.5 |
| Tool layer | Model Context Protocol (`@modelcontextprotocol/sdk`) over stdio |
| Tests | Vitest |
| Styling | Tailwind CSS v4 |
| Container | Docker Compose (Chroma) |

---

## Design trade-offs

A few decisions worth knowing about — these are honest engineering
trade-offs, not gaps:

- **LangGraph for orchestration.** The Intake → Knowledge → Workflow →
  Escalation pipeline is wired together in a real `@langchain/langgraph`
  `StateGraph` with conditional edges. Routing decisions (e.g.
  `ticket_status` skips Knowledge; low-confidence `unknown` jumps
  straight to Escalation) are expressed declaratively as
  `addConditionalEdges` rather than buried inside `if`/`else`. The
  agents themselves are pure functions over `AgentState`, so any one of
  them could be replaced — say, swapping our rule-based Intake for an
  LLM-based one — without touching the graph.
- **Rule-based intent classifier vs LLM-based.** Intake uses regex +
  keyword + phrase matching for fast, free, deterministic
  classification. Failure mode: novel phrasings that don't match our
  patterns (we hit one — see commit history for the
  "from another country" fix). Mitigation: pattern expansion. Next
  iteration: route Intake through `gpt-4o-mini` for ~50ms latency at
  ~$0.0001/query.
- **In-memory ticket store vs real ITSM.** Tickets live in a `Map<>` on
  the server. Restarts wipe state. For the prototype this is fine —
  swapping for a real ITSM (Jira, ServiceNow) is a single file change in
  `src/data/tickets.ts` because everything goes through the
  ticket-service interface.
- **Blended cosine + keyword retrieval.** The in-memory vector store
  blends 60% cosine similarity with 40% keyword overlap so retrieval
  ranks reasonably even when embeddings are weak (mock mode). Real RAG
  on OpenAI embeddings doesn't need the keyword fallback — but we kept
  it because it cheap-defends against query/document vocabulary mismatch.

---

## Vendor research

We compared two industry incumbents to inform our scope and design
choices. Full notes in [`docs/SCALING.md`](docs/SCALING.md).

- **Moveworks** — purpose-built employee-IT assistant. Validated our
  4-agent decomposition and the
  intake → knowledge → workflow → escalation pipeline. Their tier-based
  escalation model influenced our Tier 1 / Tier 2 / Security split.
- **ServiceNow Now Assist** — generative AI layer on top of an ITSM.
  Validated MCP-style tool calling for ticket actions and reinforced
  that grounding answers in your own knowledge base (rather than open
  web) is what makes IT assistants trustworthy.

---

## Team

Group 5 — BUS 118S Capstone, May 2026.

---

## License

For coursework purposes. Not licensed for production use.
