# Architecture

This document describes the architecture of our multi-agent IT support assistant: the agents, data flow, and integration points. It maps directly to PRD §7 (Agent Architecture), §8 (RAG), §9 (Workflow Automation), and §10 (Technical Stack & MCP).

---

## High-Level Flow

1. **User** types a natural-language IT request into the chat UI.
2. **Intake Agent** classifies the request and extracts key fields (intent + entities + confidence).
3. **Knowledge Agent** retrieves relevant documents from the IT knowledge base via RAG.
4. **Workflow Agent** optionally calls tools to submit requests or check ticket status.
5. **Escalation Agent** decides whether to resolve or hand off to human IT.
6. **Response** is returned to the user with explanations, next steps, and (when applicable) a confirmation ID or escalation summary.

```
User ──> Intake ──> Knowledge ──┐
                                 ├──> Workflow ──> Escalation ──> User
                                 │
                                 └──> (skip Workflow when Q&A-only)
```

---

## Agents

### Intake Agent

**Inputs:** raw user message, conversation history.

**Outputs:** structured request object.

```ts
type Intent =
  | "access_help"
  | "account_help"
  | "ticket_status"
  | "general_qa";

interface IntakeResult {
  intent: Intent;
  entities: {
    toolName?: string;
    accountId?: string;
    ticketId?: string;
    cause?: string;
  };
  confidence: number; // 0-1
  rawText: string;
}
```

**Responsibilities:**

- Classify intent (Access, Account, Ticket Status, Q&A).
- Extract entities (tool/app name, account identifier, ticket ID, observed cause).
- Compute a confidence score; values below the threshold are routed to Escalation.

### Knowledge Agent

**Inputs:** `IntakeResult` + conversation context.

**Outputs:** retrieved chunks (with source IDs) and a grounded answer draft.

**Responsibilities:**

- Embed the user query (with intent context) and retrieve top-k chunks from Chroma.
- Produce an answer grounded in the retrieved snippets.
- Indicate retrieval confidence and whether more action is needed.

### Workflow Agent

**Inputs:** `IntakeResult` + retrieval result.

**Outputs:** structured tool-call results (e.g., new ticket IDs, status objects).

**Responsibilities:**

- Decide whether the current flow needs a tool call:
  - `create_access_request(app_name, user_id)`
  - `create_account_ticket(user_id, summary)`
  - `get_ticket_status(ticket_id)`
  - `update_ticket_with_note(ticket_id, note)`
- Call the tool through the MCP-style server.
- Wrap tool calls in try/catch; on failure, hand off to the Escalation Agent.

### Escalation Agent

**Inputs:** the full state (intake + retrieval + tool outputs).

**Outputs:** final response + escalation decision.

**Responsibilities:**

- Decide whether to auto-resolve or escalate.
- Summarize what was tried (docs used, tools called, results).
- Mark risky/unclear cases and missing-field cases for human IT.

---

## Data Flow by Flow

### Access Help

1. User: "How do I get access to Tool X?"
2. Intake → `intent = "access_help"`, `entities.toolName = "Tool X"`.
3. Knowledge → retrieves access policy for Tool X.
4. Workflow → if policy requires a request, calls `create_access_request`.
5. Escalation → escalates only if policy is unclear, the tool is unsupported, or the call fails.

### Account Help

1. User: "My account is locked, what should I do?"
2. Intake → `intent = "account_help"`, optional `entities.accountId`.
3. Knowledge → retrieves lockout/recovery policy.
4. Workflow → if recovery fails or risk is high, calls `create_account_ticket`.
5. Escalation → handles sensitive cases (suspected compromise) with higher priority.

### Ticket Status

1. User: "What's the status of ticket #INC-1042?"
2. Intake → `intent = "ticket_status"`, `entities.ticketId = "INC-1042"`.
3. Workflow → calls `get_ticket_status("INC-1042")`.
4. Knowledge → translates the raw state into plain language, suggests next steps.
5. Escalation → escalates if the ticket is missing, ambiguous, or stuck.

---

## RAG Pipeline

- **Documents:** IT access policies, lockout/recovery procedures, ticket FAQs, general IT FAQs.
- **Pipeline:**
  - Ingestion script (`npm run ingest`) chunks the source markdown (~500 tokens per chunk with overlap) and stores embeddings in Chroma.
  - Knowledge Agent embeds the user query (with intent context) and queries Chroma for top-k chunks.
  - Retrieved snippets are injected into the LLM prompt for grounded answers.
- **Quality controls:**
  - Top-k tuned per intent.
  - Source IDs returned with every answer.
  - When no chunk meets a similarity threshold, Knowledge Agent yields to Escalation rather than guessing.

---

## Tools / MCP

Tools are exposed through an MCP-style server (`src/mcp/server.ts`). The Workflow Agent is the only consumer; agents do not call tools directly.

```ts
interface ToolDefinition<I, O> {
  name: string;
  description: string;
  inputSchema: ZodSchema<I>;
  outputSchema: ZodSchema<O>;
  handler: (input: I) => Promise<O>;
}
```

Registered tools:

- `create_access_request(app_name, user_id) -> { request_id, status }`
- `create_account_ticket(user_id, summary) -> { ticket_id, status }`
- `get_ticket_status(ticket_id) -> { state, owner, last_update, next_action }`
- `update_ticket_with_note(ticket_id, note) -> { ok, ticket_id }`

The server pattern matches the way major AI assistants integrate enterprise apps, which is why we picked it. It also lets us test tools directly without going through the chat UI.

---

## State Object

Each step of the orchestrator reads and writes a single shared state object:

```ts
interface AgentState {
  userMessage: string;
  conversationHistory: Message[];

  // Intake
  intent?: Intent;
  entities?: Entities;
  confidence?: number;

  // Knowledge
  retrievedChunks?: RetrievedChunk[];
  groundedAnswer?: string;

  // Workflow
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];

  // Escalation
  escalationFlag?: boolean;
  escalationSummary?: string;

  // Response
  finalAnswer?: string;
  statusEvents?: StatusEvent[];
}
```

`statusEvents` are the "Classifying…", "Searching docs…", "Submitting request…", "Escalating…" messages surfaced to the UI.

---

## Pluggable Providers

The PRD calls for `LLM_PROVIDER` to switch between OpenAI / Gemini / Ollama. The contract lives in `src/lib/llm.ts`:

```ts
interface LLMProvider {
  generateResponse(prompt: string, context?: string): Promise<string>;
  embed?(text: string): Promise<number[]>;
}
```

The default provider is a deterministic mock used for offline development and tests. Real providers are loaded based on env vars at boot.

---

## Metrics

Every request logs:

- Intent routing decision (and whether it matched the expected intent in tests).
- Retrieval result (top-k chunk IDs).
- Tool calls and outcomes.
- Final decision (resolved vs. escalated).
- Latency per request.

Metrics are summarized in `docs/TESTING.md` and exposed at `GET /api/metrics`.
