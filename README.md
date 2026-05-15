# Group 5 · Multi-Agent IT Support Assistant

**BUS 118S Capstone Project**

An AI-powered internal IT support assistant that combines a multi-agent architecture, retrieval-augmented generation (RAG) over real IT documentation, and Model Context Protocol (MCP) tools to resolve common IT requests through a single chat interface.

---

## Problem

For everyday IT issues, employees bounce between multiple systems. Searching a wiki, trying a portal, and finally opening a ticket, even when the answer already exists in documentation. This creates long queues, duplicate tickets, and repetitive work for IT staff on highly repeatable problems: access requests, account lockouts, and ticket status questions.

Our system provides one front door: the user describes their problem in chat, the assistant understands the request, retrieves the relevant IT documentation, and either guides them through self-service or triggers a support action (submit a request, open a ticket, look up status) before escalating to a human only when needed.

---

## What we built

A 4-agent pipeline wired together by a LangGraph orchestrator, with real RAG and real MCP tool integration.

| Agent | Responsibility |
|---|---|
| **Intake** | Classifies the user message into one of seven intents (`access_help`, `account_help`, `ticket_status`, `general_qa`, `greeting`, `out_of_scope`, `unknown`) and extracts entities (tool name, ticket ID, account, cause). |
| **Knowledge** | RAG over IT documentation. Embeds the query with OpenAI, retrieves top-k chunks from Chroma, synthesizes a grounded answer with citations to the source markdown files. |
| **Workflow** | Calls IT tools (`create_access_request`, `create_account_ticket`, `get_ticket_status`, `update_ticket_with_note`, `search_tickets`) through a real MCP server. |
| **Escalation** | Decides when not to auto-resolve. Builds a structured handoff (original message + extracted entities + what was tried + reason) for human IT. |

Three IT flows are fully implemented end-to-end (access help, account help, ticket status), plus a knowledge-only Q&A path for general IT questions like Wi-Fi setup and password rules.

---

## Architecture

```
                                 ┌─────────────────────┐
                                 │   Chat UI (Next.js) │
                                 └──────────┬──────────┘
                                            │
                                ┌───────────▼───────────┐
                                │  LangGraph Orchestrator│
                                │   (StateGraph with     │
                                │   conditional edges)   │
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
                                  │  OpenAI         │          │ 5 IT support    │
                                  │  Embeddings     │          │ tools           │
                                  └─────────────────┘          └─────────────────┘

         ┌──────────────────────────────────┐
         │   Escalation Agent  (final gate) │
         └──────────────────────────────────┘
```

See [`docs/architecture/ARCHITECTURE.md`](docs/architecture/ARCHITECTURE.md) for component-level detail and message flow. A polished slide-ready diagram is in [`docs/diagrams/architecture.png`](docs/diagrams/architecture.png).

---

## Demo flows

| Prompt | Outcome |
|---|---|
| `I need access to Figma for the design review` | Detects existing open request, cites Figma access policy, does **not** create a duplicate. |
| `I'm locked out of my account` | Returns self-service recovery steps from the lockout policy. No ticket needed. |
| `What's the status of INC-1042?` | Calls `get_ticket_status` via MCP, returns "waiting on manager approval" with a clear next step. |
| `Any update on my Figma ticket?` | No ticket ID provided. Workflow calls `search_tickets` with the keyword "Figma" and finds the open request. |
| `Someone logged into my account from another country and I didn't do it` | Detects suspected compromise (no literal "compromised" word required), opens a P1 account ticket, escalates to Security. |

Each response includes intent, confidence, latency, and source citations to the exact markdown section that grounded the answer.

---

## Features

- Multi-agent orchestration via LangGraph `StateGraph` (Intake → Knowledge → Workflow → Escalation) with conditional edges based on intent and confidence
- Real RAG with OpenAI embeddings (`text-embedding-3-small`) and Chroma vector store
- Real MCP integration via the official `@modelcontextprotocol/sdk` over stdio (works with Claude Desktop, MCP Inspector, etc.)
- 5 working IT tools: access requests, account tickets, ticket status, ticket updates, ticket search
- Grounded answers with source citations to `docs/kb/*.md`
- Escalation Agent with structured handoff to human IT
- Multi-turn conversation memory (referential follow-ups like "what's the status of that?" resolve to the prior ticket)
- Server-Sent Events streaming with real per-agent status events and word-by-word answer delivery
- 22 vitest scenario tests, all passing
- Per-flow metrics tracked separately for each of the three core flows
- Health and metrics endpoints (`/api/health`, `/api/metrics`)

---

## Quick start

### Prerequisites

- Node.js 20+
- (For real RAG via OpenAI) Docker Desktop running and an OpenAI API key
- (For real RAG via Ollama) Docker Desktop running and Ollama installed locally

### Path A. Mock mode (no API key, no Chroma)

```bash
git clone https://github.com/travisezell/BUS4-118-Capstone-.git
cd BUS4-118-Capstone-
npm install
npm test           # 22/22 scenarios should pass
npm run dev
```

Visit `http://localhost:3000`. Agents run with deterministic mocks so you can verify the orchestration without spending API credits.

### Path B. Real RAG (OpenAI + Chroma)

```bash
# 1. Install and start Chroma
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
  "mcpTools":    ["create_access_request", "create_account_ticket", "get_ticket_status", "update_ticket_with_note", "search_tickets"]
}
```

> **Cost check:** ingestion is roughly $0.0001. A 50-prompt demo costs about $0.01. $5 of OpenAI credits is more than enough.

### Path C. Fully local with Ollama (no API key, no money)

For developers who want to run real RAG without paying for an API. Slower and slightly lower quality than Path B but completely free and runs offline.

```bash
# 1. Install Ollama from https://ollama.com/download

# 2. Pull the models (one-time, about 5 GB total)
ollama pull llama3.1
ollama pull nomic-embed-text

# 3. Install dependencies and start Chroma
npm install
docker compose up -d

# 4. Configure environment
cp .env.example .env.local
# then edit .env.local and set:
#   LLM_PROVIDER=ollama
#   VECTOR_STORE=chroma
#   CHROMA_URL=http://localhost:8000

# 5. Load IT docs into Chroma using local embeddings
npm run ingest

# 6. Run the dev server
npm run dev
```

`/api/health` will report `"provider": "ollama"`. Tool calls and the full multi-agent flow work the same as Path B; only the LLM and embedding providers change.

A few things to expect on Path C:

- **Latency.** Ollama on a typical laptop runs at 1 to 5 seconds per chat completion. The demo path (B) is around 500 ms. Plan accordingly.
- **Quality.** `llama3.1` is a strong open model but won't match `gpt-4o-mini` on every grounded answer. For most demo prompts it's fine.
- **Provider-specific Chroma collections.** The vector store auto-suffixes collection names with the provider name (`it-support-kb-openai` vs `it-support-kb-ollama`), so you can switch providers without dimension mismatches. Just re-run `npm run ingest` after switching.

---

## Project structure

```
app/
  api/                         # Thin route handlers (delegate to src/application/api)
  features/
    chat/ChatPage.tsx          # Chat UI feature module
    tickets/TicketsPage.tsx    # Tickets UI feature module
  types/support.ts             # Shared UI-facing support types
  components/NavBar.tsx
  page.tsx                     # Chat route entry (thin wrapper)
  tickets/page.tsx             # Tickets route entry (thin wrapper)

src/
  application/
    agents/                    # Intake, Knowledge, Workflow, Escalation, orchestrator
    api/                       # Stable app-service boundaries for API routes
  domain/
    data/                      # Ticket domain data + KB chunk model/seed data
  infrastructure/
    lib/                       # LLM, vector store, metrics, Jira client
    mcp/                       # MCP tool catalog and server

  # Compatibility re-exports during migration:
  agents/
  data/
  lib/
  mcp/

tests/
  scenarios.test.ts

scripts/
  ingest.ts
  mcp-server.ts

docs/
  architecture/
    ARCHITECTURE.md
    REPO-ORGANIZATION.md
  operations/
    TESTING.md
    test-results.md
  research/
    SCALING.md
  demo/
    handoff-flows.md
    sample-conversations.md
    design-implementation-testing.md
  diagrams/
  wireframes/
  screenshots/
  kb/                          # Source markdown used by `npm run ingest`
```



## Where to put new code

- **New orchestration/use-case logic:** `src/application/*`
- **Business/domain rules and data shape changes:** `src/domain/*`
- **External system adapters (APIs, protocols, stores):** `src/infrastructure/*`
- **Route-level server handlers:** keep in `app/api/*` and delegate to `src/application/api/*`
- **Client UI logic:** `app/features/*`; keep route files (`app/page.tsx`, `app/tickets/page.tsx`) thin
- **Operational docs/runbooks:** `docs/operations/*`
- **Architecture/design docs:** `docs/architecture/*`
- **Demo collateral:** `docs/demo/*`, `docs/diagrams/*`, `docs/wireframes/*`, `docs/screenshots/*`
- **RAG source docs for ingestion:** `docs/kb/*`

---

## Testing

```bash
npm test            # run all 22 scenarios
npm run test:watch  # watch mode
```

The test suite covers:

- **Access help** (4 scenarios): happy path, missing tool name, unsupported tool, duplicate request
- **Account help** (5 scenarios): standard lockout, skip-self-service, unclear, suspected compromise (vocabulary), suspected compromise (natural-language phrasing)
- **Ticket status** (4 scenarios): valid ID, invalid ID, no ID, stale ticket
- **Edge cases** (6 scenarios): greeting, capability question, ambiguous ticket creation, out-of-scope, natural-language account problem, ticket lookup by subject keyword
- **Multi-turn memory** (3 scenarios): referential follow-up resolves prior ticket, bare follow-up pulls ticket from history, follow-up without history doesn't invent a ticket

Per-flow metrics (routing accuracy, retrieval hit rate, auto-resolve rate, escalation rate, average latency) are tracked separately for each of the three core flows and exposed at `/api/metrics` under `perFlow`.

See [`docs/operations/test-results.md`](docs/operations/test-results.md) for the full per-scenario results table and [`docs/operations/TESTING.md`](docs/operations/TESTING.md) for the test design rationale.

Tests run against the mock providers so they pass on a fresh clone with no API key. That's intentional. The real RAG path is reserved for the live demo.

---

## Metrics

The system tracks the following metrics, with both aggregate values and per-flow breakdowns. The aggregate values below are from the latest test run.

| Metric | Target | Aggregate (22 tests) |
|---|---|---|
| Routing accuracy | 85% or higher | 100% |
| Auto-resolve rate | 60% or higher | 65% |
| Escalation rate | tracked, not minimized | 35% |
| Retrieval hit rate | 80% or higher | 48% aggregate, 100% on flows that use RAG |
| Average latency | under 5s | about 14ms (mock), about 500ms (OpenAI) |

Per-flow breakdowns from `/api/metrics`:

| Flow | Auto-resolve | Retrieval hit | Tool use | Avg latency |
|---|---|---|---|---|
| Access Help | 80% | 100% | 80% | about 35ms |
| Account Help | 67% | 100% | 50% | about 8ms |
| Ticket Status | 50% | n/a (skips Knowledge by design) | 75% | about 9ms |

The aggregate retrieval hit rate is lower than the per-flow rate because edge case intents (greeting, out_of_scope, ambiguous) intentionally bypass the Knowledge node. On flows that actually use RAG, retrieval hit rate is 100%.

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

A few decisions worth knowing about. These are honest engineering trade-offs, not gaps.

- **LangGraph for orchestration.** The Intake → Knowledge → Workflow → Escalation pipeline is wired together in a real `@langchain/langgraph` `StateGraph` with conditional edges. Routing decisions (e.g., `ticket_status` skips Knowledge; low-confidence `unknown` jumps straight to Escalation) are expressed declaratively as `addConditionalEdges` rather than buried inside `if`/`else`. The agents themselves are pure functions over `AgentState`, so any one of them could be replaced (say, swapping the rule-based Intake for an LLM-based one) without touching the graph.

- **Rule-based intent classifier vs LLM-based.** Intake uses regex and keyword and phrase matching for fast, free, deterministic classification. Failure mode: novel phrasings that don't match the patterns. The next iteration would route Intake through `gpt-4o-mini` for about 50ms latency at about $0.0001 per query.

- **In-memory ticket store vs real ITSM.** Tickets live in a `Map<>` on the server. Restarts wipe state. For the prototype this is fine. Swapping for a real ITSM (Jira, ServiceNow) is a single file change in `src/data/tickets.ts` because everything goes through a clear interface.

- **OpenAI and Ollama are the implemented LLM providers.** The `LLMProvider` interface in `src/lib/llm.ts` ships with three real implementations: a deterministic mock for tests, OpenAI for the demo path, and Ollama for fully local development without API costs. Gemini is declared but falls back to the mock in this iteration. The agent code never imports a vendor SDK directly; it only depends on the `LLMProvider` interface.

- **Blended cosine and keyword retrieval.** The in-memory vector store blends 60% cosine similarity with 40% keyword overlap so retrieval ranks reasonably even when embeddings are weak (mock mode). Real RAG on OpenAI embeddings doesn't need the keyword fallback. We kept it because it cheaply defends against query and document vocabulary mismatch.

---

## Vendor research

We compared three industry incumbents to inform our scope and design choices. Full notes in [`docs/research/SCALING.md`](docs/research/SCALING.md).

- **Moveworks.** Purpose-built employee IT assistant. Validated our 4-agent decomposition and the Intake → Knowledge → Workflow → Escalation pipeline. Their tier-based escalation model influenced our Tier 1 / Tier 2 / Security split.
- **ServiceNow Now Assist.** Generative AI layer on top of an ITSM. Validated MCP-style tool calling for ticket actions and reinforced that grounding answers in your own knowledge base (rather than the open web) is what makes IT assistants trustworthy.
- **Glean.** Enterprise AI search and assistant across all company data sources. Validated our citation-on-every-answer pattern and the "prefer 'I don't know' over hallucination" stance. Our project is the IT-workflow slice that could plug into a Glean-style horizontal knowledge layer in production.

---

## Team

Group 5, BUS 118S Capstone, May 2026.

---

## License

For coursework purposes. Not licensed for production use.
