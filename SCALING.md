# Scaling & Future Work

This document outlines how the current prototype could be expanded into a more complete IT support assistant, and how it relates to enterprise tools like ServiceNow and Zendesk.

---

## Current Scope

Today, our system:

- Focuses on three primary flows: access help, account help, ticket status.
- Uses a small, curated IT knowledge base for RAG.
- Implements simple tools for creating requests/tickets and checking status.
- Targets a single chat UI for internal employees.[file:139][file:140]

---

## Scaling the Flows

### More IT Scenarios

In a real deployment, we could:

- Add flows for VPN issues, hardware problems, software installation, and password reset variants.
- Support HR and facilities requests with additional documents and tools.
- Handle more complex multi-step workflows (approvals, multi-team handoffs).[web:45][web:147][file:166]

### Richer Workflows

We could expand the Workflow Agent to:

- Integrate directly with ITSM tools like ServiceNow and Zendesk via APIs or MCP tools.
- Support ticket updates, comments, and automatic reassignment rules.
- Run diagnostic checks (log analysis, monitoring queries) before escalation.[file:166][web:156][web:157]

---

## Scaling the Knowledge Base

- Move from a small curated set of docs to full IT policy and knowledge repositories.
- Add automatic document ingestion from Confluence, SharePoint, or ServiceNow KB.[file:166][web:68][web:96]
- Introduce per-tenant and per-role access controls for sensitive content.

---

## Scaling the Architecture

- Horizontal scaling of the API and agents via container orchestration (e.g., Kubernetes).
- Separate the vector DB and ticket database into managed services for performance and reliability.
- Introduce caching for frequent queries to reduce latency and cost.

---

## Relation to Industry Vendors

Our prototype is intentionally small compared to:

- **ServiceNow** – full ITSM platform with Virtual Agent, ITIL processes, and deep workflow builder.[file:166][web:156][web:161]
- **Zendesk** – customer service platform with Answer Bot, omnichannel support, and analytics.[file:166][web:157]
- **Glean / Copilot IT Helpdesk** – AI-first tools for internal search and ticket workflows.[web:68][web:159]

However, the core pattern is the same:

- Conversational interface for IT support.
- Knowledge-based answers for common issues.
- Workflows for tickets and status.
- Metrics to measure performance.

Our system can be seen as a **teaching-scale prototype** of these ideas.

---

## Next Steps

If we had more time, we would:

1. Add more flows and tools beyond the initial three.
2. Integrate with a liM platform (e.g., ServiceNow or Zendesk sandbox).
3. Expand the knowledge base and add automatic ingestion.
4. Add admin views and dashboards for IT staff.
5. Harden security, logging, and monitoring for production environments.[file:166]

