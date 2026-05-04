# Sample Conversations

Three demo scripts for the live walkthrough, one per IT flow. Each has the prompt to type, what the system shows, and the talking point to use on stage. Anyone in the group can present from these notes.

The demo runs about five minutes for all three, plus a one minute escalation closer.

## 1. Access Help

The setup line, before typing:

> "First scenario is access help. Imagine I am a new designer and I need access to Figma. Watch the status indicator move through the agents, and watch the Workflow Agent. It is going to do something interesting."

Type into the chat:

```
I need access to Figma for the design review
```

What the system shows:

The status indicator ticks through Classifying request, Searching IT documentation, Submitting access request, Composing response. That is the live multi agent pipeline running.

The response shows up. Read this line out loud because it is the killer detail:

> "You already have an open access request for Figma, request ID INC 1042, status waiting on approval."

The response also includes the Figma access policy, with a citation to docs/kb/access policies.md.

The talking point:

> "Notice the system did not blindly create a duplicate ticket. The Workflow Agent checked the ticket store first and found INC 1042 was already open. That is not just RAG. That is not just an LLM. That is an agent making a real product decision. Do not spam IT with duplicate requests. In a real deployment this is the kind of behavior that prevents most ticket noise."

Metadata to point at:

intent access_help, confidence 90 percent, sources cited, all four agent stages visible in the trace.

## 2. Account Help

The setup line:

> "Second scenario is account help. The most common IT ticket is a lockout. Let us see what happens when the system handles a routine case."

Type into the chat:

```
I'm locked out of my account
```

What the system shows:

The status indicator runs through Classifying, Searching documentation, Checking account recovery options, Composing response.

The response gives self service recovery steps, grounded in the actual policy, not a ticket:

> "Here is what to try first. Most account lockouts after too many failed login attempts auto clear in 15 minutes. If you are still locked out, use the Forgot password link on the SSO sign in page."

No ticket gets created. No human IT involvement. No escalation card.

The talking point:

> "This is what auto resolve looks like. In a traditional ticketing system this user just opened a low priority ticket and is now waiting one to three business days. Our Knowledge Agent grounded the answer in our actual lockout policy, citation visible, and the Workflow Agent decided not to create a ticket because the user did not ask for one. That is auto resolve. That is the metric Moveworks reports as around 75 percent in production. We are at 64 percent on a small test set with deliberately tricky scenarios."

Metadata to point at:

intent account_help, confidence 75 percent, two source chunks cited, no escalation, no tools called.

## 3. Ticket Status

The setup line:

> "Third scenario, ticket status. The most boring IT use case in the world, but the one users complain about most. Let us see how it goes."

Type into the chat:

```
What's the status of INC-1042?
```

What the system shows:

The status indicator is shorter than before. It skips the docs search phase. Classifying, Looking up ticket status, Composing response. That is the LangGraph conditional edge in action. The ticket_status intent skips the Knowledge node because the tool returns structured data directly.

The response comes back fast, usually under 100ms:

> "Your ticket is waiting on a manager approval. Assigned to Manager Approval Queue. Last updated 2026 05 03. Next step is to ping your manager on Slack if it is urgent."

The talking point:

> "Two things to notice. First, the response time is under 100ms because we skipped the document retrieval step that the LangGraph routing logic decided we did not need. Second, the response is plain language, not raw status fields. The Knowledge Agent translated the internal state, waiting on approval, into a real sentence and added a clear next step. Our principle is to never make the user decode IT jargon."

Metadata to point at:

intent ticket_status, confidence 95 percent, very high because there was a clear ticket ID, tool get_ticket_status succeeded, latency very low.

## 4. Suspected Compromise (the closer)

This shows the system's safety reasoning. When to escalate.

The setup line:

> "Last one. Let us see what happens with a request the system should not try to solve on its own."

Type into the chat:

```
Someone logged into my account from another country and I didn't do it
```

What the system shows:

The status indicator runs through Classifying, Searching documentation, Checking account recovery options, Escalating to human IT. Notice the last stage. It is different from the other demos.

The response is in an amber escalation card, visually distinct from the green success states:

> "I am not confident I can resolve this on my own, so I am handing it off to human IT. Original request, category account_help, cause suspected_compromise, tools tried create_account_ticket. Reason for handoff, suspected compromise flagged as high priority for security review."

A real ticket gets created, for example ACC 2001, and the system flagged it for security.

The talking point:

> "This is the system telling the user, I am not going to try to fix this. A human needs to look at it. Notice three things. First, the Intake Agent picked up suspected compromise even though the user never used the words compromised or hacked. It understood logged in from another country as natural language. Second, the system still created a ticket, but it is a high priority security ticket, not a routine one. Third, the handoff package contains everything a Tier 2 analyst needs. They do not have to re interview the user. Auto resolve is the easy metric. Knowing when not to auto resolve is the hard one."

Metadata to point at:

intent account_help, confidence 90 percent, cause suspected_compromise, escalated, amber card, tool create_account_ticket succeeded.

## Demo flow recommendations

### Order

1. Access help, the Figma example. Opens with a strong moment, the duplicate detection. Sets the expectation that this is more than a chatbot.
2. Account help, the lockout. Shows auto resolve, the happy path of automation.
3. Ticket status, INC 1042. Shows speed and plain language translation. Quick.
4. Compromise escalation. The dramatic close. Shows the system has judgment.

### Pacing

Do not read the chat responses verbatim. Paraphrase. The screen shows the words. You provide the framing.

Pause after each prompt while the status indicator runs. Let the audience see the pipeline working.

After each response, point at one piece of metadata, intent or confidence or sources or latency, and explain why it matters. One per demo. Do not drown the audience in details.

### Refresh between demos

Hit refresh in the browser between conversations 1, 2, and 3 so the screen is clean. For the compromise close, leave the previous conversation visible. The amber escalation card stands out by contrast.

### What not to do during the demo

Do not open MCP Inspector during the live demo flow. Save Inspector for a separate slide where you walk through it deliberately. Mid demo screen switching kills momentum.

Do not apologize for mocked components. The ticket store is in memory but it functions identically to a real one for demo purposes. Do not draw attention to it unless asked.

Do not try to demo the metrics page live. Talk about the numbers from a slide. Live JSON pages are a bad demo screen.

### If the live demo crashes

Two backup plans.

Recorded screen capture. Record a clean run of all four demos this weekend and have it ready as a backup video on a presenter's laptop.

Screenshots. All eight screenshots are in docs/screenshots. Switch to the slide with screenshots and walk through them as if they were live.

## Connection to slides

Each conversation has natural slide companions.

| Conversation | Slide context |
|---|---|
| 1, Figma access | How the agents collaborate. |
| 2, Lockout | What auto resolve looks like. |
| 3, INC 1042 | Why we use LangGraph conditional edges. |
| 4, Compromise | When the system refuses to auto resolve. |
