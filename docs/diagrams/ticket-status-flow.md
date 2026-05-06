# Ticket Status — Use Case Flow

Covers PRD §14.3. Triggered when the user asks about an existing ticket's status.

**Key routing difference:** `ticket_status` intent skips the Knowledge Agent entirely — the
tool call to Jira/mock returns structured data so there is no policy document to retrieve.

Two sub-paths are shown: lookup by explicit ticket ID (`INC-1042`) and keyword-based search
(`search_tickets`) when no ID is provided.

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant Intake as Intake Agent<br/>(classify)
    participant Workflow as Workflow Agent<br/>(MCP tools)
    participant Escalation as Escalation Agent
    participant Jira as Jira / Mock Store

    User->>Intake: "What's the status of INC-1042?" | "Any update on my Figma ticket?"
    Intake-->>Intake: intent = ticket_status<br/>entities.ticketId extracted (or absent)<br/>confidence scored

    Note over Intake,Workflow: Knowledge Agent is SKIPPED for ticket_status

    Intake->>Workflow: run(agentState)

    alt Explicit ticket ID provided (e.g. INC-1042)
        Workflow->>Jira: get_ticket_status(ticket_id)

        alt Ticket found
            Jira-->>Workflow: { state, owner, last_update, next_action }
            Workflow-->>Escalation: needsEscalation = false
            Escalation-->>User: "Your ticket is <state>.\nOwner: ...\nNext step: ..."
        else Ticket not found (e.g. INC-99999)
            Jira-->>Workflow: null
            Workflow-->>Escalation: needsEscalation = true
            Escalation-->>User: "I couldn't find that ticket — escalating so a human can check"
        end

    else No ID — keyword search
        Workflow->>Jira: search_tickets(email, subjectQuery)

        alt One match found
            Jira-->>Workflow: [{ id, summary, state, ... }]
            Workflow-->>Escalation: needsEscalation = false
            Escalation-->>User: "I found INC-XXXX — <summary>. Status: <state>"
        else Multiple or zero matches
            Jira-->>Workflow: [] | [t1, t2, ...]
            Workflow-->>Escalation: needsEscalation = true
            Escalation-->>User: "I found N tickets — which one did you mean? [list]"
        end
    end
```

## Decision rules

| Condition | Outcome |
|---|---|
| Valid ticket ID → found | Return structured status, no escalation |
| Valid ticket ID → not found | Escalate for human check |
| No ID + keyword match (1 result) | Return that ticket's status |
| No ID + multiple matches | List choices, escalate for clarification |
| No ID + no matches | Escalate |
| Stale ticket (`state = stale`) | Return status with "may be stuck" explanation |
