# Group 5 · Multi-Agent IT Support Assistant

An AI-powered internal IT support assistant that uses a multi-agent architecture, retrieval-augmented generation (RAG), and MCP-style tools to help employees resolve common IT requests through a single chat interface.

> **Course:** BUS 118S Capstone — Group 5
> **Repository:** [travisezell/BUS4-118-Capstone](https://github.com/travisezell/BUS4-118-Capstone-)

---

## Problem Definition

For everyday IT issues, employees bounce between multiple systems — searching a wiki, trying a portal, then opening a ticket or pinging IT even when the answer already exists in documentation. The result is long queues, duplicate tickets, and IT staff burning tier-1 capacity on highly repeatable problems like access requests, account lockouts, and ticket-status questions.

Our system provides one front door. The user describes their problem in chat, and the assistant understands the request, looks up the right IT documentation, and either guides them through the fix or triggers a small support action (submit a request, check the status of an existing ticket) before escalating to a human if needed.

---

## What We Built

A four-agent pipeline that runs end-to-end behind a single chat UI:

- **Intake Agent** — classifies the request into one of `access_help`, `account_help`, `ticket_status`, or `general_qa` and extracts entities (tool/app name, account identifier, ticket ID).
- **Knowledge Agent** — runs RAG over IT documentation (policies, how-tos, FAQs) and produces a grounded, citation-aware answer.
- **Workflow Agent** — calls MCP-style tools (`create_access_request`, `create_account_ticket`, `get_ticket_status`, `update_ticket_with_note`).
- **Escalation Agent** — decides when not to auto-resolve and produces a structured handoff package for human IT.

We focus on **three fully implemented IT flows** (Access Help, Account Help, Ticket Status) plus Q&A-only knowledge questions.

---

## Core IT Flows

### 1. Access Help — "How do I get access to Tool X?"

- User asks how to get access to a specific tool/app.
- Intake Agent classifies as `access_help` and extracts the app name and user ID.
- Knowledge Agent retrieves the access policy and any self-service steps.
- If self-service is possible, the assistant returns step-by-step guidance.
- If formal approval is required, Workflow Agent calls `create_access_request(app_name, user_id)` and returns a confirmation with a request ID.
- Escalation Agent flags ambiguous, unsupported, or out-of-policy cases for human IT.

**Key metrics:** access routing accuracy, retrieval hit rate, request completion rate, response latency.

### 2. Account Help — "My account is locked, what should I do?"

- User reports a locked account or login failure.
- Intake Agent classifies as `account_help` and extracts the account/system and the cause (too many attempts, forgotten password, etc.).
- Knowledge Agent retrieves lockout and credential-recovery policies.
- Assistant walks the user through documented steps.
- If recovery fails or the request looks risky (suspected compromise), Workflow Agent calls `create_account_ticket(user_id, summary)` to open an account support ticket.
- Escalation Agent summarizes attempts and marks the case for human follow-up.

**Key metrics:** account routing accuracy, guided-resolution rate, ticket-creation success rate, response latency.

### 3. Ticket Status — "What's the status of my IT ticket?"

- User asks about an existing ticket, with or without an ID.
- Intake Agent classifies as `ticket_status` and extracts the ticket ID.
- Workflow Agent calls `get_ticket_status(ticket_id)` against the mock ticket store.
- Knowledge Agent translates the raw status into plain language ("waiting on your manager's approval," "assigned to IT," "waiting on you") and outlines next steps.
- Escalation Agent flags missing/invalid IDs and stuck or stale tickets.

**Key metrics:** status routing accuracy, lookup success rate, explanation clarity, response latency.

### Q&A-Only Knowledge Questions

Using the same RAG pipeline, the assistant answers documentation-driven questions with no tool calls:

- "What are the password requirements?"
- "How do I connect to the office Wi-Fi?"
- "What are the IT support escalation tiers?"

---

## Architecture

### Components

- **User Interface (Chat UI)** — Next.js app where employees type IT questions; live status indicators show what the system is doing.
- **Intake Agent** — LLM + schema for intent classification and entity extraction.
- **Knowledge Agent** — RAG pipeline using embeddings + a vector store (Chroma).
- **Workflow Agent** — calls tools through an MCP-style server.
- **Escalation Agent** — final gate; decides resolve vs. hand off.
- **Data Layer** — IT documents (policies, how-tos), mock ticket store, and metrics log.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for diagrams and detailed component descriptions.

---

## Features

- Multi-agent orchestration (Intake → Knowledge → Workflow → Escalation)
- RAG over IT documentation with source attribution
- Workflow automation for access requests, account tickets, and ticket-status lookup
- MCP-style tool server for `create_access_request`, `create_account_ticket`, `get_ticket_status`, `update_ticket_with_note`
- Status indicators in the UI for every agent step
- Metrics tracking for routing accuracy, retrieval hit rate, auto-resolve rate, and latency

---

## Example Queries

**Access & Account**

- "How do I get access to Figma?"
- "I was added to the team but still can't log in."
- "My SSO account is locked. What should I do?"

**Ticket Status**

- "What's the status of ticket #INC-1042?"
- "Is my laptop repair ticket still open?"

**Knowledge Only**

- "What are the password rules here?"
- "How do I connect to the office Wi-Fi?"
- "How long do P1 incidents usually take to resolve?"

---

## Quick Start

### Prerequisites

- Node.js 20+ (Next.js 16 requires it)
- (Optional, for the real RAG path) Docker Desktop + an OpenAI API key

### Path A — Mock mode (no API key, no Chroma)

```bash
git clone https://github.com/travisezell/BUS4-118-Capstone-.git
cd BUS4-118-Capstone-
npm install
npm run dev
```

Visit `http://localhost:3000`. Agents run with deterministic mocks. The 12-scenario test suite (`npm test`) is the easiest way to verify the multi-agent pipeline works end-to-end.

### Path B — Real RAG (OpenAI embeddings + Chroma)

```bash
# 1. Install deps and start Chroma
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

The ingest script reads `docs/kb/*.md`, splits each H2 section into a chunk, embeds it with `text-embedding-3-small`, and writes it to the `it-support-kb` Chroma collection. Re-running is safe — chunks upsert by stable ID.

Verify the live setup at `http://localhost:3000/api/health`:

```json
{
  "ok": true,
  "llm":         { "provider": "openai", "chatModel": "gpt-4o-mini", "embeddingModel": "text-embedding-3-small" },
  "vectorStore": { "backend": "chroma",  "chromaUrl": "http://localhost:8000" },
  "mcpTools":    ["create_access_request", "create_account_ticket", "get_ticket_status", "update_ticket_with_note"]
}
```

> **Heads up.** Tests intentionally run in mock mode so they don't need an API key or a running Chroma — that's why `npm test` works on a fresh clone. Path B is for the live demo.

---

## Project Structure

```text
app/
  api/
    chat/route.ts        # Main chat endpoint — orchestrates the 4 agents
    tickets/route.ts     # List tickets
    tickets/[id]/route.ts# Read a single ticket
    metrics/route.ts     # Read metrics log
    health/route.ts      # Health check
  page.tsx               # Chat UI with live status indicators
  layout.tsx             # Root layout
  globals.css            # Tailwind + theme

src/
  agents/
    types.ts             # Shared agent state + types
    intake.ts            # Intent classification + entity extraction
    knowledge.ts         # RAG retrieval over IT docs
    workflow.ts          # Tool calls via MCP-style server
    escalation.ts        # Human handoff logic
    orchestrator.ts      # LangGraph-style routing
  lib/
    llm.ts               # Pluggable LLM interface (OpenAI / Gemini / Ollama / mock)
    vector-store.ts      # Vector store interface (Chroma + mock fallback)
    metrics.ts           # In-memory metrics logger
  mcp/
    tools.ts             # Tool catalog (4 IT tools)
    server.ts            # MCP-style server stub
  data/
    knowledge-base.ts    # Seeded IT policies, FAQs, and how-tos
    tickets.ts           # In-memory mock ticket store

tests/
  scenarios.test.ts      # 12 test scenarios (4 per flow)

scripts/
  ingest.ts              # Loads docs/kb/*.md → chunks → embeds → Chroma

docs/
  ARCHITECTURE.md
  TESTING.md
  SCALING.md
  PRD.md                 # Product Requirements Document
  kb/                    # Source IT documentation (markdown)
    access-policies.md
    account-guidance.md
    ticket-faqs.md
    general-it-faqs.md

docker-compose.yml       # Chroma service for local development
```

---

## Testing

See [`docs/TESTING.md`](docs/TESTING.md) for the full scenario list.

```bash
npm test            # run all tests
npm run test:watch  # watch mode
```

We focus tests on:

- Intake classification and entity extraction.
- Knowledge retrieval quality (top-k hit rate).
- Workflow tool calls (request creation, status lookup).
- End-to-end flows for the three core scenarios — 12 total (4 per flow).

---

## Metrics & Validation

We track and report:

- **`routingAccuracy`** — correct classification rate (target ≥ 85%).
- **`retrievalHitRate`** — percentage of answers grounded in a relevant doc chunk (target ≥ 80%).
- **`autoResolveRate`** — percentage of requests resolved without escalation (target ≥ 60%).
- **`escalationRate`** — percentage of requests escalated (reported, not optimized down — honest escalation is a feature).
- **`averageLatencyMs`** — average response time per request (target < 5,000 ms for non-tool responses).

Live metrics are exposed at `GET /api/metrics`. The 12-scenario summary is captured in `docs/TESTING.md`.

---

## Tech Stack

- **Frontend** — Next.js 16 (App Router) + React 19 + Tailwind 4
- **Orchestration** — LangGraph-style state graph (custom lightweight implementation in `src/agents/orchestrator.ts`)
- **LLM** — Pluggable provider (OpenAI / Gemini / Ollama); default is a deterministic mock for offline development
- **Embeddings** — OpenAI embeddings (mock fallback for offline development)
- **Vector Store** — Chroma (local), with an in-memory cosine-similarity fallback
- **Tool Protocol** — MCP-style typed tool server
- **Testing** — Vitest
- **Deployment** — Vercel-compatible
