# Group 5 · Multi-Agent IT Support Assistant

An AI-powered internal IT support assistant that uses a multi-agent architecture, retrieval-augmented generation (RAG), and simple tools to help employees resolve common IT requests through a single chat interface.

---

## Problem Definition

For everyday IT issues, employees bounce between multiple systems — searching a wiki, trying a portal, and then opening a ticket or pinging IT — even when the answer already exists in documentation.[file:139][file:140] This creates long queues, duplicate tickets, and repetitive work for IT staff on highly repeatable problems like access requests, account issues, and ticket status questions.[web:45][web:147][web:149]

Our system provides one front door: the user describes their problem in chat, and the assistant understands the request, looks up the right IT documentation, and either guides them through the fix or triggers a small support action (like submitting a request or checking the s of an existing ticket) before escalating to a human if needed.[file:139][file:140]

---

## What We Built

We implemented a 4-agent architecture:

- **Intake Agent** – classifies the request (access help, account help, ticket status, general Q&A) and extracts key entities (tool/app name, account identifier, ticket ID).[file:139]
- **Knowledge Agent** – performs RAG over IT docs (policies, how-tos, FAQs) to propose grounded answers.[file:139][file:140]
- **Workflow Agent** – runs simple actions via tools (create access request, create account ticket, get ticket status).[file:139][file:140]
- **Escalation Agent** – decides when not to auto-resolve and summarizes context for human handoff.[file:139]

We focus on **three fully implemented IT flows**, plus a few extra knowledge-only questions.

---

## Core IT Flows

### 1. Access Help – “How do I get access to Tool X?”

- User asks how to get access to a specific tool/app.
- Intake Agent classifies as `access_help` and extracts the app name + usedge Agent retrieves the access policy and any self-service steps.
- If self-service is possible, the assistant returns step-by-step guidance.
- If formal approval is required, Workflow Agent calls `create_access_request(app_name, user_id)` to submit a request and returns a confirmation.[file:139][file:140]
- Escalation Agent flags ambiguous or out-of-policy cases for human IT.

**Key metrics**

- Access routing accuracy.
- Access retrieval hit rate (policy used).
- Access request completion rate.
- Access response latency.

---

### 2. Account Help – “My account is locked, what should I do?”

- User reports a locked account or login failure.
- Intake Agent classifies as `account_help` and extracts the account/system + context (too many attempts, password forgotten, etc.).[file:139]
- Knowledge Agent retrieves lockout and credential recovery policies.
- Assistant walks the user through the documented steps.
- If recovery fails or risk is high, Workflow Agent calls `create_account_ticket(user_id, summao open an account support ticket.[file:139]
- Escalation Agent summarizes attempts and marks the case for human follow-up.

**Key metrics**

- Account routing accuracy.
- Guided resolution rate (fixed by documented steps).
- Ticket creation success rate.
- Account help response latency.

---

### 3. Ticket Status – “What’s the status of my IT ticket?”

- User asks about an existing ticket, with or without an ID.
- Intake Agent classifies as `ticket_status` and extracts ticket ID or other identifiers.
- Workflow Agent calls `get_ticket_status(ticket_id)` or queries a mock ticket DB.
- Knowledge Agent explains the status in plain language (e.g., “waiting for your manager’s approval,” “assigned to IT,” “waiting on your response”) and outlines next steps.[file:139][file:140]
- Escalation Agent flags missing/invalid IDs or obviously stuck tickets.

**Key metrics**

- Status routing accuracy.
- Status lookup success rate.
- Clarity of status explanations (user feedback).
- Status response laonal Knowledge-Only Questions

Using the same RAG pipeline, the assistant can also answer purely documentation-driven questions (no tools):

- “What are the password requirements?”
- “How do I connect to Wi‑Fi?”
- “What are the IT support escalation tiers?”[file:140]

---

## Architecture

### Multi-Agent System Diagram (Conceptual)

- **User Interface (Chat UI)** – Next.js app where employees type IT questions.
- **Intake Agent** – LLM + schema for intent classification and entity extraction.
- **Knowledge Agent** – RAG pipeline using embeddings + vector store (Chroma).
- **Workflow Agent** – Calls tools or MCP server to create requests/tickets and check status.
- **Escalation Agent** – Final gate; decides whether to resolve or hand off to IT.
- **Data Layer** – IT documents (policies, how‑tos), ticket data, and metrics store.[file:139][file:140][file:166]

See `ARCHITECTURE.md` for diagrams and detailed component descriptions.

---

## Features

- ✅ Multi-agent orchestration Escalation)
- ✅ RAG over IT documentation (policies, FAQs, how‑tos)
- ✅ Workflow automation for access and account tickets, ticket status lookup
- ✅ Simple tools / MCP hooks for requests and status
- ✅ Metrics tracking for routing accuracy, auto-resolve rate, and latency

---

## Example Queries

**Access & Account**

- “How do I get access to Figma?”
- “I was added to the team but still can’t log in.”
- “My SSO account is locked. What should I do?”

**Ticket Status**

- “What’s the status of ticket #123?”
- “Is my laptop repair ticket still open?”

**Knowledge Only**

- “What are the password rules here?”
- “How do I connect to the office Wi‑Fi?”
- “How long do P1 incidents usually take to resolve?”[file:140]

---

## Quick Start

> Note: commands are a template; adjust to your actual stack.

### Prerequisites

- Node.js 18+
- Docker & Docker Compose
- AI provider API key (OpenAI / Gemini / etc.)
- IT policy documents (PDF/markdown) for ingestion

### Install<your-repo-url>
cd IT-Support-ChatBot

# Install dependencies
npm install

# Configure environment
cp .env.example .env
# then set your LLM + vector DB keys

# Start services (db, app, tools)
docker compose up -d

# Embed IT policies into vector store
npm run ingest
```

Visit `http://localhost:3000` in your browser.

---

## Project Structure

```text
src/
  agents/
    intake/        # Intent classification + entity extraction
    knowledge/     # RAG retrieval over IT docs
    workflow/      # Tool calls (requests, status)
    escalation/    # Human handoff logic
  app/
    api/
      chat/        # Chat endpoint
      tickets/     # Ticket-related endpoints (status, list)
    page.tsx       # Main chat UI
  lib/
    vector-store.ts  # Vector DB integration
    ticket-service.ts# Ticket data access
    metrics.ts       # Metrics tracking utilities
    db.ts            # Database connection
  mcp/
    server.ts        # MCP / tools server (optional)
tests/               # Unit + scenario tests
docs/                # ARCHITECTURE, TESTING, SCALING, vendor research
```

---

## Testing

See `TESTING.md` for detailed scenarios and how to run the suite.

Basic commands:

```bash
npm run test          # run all tests
npm run test:watch    # watch mode
npm run test:coverage # coverage report
```

We focus tests on:

- Intent classification and routing.
- RAG retrieval quality.
- Workflow tool calls (request creation, status lookup).
- End‑to‑end flows for the 3 core scenarios.[file:139][file:140]

---

## Metrics & Validation

We track:

- `routingAccuracy` – correct classification rate.
- `retrievalHitRate` – percentage of answers with a relevant document.
- `autoResolveRate` – percentage of requests resolved without escalation.
- `averageLatencyMs` – average response time per request.[file:139][file:140]

These metrics are summarized in the testing report and slides.

---

## Tech Stack

- **Frontend** – Next.js + React
- **AI** – LLM provider (OpenAI / Gemini / etc.)
- **Vector Store** – Chro** – Simple JSON tools or MCP server
- **Testing** – Vitest
- **Deployment** – Docker + Docker Compose

