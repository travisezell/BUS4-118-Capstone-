# Scaling & Future Work

This document outlines how the current prototype could be expanded into a complete IT support assistant, and how it relates to enterprise tools like ServiceNow and Moveworks. It maps to PRD §17 (Industry Vendor Research).

---

## Current Scope

Today, our system:

- Focuses on three primary flows — Access Help, Account Help, Ticket Status — plus Q&A.
- Uses a small, curated IT knowledge base for RAG.
- Implements four MCP-style tools for creating requests, opening tickets, checking status, and adding notes.
- Targets a single chat UI for internal employees.
- Runs in mock mode by default; pluggable LLM and vector-store providers can be enabled with environment variables.

---

## Scaling the Flows

### More IT Scenarios

In a real deployment we would add:

- VPN issues and certificate renewals.
- Hardware problems (laptop swap, peripheral requests, repair tickets).
- Software installation and license requests.
- Password reset variants (SSO, on-prem AD, individual SaaS apps).
- HR and facilities requests with their own policy bases.
- Multi-step workflows requiring approvals and multi-team handoffs.

### Richer Workflows

The Workflow Agent could expand to:

- Integrate directly with ITSM tools like ServiceNow and Zendesk through their APIs or MCP-bridged tools.
- Support ticket updates, comments, automatic reassignment, and SLA escalation.
- Run diagnostic checks (log analysis, monitoring queries) before escalation.

---

## Scaling the Knowledge Base

- Move from a curated set of docs to full IT policy and KB repositories.
- Add automatic ingestion from Confluence, SharePoint, or ServiceNow KB.
- Introduce per-tenant and per-role access controls so sensitive docs only surface for authorized users.
- Add freshness checks and "this article was last updated N days ago" signals.

---

## Scaling the Architecture

- Horizontal scaling of the API and agents through container orchestration (Kubernetes or a managed equivalent).
- Move the vector DB and ticket database to managed services for performance and durability.
- Cache frequent queries to reduce LLM cost and tail latency.
- Add structured logging, tracing, and per-agent metrics dashboards.

---

## Relation to Industry Vendors

Our prototype is intentionally small compared to the agentic IT-support platforms we researched.

### Moveworks

- **What it is.** An enterprise AI assistant platform built originally for employee IT and HR support, with a "Reasoning Engine" that decomposes employee requests, plans steps, and executes them across enterprise systems.
- **Architecture cues.** A multi-model agentic architecture where specialized models handle subtasks, plus a plugin / Agent Studio model for adding tools — a real-world version of the agent + tool catalog pattern we use.
- **Scale signal.** Serves 350+ enterprise customers and millions of employees; customers report deflection rates in the 40–80% range, supporting our hypothesis that an agentic IT desk can resolve a large share of tier-1 requests.
- **Strategic context.** Moveworks was acquired by ServiceNow in 2025, signaling that the agentic-IT-assistant pattern is now a core strategic bet for the largest ITSM vendor.
- **What we apply.** Separate "answer" agents from "action" agents, expose tools through a typed plugin/MCP layer, and treat deflection (auto-resolve) as a primary metric.

### ServiceNow Now Assist

- **What it is.** ServiceNow's GenAI suite layered on top of its ITSM platform, including a Virtual Agent, AI Search, prebuilt AI Agents for ITSM, and an AI Agent Fabric for orchestration.
- **Architecture cues.** Now Assist auto-classifies incidents, generates summaries, suggests next steps, and uses an Agent2Agent (A2A) protocol for inter-agent communication — directly parallel to our Intake → Knowledge → Workflow → Escalation pipeline.
- **Outcome signal.** Public ServiceNow material reports resolution-time reductions on the order of 40% on routine incidents, and ships prebuilt AI agents for triage and response.
- **What we apply.** Role-based agents with clear handoffs, structured incident summaries on escalation (mirroring "AI-assisted incident triage and resolution"), and plain-language status explanations as a first-class feature.

### Glean

- **What it is.** An enterprise AI search and assistant platform built around unified retrieval across the documents, chats, tickets, and code an organization already has. Glean's "Work AI" indexes Slack, Google Drive, Notion, Jira, GitHub, Confluence, and dozens of other sources behind a single chat surface, with permissions enforced per-document so users only see what they're allowed to.
- **Architecture cues.** A federated retrieval layer over multiple connectors plus a generative answer layer with citations to the original source — the "answer with citations" pattern is exactly what our Knowledge Agent does, just over a much smaller corpus. Glean recently added an Agents framework that lets customers compose multi-step workflows with tool calls, conceptually adjacent to our Workflow Agent + MCP layer.
- **Scale signal.** Glean reports hundreds of enterprise customers and is positioned as a horizontal layer (not IT-specific). Their public materials emphasize "trustworthy AI" — every answer cites its sources, no hallucinations, no leaked permissions — as the primary differentiator over a generic ChatGPT-on-enterprise-data approach.
- **Strategic context.** Glean is the vendor most often cited as the example for "enterprise search + AI assistant" generally; the PRD names them explicitly as a reference point. Their bet is that retrieval quality and source-grounded answers matter more than agent sophistication for the broad employee-help use case.
- **What we apply.** Source citations on every grounded answer (`docs/kb/*.md#section`), a similarity floor on retrieval that prefers "I don't know" over fabrication, and a single chat surface for the user. Where we differ: we are deeply IT-specific with workflow automation (ticket creation, MCP tools), while Glean is broad-and-shallow across the whole company knowledge graph. **A useful mental model: Glean is the company-wide knowledge layer; our system is the IT workflow layer that could plug into Glean as one of its tool-calling agents.**

### Where our prototype sits

A useful framing for the slide deck:

| | **Moveworks** | **ServiceNow Now Assist** | **Glean** | **This prototype** |
|---|---|---|---|---|
| **Primary focus** | Agentic IT/HR helpdesk | ITSM with GenAI on top | Enterprise search + AI | Agentic IT support |
| **Strength** | Workflow automation depth | ITSM-native, deep | Retrieval breadth + citations | Clean multi-agent demo |
| **Scope** | IT/HR specific | ITSM-platform tied | Whole-company | 3 IT flows |
| **Open or closed** | Closed SaaS | Closed (ServiceNow) | Closed SaaS | Open prototype |

Our project is positioned as a **lightweight, open-source prototype of the agentic IT-helpdesk pattern** — narrower than Moveworks/ServiceNow on flow coverage, narrower than Glean on knowledge breadth, but transparent enough to study and extend. It demonstrates the same architectural ideas the leading vendors have converged on: multi-agent decomposition, RAG with citations, tool calling for actions, and structured escalation when AI can't resolve the request.

### What This Tells Us

- The agentic, multi-agent pattern for IT support is not speculative — it is the direction the leading IT-focused vendors (Moveworks, ServiceNow) have converged on.
- All three vendors emphasize tool/plugin layers (Moveworks Agent Studio, ServiceNow AI Agent Fabric, Glean Agents) as the integration backbone, which validates our MCP-style tool server.
- All three vendors put **source-grounded answers with citations** at the center of their trust story — Glean built their entire pitch on it, Moveworks and ServiceNow lean on it for incident summaries. Our citation-on-every-answer pattern is industry-aligned, not a nice-to-have.
- Moveworks and ServiceNow report deflection / auto-resolve as the headline business metric, which is why we put it at the center of our success criteria.
- The IT-helpdesk vendors (Moveworks, ServiceNow) and the horizontal search vendor (Glean) target different layers of the enterprise. Our prototype sits in the IT-helpdesk layer but is small enough that it could plug into a Glean-style upstream knowledge layer in production.

---

## Next Steps

If we had more time:

1. Add more flows and tools beyond the initial three (VPN, hardware, software install).
2. Integrate with a live ITSM platform (ServiceNow or Zendesk sandbox) through its API.
3. Expand the knowledge base and add automatic ingestion from Confluence / SharePoint.
4. Add admin views and dashboards for IT staff.
5. Harden security, logging, and monitoring for production.
