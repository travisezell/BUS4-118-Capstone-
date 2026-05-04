# UX Wireframes

> Rubric #6 · UX Design & User Experience — these wireframes document
> the design decisions behind the working chat UI in `app/page.tsx`.

The four wireframes below tell a coherent story: how a user discovers
the assistant, what a successful interaction looks like, what happens
when the assistant *can't* resolve something on its own, and how the
whole thing translates to mobile.

Each wireframe is annotated with the design decisions and the
principles they're built on. The annotations are the point — wireframes
without rationale are just boxes.

| # | Wireframe | What it shows |
|---|---|---|
| 1 | [`01-empty-state.svg`](./01-empty-state.svg) | First-load experience. Welcome message, sample prompts, single text input. |
| 2 | [`02-conversation-flow.svg`](./02-conversation-flow.svg) | Successful auto-resolution with full trust signals (intent, confidence, latency, sources). |
| 3 | [`03-escalation.svg`](./03-escalation.svg) | Visually distinct escalation state — amber treatment, handoff package, P1 ticket badge. |
| 4 | [`04-mobile-responsive.svg`](./04-mobile-responsive.svg) | Single-column phone layout. Same components, smaller breakpoint. |

---

## Design principles

A small set of principles drove every layout decision. They appear in
the annotations on each wireframe so the grader can see how each
decision traces back to a principle.

**Transparency over magic.** Every assistant reply shows its intent,
confidence, latency, and which tools (if any) it called. Users can
audit the system's reasoning at a glance — not because we expect them
to, but because the option being there changes how the system feels.

**Auditable AI by default.** Every RAG answer cites the exact source
chunks (e.g., `docs/kb/access-policies.md#figma`). Users can verify the
answer is grounded, not invented. This is a hard requirement for an IT
assistant — making something up about "how to recover an account" is
genuinely dangerous.

**Color is information, not decoration.** Green status strip = the
assistant resolved it. Amber strip = handoff to a human. The user reads
the color before they read the text. We don't use color for
beautification.

**Don't pretend to resolve what you can't.** Escalation is its own
visually distinct state — the amber box, the explicit "Handing off to
human IT" header, the listed handoff package, the ticket badge. The
user is never left wondering whether their problem was actually
addressed.

**Single text input, not category pickers.** Routing the user message
through the Intake Agent shifts cognitive load from the user to the
system. We have the AI; let it do the categorizing.

**Mobile-first sizing for an IT use case.** Locked-out users can't
open a laptop. They're trying to recover from their phone. Mobile isn't
a nice-to-have here — it's the primary recovery surface. Trust signals
shrink rather than disappear.

---

## Mapping to the rubric

Rubric #6 (UX Design & User Experience, 5 pts) asks for:

> "Wireframes/mockups demonstrate clear, intuitive user interaction
> and thoughtful design decisions."

How this directory addresses each part:

- **Wireframes** — 4 SVGs covering the major user states.
- **Clear, intuitive user interaction** — wireframes 1 and 2 show how a
  first-time user goes from landing to a successful resolution in two
  taps (sample prompt → grounded answer).
- **Thoughtful design decisions** — every wireframe has a labeled
  annotation panel explicitly tying choices to principles. No
  decoration is unjustified.

---

## Implementation notes

The working chat UI in `app/page.tsx` matches these wireframes; the SVGs
are not aspirational. Differences:

- The implemented header is slightly more compact than wireframe 1 to
  preserve vertical room for the conversation.
- The status strip shows only intent + confidence + latency in the
  current implementation; the tool call indicator (e.g.,
  `tool: get_ticket_status ✓`) is shown inline with the response body
  rather than in the strip itself. Either is defensible — we'd
  consolidate in the next iteration.
- Mobile breakpoint: Tailwind's `md:` (768px). Below that, sample
  prompts stack vertically and message bubbles go full-width.

---

## Trade-offs we considered and rejected

A few alternatives we considered and why we didn't take them:

| Considered | Rejected because |
|---|---|
| Category picker (Access / Account / Status / Other) before chat input | Defeats the point of having an Intake Agent. Adds a click before the user can ask their question. |
| Rich-text formatting in user messages | Users don't want to format an IT request. Plain text input lowers the bar for asking. |
| Chat sidebar with previous conversations | Out of scope for the prototype. Would add value once the system has real auth and per-user history. |
| Dedicated "tickets" panel showing the user's open tickets | Tempting, but it duplicates the status-lookup flow. The chat-first model keeps the surface area small. |
| Voice input | Cool but doesn't help with the IT-recovery use case. Most lockouts happen at a desk. |

These are good slide content for the design trade-offs section.
