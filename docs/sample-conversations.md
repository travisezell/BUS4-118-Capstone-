# Sample Conversations · Demo Scripts

These are the three demo scripts for the live walkthrough. Each maps to one of our three core IT flows. They're written so anyone in the group can present them — what to say, what to type, what to point at on screen.

> **Total demo time: ~5 minutes** if you do all three back-to-back, plus a 60-second escalation bonus to close. Leaves time for slides and Q&A in a 10-minute slot.

---

## Conversation 1 · Access Help (with duplicate detection)

**The setup line.** Before typing:

> "Our first scenario is access help. Let's say I'm a new designer and I need access to Figma. Watch what the Intake Agent classifies this as, and watch the Workflow Agent — it's going to do something interesting."

**Type into the chat:**

```
I need access to Figma for the design review
```

**What the system does (point these out as they happen):**

1. The status indicator ticks through *Classifying request… → Searching IT documentation… → Submitting access request… → Composing response.* That's the live multi-agent pipeline running.

2. The response shows up. **Read this part out loud** because it's the killer detail:

> "You already have an open access request for **Figma** — request ID `INC-1042`, status `waiting_on_approval`."

3. The response also includes the relevant Figma access policy from the IT documentation, with a citation to `docs/kb/access-policies.md#figma`.

**The talking point** (this is the slide content):

> "Notice the system didn't blindly create a duplicate ticket. The Workflow Agent checked the ticket store first and found INC-1042 was already open. That's not RAG. That's not just an LLM. That's an agent making a real product decision — *don't spam IT with duplicate requests.* In a real deployment, this is the kind of thing that prevents 30% of IT noise."

**Metadata to point at:**

- intent: `access_help`
- confidence: 90%
- sources: `docs/kb/access-policies.md#figma`
- trace shows all 4 agent stages

---

## Conversation 2 · Account Help (self-service auto-resolve)

**The setup line.**

> "Second scenario — account help. The most common IT ticket is a lockout. Let's see what happens when I tell the system I'm locked out, but it's a routine case."

**Type into the chat:**

```
I'm locked out of my account
```

**What the system does:**

1. Status ticks through *Classifying… → Searching IT documentation… → Checking account recovery options… → Composing response.*

2. The response gives **self-service recovery steps** grounded in the actual policy — not a ticket:

> "Here's what to try first. Most account lockouts after too many failed login attempts auto-clear in 15 minutes. If you are still locked out, use the 'Forgot password' link on the SSO sign-in page…"

3. **No ticket gets created**, no human IT involvement, no escalation card. The system resolved it from documentation.

**The talking point:**

> "This is what auto-resolve looks like. In a traditional ticketing system, this user just opened a P3 ticket and is now waiting 1-3 business days. Our Knowledge Agent grounded the answer in our actual lockout policy — citation visible — and the Workflow Agent decided NOT to create a ticket because the user didn't ask for one. That's auto-resolve. That's the metric Moveworks reports as 75% in production. We're at 64% on our test set with deliberately tricky scenarios."

**Metadata to point at:**

- intent: `account_help`
- confidence: 75%
- sources: lockout-recovery + password-reset chunks
- **no escalation, no tools called** — this is the self-service path

---

## Conversation 3 · Ticket Status (lookup via real MCP tool)

**The setup line.**

> "Third scenario — ticket status. The most boring IT use case in the world, but the one users complain about most. Let's see how it goes."

**Type into the chat:**

```
What's the status of INC-1042?
```

**What the system does:**

1. Notice the status indicator is **shorter than before** — it skips the docs-search phase. *Classifying… → Looking up ticket status… → Composing response.* That's the LangGraph conditional edge in action — `ticket_status` intent skips the Knowledge node because the tool returns structured data.

2. The response comes back fast (*usually under 100ms*):

> "Your ticket is waiting on a manager approval. Assigned to: **Manager Approval Queue.** Last updated: 2026-05-03. Next step: Waiting on your manager to approve. Ping them on Slack if it's urgent."

**The talking point:**

> "Two things to notice. First, the response time — under 100ms, because we skipped the document retrieval step the LangGraph routing logic decided we don't need. Second, the response is plain language, not raw status fields. The Knowledge Agent translated `state: waiting_on_approval` into 'waiting on a manager approval' and added a clear next step. Our principle: never make the user decode IT system jargon."

**Metadata to point at:**

- intent: `ticket_status`
- confidence: 95% (very high — there was a clear ticket ID)
- tools called: `get_ticket_status` ✓
- latency: very low

---

## Bonus · Suspected Compromise (for the dramatic close)

This is the prompt that shows the system's **safety reasoning** — when to escalate.

**The setup line.**

> "Last one. Let's see what happens with a request the system shouldn't try to solve on its own."

**Type into the chat:**

```
Someone logged into my account from another country and I didn't do it
```

**What the system does:**

1. Status indicator runs through *Classifying… → Searching IT documentation… → Checking account recovery options… → Escalating to human IT.* Notice the last stage — it's different from the other demos.

2. The response is in an **amber escalation card**, visually distinct from the green success states:

> "I'm not confident I can resolve this on my own, so I'm handing it off to human IT. **What I'm sending them:** Your original request: '[the message]', Category: account_help, Cause: suspected_compromise, Tools tried: create_account_ticket. **Reason for handoff: Suspected compromise — flagged as high priority for security review.**"

3. A real ticket gets created (e.g., `ACC-2001`) and the system flagged it for security.

**The talking point:**

> "This is the system telling the user 'I'm not going to try to fix this — a human needs to look at it.' Notice three things. First, the Intake Agent picked up 'suspected_compromise' even though the user never used the word 'compromised' or 'hacked' — it understood 'someone logged in from another country' as natural language. Second, the system still created a ticket, but it's a P1 security ticket, not a routine one. Third, the handoff package contains everything the human Tier 2 analyst needs — they don't have to re-interview the user. **Auto-resolve is the easy metric. Knowing when not to auto-resolve is the hard one.**"

**Metadata to point at:**

- intent: `account_help`
- confidence: 90%
- cause: `suspected_compromise`
- tools called: `create_account_ticket` ✓
- **escalated** (amber card)

---

## Demo flow recommendations

### Order

1. **Access help** (Figma) — **opens with a wow moment** (duplicate detection). Sets expectation that this is more than a chatbot.
2. **Account help** (lockout) — shows auto-resolve. The "happy path" of automation.
3. **Ticket status** (INC-1042) — shows speed + plain-language translation. Quick.
4. **Compromise escalation** — the dramatic close. Shows the system has judgment.

### Pacing

- Don't read the chat responses verbatim — paraphrase. The screen shows the words; you provide the framing.
- Pause after each prompt while the status indicator runs. Let the audience see the pipeline working.
- After each response, point at one piece of metadata (intent, confidence, sources, latency) and explain why it matters. **One per demo, don't drown them in details.**

### Refresh between demos

Hit refresh in the browser between conversations 1, 2, and 3 so the screen is clean. **Exception:** for the compromise close, leave the previous conversation visible — it makes the amber escalation card stand out by contrast.

### What NOT to do during the demo

- **Don't open the Inspector during the live demo flow.** Save Inspector for a separate slide where you walk through it deliberately. Mid-demo screen-switching kills momentum.
- **Don't apologize for mocked components.** The ticket store is in-memory but it functions identically to a real one for demo purposes. Don't draw attention to it unless asked.
- **Don't try to demo `/api/metrics` live.** Talk about the numbers from a slide. Live JSON pages are bad demo screens.

### If the live demo crashes

Two backup plans:
1. **Recorded screen capture.** Record a clean run of the 4 demos this weekend and have it ready as a backup MP4 on Travis's laptop.
2. **Screenshots.** All 8 screenshots are in `docs/screenshots/` — switch to the slide with screenshots and walk through them as if they were live.

---

## Connection to slides

Each conversation has natural slide companions:

| Conversation | Best slide context | Rubric items |
|---|---|---|
| 1 · Figma access | "How the agents collaborate" | #3 (agent architecture), #5 (workflow automation) |
| 2 · Lockout | "What auto-resolve looks like" | #4 (RAG), #5 (workflow automation), #8 (validation) |
| 3 · INC-1042 | "Why we use LangGraph conditional edges" | #3 (architecture), #7 (technical implementation) |
| 4 · Compromise (bonus) | "When the system refuses to auto-resolve" | #2 (product ownership), #5 (workflow), #9 (trade-offs) |
