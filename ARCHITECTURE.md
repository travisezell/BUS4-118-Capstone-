# Architecture

This document describes the architecture of our multi-agent IT support assistant: the agents, data flow, and integration points.

---

## High-Level Architecture

At a high level, the system looks like this:

1. **User** types a natural-language IT request into the chat UI.
2. **Intake Agent** classifies the request and extracts key fields (intent + entities).
3. **Knowledge Agent** retrieves relevant documents from the IT knowledge base via RAG.
4. **Workflow Agent** optionally calls tools to submit requests or check status.
5. **Escalation Agent** decides whether to resolve or hand off to human IT.
6. **Response** is sent back to the user with explanations and next steps.[file:139][file:140]

---

## Agents

### Intake Agent

- **Inputs:** raw user message.
- **Outputs:** structured request object:

  ```ts
  type Intent = "access_help" | "accoun" | "ticket_status" | "qa";
  interface Request {
    intent: Intent;
    toolName?: string;
    accountId?: string;
    ticketId?: string;
    rawText: string;
    confidence: number;
  }
  ```

- **Responsibilities:**
  - Classify intent (access, account, status, Q&A).
  - Extract entities (tool/app name, account identifier, ticket ID).
  - Route the request into the rest of the graph.[file:139]

### Knowledge Agent

- **Inputs:** `Request` object + conversation context.
- **Outputs:** retrieved docs and an answer draft.

- **Responsibilities:**
  - Retrieve top‑k documents from the IT knowledge base using embeddings and Chroma.[file:139][file:140]
  - Propose an answer grounded in retrieved context.
  - Indicate confidence and whether more action is needed.

### Workflow Agent

- **Inputs:** `Request` object + retrieval result.
- **Outputs:** tool call results (e.g., ticket IDs, status objects).

- **Responsibilities:**
  - Decide whether to call a tool for the current flow:
    - `create_access_requesapp_name, user_id)`
    - `create_account_ticket(user_id, summary)`
    - `get_ticket_status(ticket_id)`
  - Call the tool (via direct code, MCP, or API).
  - Return structured results for the final response.[file:139][file:140]

### Escalation Agent

- **Inputs:** `Request` object + retrieval result + tool outputs.
- **Outputs:** final response + escalation decision.

- **Responsibilities:**
  - Decide if the system should auto-resolve or escalate.
  - Summarize what has been tried (docs used, tools called).
  - Mark risky/unclear cases for human IT.

---

## Data Flow by Flow

### Access Help

1. User: “How do I get access to Tool X?”
2. Intake → `intent = "access_help"`, `toolName = "Tool X"`.
3. Knowledge → retrieves access policy for Tool X.
4. Workflow → if policy requires a request, calls `create_access_request`.
5. Escalation → escalates only if policy is unclear or tool fails.[file:139][file:140]

### Account Help

1. User: “My account is locked, what should I do?”
2. Intake → `inlp"`, `accountId` extracted if mentioned.
3. Knowledge → retrieves lockout/recovery policy.
4. Workflow → if recovery fails, calls `create_account_ticket`.
5. Escalation → handles sensitive/risky cases.

### Ticket Status

1. User: “What’s the status of ticket #123?”
2. Intake → `intent = "ticket_status"`, `ticketId = 123`.
3. Workflow → calls `get_ticket_status(123)` or mock DB.
4. Knowledge → explains status in human language.
5. Escalation → escalates if status is missing/ambiguous.

---

## RAG Pipeline

- Documents: IT policies, access guides, lockout procedures, ticket FAQs.
- Pipeline:
  - Ingestion script chunks docs and stores embeddings in Chroma.
  - Knowledge Agent queries Chroma with the request context.
  - Retrieved snippets are injected into the LLM prompt for grounded answers.[file:139][file:140]

---

## Tools / MCP

Tools are implemented as simple functions or MCP endpoints:

- `create_access_request(app_name, user_id)`
- `create_account_ticket(user_id, summary)`
- `geet_id)`

These tools are called only by the Workflow Agent.[file:139][file:140][file:166]

---

## Metrics

The architecture includes hooks to log:

- Intent routing decisions.
- Retrieval results (docs used).
- Tool calls and outcomes.
- Final decision (resolved vs escalated).
- Latency per request.

See `TESTING.md` for how we use these metrics for validation.[file:139][file:140]

