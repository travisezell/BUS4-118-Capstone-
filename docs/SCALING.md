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

### What This Tells Us

- The agentic, multi-agent pattern for IT support is not speculative — it is the direction the leading vendors have converged on.
- Both vendors emphasize tool/plugin layers (Moveworks Agent Studio, ServiceNow AI Agent Fabric) as the integration backbone, which validates our MCP-style tool server.
- Both vendors report deflection / auto-resolve as the headline business metric, which is why we put it at the center of our success criteria.
- Both vendors invest heavily in escalation quality (incident summaries, recommended actions). Our Escalation Agent is consistent with this.

---

## Next Steps

If we had more time:

1. Add more flows and tools beyond the initial three (VPN, hardware, software install).
2. Integrate with a live ITSM platform (ServiceNow or Zendesk sandbox) through its API.
3. Expand the knowledge base and add automatic ingestion from Confluence / SharePoint.
4. Add admin views and dashboards for IT staff.
5. Harden security, logging, and monitoring for production.
