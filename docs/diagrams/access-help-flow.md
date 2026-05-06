# Access Help — Use Case Flow

Covers PRD §14.1. Triggered when the user asks for access to a software tool (e.g. Figma, Slack, Notion).

The **Knowledge Agent** retrieves the access policy from the KB so the response
includes onboarding steps alongside the ticket reference.
A **duplicate-check** (`search_tickets`) fires before `create_access_request`
so the agent never opens a second ticket for the same tool.

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant Intake as Intake Agent<br/>(classify)
    participant Knowledge as Knowledge Agent<br/>(RAG)
    participant Workflow as Workflow Agent<br/>(MCP tools)
    participant Escalation as Escalation Agent
    participant Jira as Jira / Mock Store

    User->>Intake: "I need access to Figma"
    Intake-->>Intake: intent = access_help<br/>entities.toolName = "Figma"<br/>confidence ≥ 0.9

    Intake->>Knowledge: retrieve(userMessage, intent, {toolName})
    Knowledge-->>Knowledge: cosine + keyword search → KB chunks
    Knowledge-->>Intake: groundedAnswer (access policy steps)

    Knowledge->>Workflow: run(agentState)

    Workflow->>Jira: search_tickets(email, subjectQuery="Figma")
    Jira-->>Workflow: results

    alt No open request found
        Workflow->>Jira: create_access_request(app_name, user_id)
        Jira-->>Workflow: { request_id, status }
        Workflow-->>Escalation: needsEscalation = false
        Escalation-->>User: "I've submitted INC-XXXX ✓\n\n<policy steps>"
    else Existing open request found
        Workflow-->>Escalation: needsEscalation = false
        Escalation-->>User: "You already have INC-YYYY open (duplicate not created)"
    end
```

## Decision rules

| Condition | Outcome |
|---|---|
| `toolName` extracted + no open duplicate | `create_access_request` → respond |
| `toolName` extracted + duplicate found | Return existing ticket ID — no new ticket |
| `toolName` missing (underspecified) | `escalated = true`, ask user to name the tool |
| Tool not on policy list | `create_access_request` anyway (procurement path) |
