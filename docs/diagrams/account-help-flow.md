# Account Help — Use Case Flow

Covers PRD §14.2. Triggered when the user reports an account issue: lockout, MFA reset,
password change, or — critically — **suspected compromise**.

The **compromise short-circuit** bypasses normal workflow and jumps straight to P1 escalation.
This path is tested by two dedicated scenarios including a regression test for natural-language
phrasing that doesn't contain the literal word "compromised".

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant Intake as Intake Agent<br/>(classify)
    participant Knowledge as Knowledge Agent<br/>(RAG)
    participant Workflow as Workflow Agent<br/>(MCP tools)
    participant Escalation as Escalation Agent
    participant Jira as Jira / Mock Store

    User->>Intake: "My account is locked" | "I think I was hacked"
    Intake-->>Intake: intent = account_help<br/>entities.cause = too_many_attempts | suspected_compromise<br/>confidence scored

    alt cause = suspected_compromise (short-circuit path)
        Intake->>Escalation: skip Knowledge + Workflow<br/>needsEscalation = true, priority = P1
        Escalation->>Jira: create_account_ticket(user_id, summary)
        Jira-->>Escalation: { ticket_id }
        Escalation-->>User: "🔴 Escalated to Security (P1) — ticket ACC-XXXX opened"
    else Standard lockout / password reset
        Intake->>Knowledge: retrieve(userMessage, intent)
        Knowledge-->>Knowledge: KB search → recovery steps
        Knowledge-->>Intake: groundedAnswer

        Knowledge->>Workflow: run(agentState)

        alt User explicitly asked for a ticket
            Workflow->>Jira: create_account_ticket(user_id, summary)
            Jira-->>Workflow: { ticket_id }
            Workflow-->>Escalation: needsEscalation = false
            Escalation-->>User: "Ticket ACC-XXXX opened.\n\nIn the meantime: <recovery steps>"
        else Self-service recovery possible
            Workflow-->>Escalation: needsEscalation = false
            Escalation-->>User: "Here's what to try first:\n\n<recovery steps>"
        end
    end
```

## Decision rules

| Condition | Outcome |
|---|---|
| `cause = suspected_compromise` | Skip Knowledge + Workflow → P1 escalation + ticket |
| Standard lockout + user wants ticket | `create_account_ticket` → respond with steps |
| Standard lockout + self-service possible | Return recovery steps, no ticket |
| Ambiguous ("I can't log in") | Respond with steps, `confidence < 0.85` flagged |
