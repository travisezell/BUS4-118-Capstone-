# Diagrams

Visual references for the IT Support Assistant architecture and per-flow routing logic.

## System diagrams

| File | Description |
|---|---|
| [`architecture.png`](architecture.png) | High-level system topology — Next.js app, LangGraph orchestrator, MCP server, Chroma vector store, Jira |
| [`user-journey.png`](user-journey.png) | End-to-end user journey from chat input to resolved response |

## Per-flow sequence diagrams

Each diagram below traces one of the three supported use cases through the agent graph.
Decision points, tool calls, and escalation branches are all shown.

| File | Use case |
|---|---|
| [`access-help-flow.md`](access-help-flow.md) | Software access request — Intake → Knowledge → Workflow → respond (duplicate-check decision included) |
| [`account-help-flow.md`](account-help-flow.md) | Account / lockout issue — standard path plus compromise short-circuit to high-priority escalation |
| [`ticket-status-flow.md`](ticket-status-flow.md) | Ticket status lookup — Knowledge skipped, direct `get_ticket_status` tool call, stale/not-found branches |

> **Viewing the Mermaid diagrams:** GitHub renders Mermaid natively in `.md` files.
> For local viewing, open each file in VS Code with the Markdown Preview Enhanced extension,
> or run `npx @mermaid-js/mermaid-cli -i <file.mmd> -o <file.png>` to generate PNGs.
