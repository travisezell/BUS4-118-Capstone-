/**
 * Seeded IT knowledge base.
 *
 * PRD §8.2: RAG sources cover access policies, account guidance, ticket
 * FAQs, and general IT FAQs. Each chunk has a stable ID and a source
 * label so the Knowledge Agent can attribute its answers.
 *
 * In production these chunks would be ingested from real markdown /
 * PDF / Confluence pages via `npm run ingest`. For the prototype the
 * docs live inline so the demo runs offline.
 */

export interface KBChunk {
  id: string;
  source: string;
  content: string;
}

export const knowledgeBase: KBChunk[] = [
  // ────────────────────────────────────────────────────────────────
  // Access policies
  // ────────────────────────────────────────────────────────────────
  {
    id: "access-policy-overview",
    source: "policies/access-overview.md",
    content:
      "All tool access requests at the company go through the IT request portal. Most SaaS tools require manager approval; the typical SLA is one business day. Self-service is available for a small set of low-risk tools.",
  },
  {
    id: "access-figma",
    source: "policies/access-figma.md",
    content:
      "Figma access requires manager approval. Submit a request through IT (or via this assistant) and your manager will receive a Slack notification. Once approved, IT will provision a Figma seat within one business day.",
  },
  {
    id: "access-github",
    source: "policies/access-github.md",
    content:
      "GitHub access requires manager approval and Security review for any repos containing customer data. Standard repo access is granted within one business day; sensitive repos may take 3-5 business days.",
  },
  {
    id: "access-slack",
    source: "policies/access-slack.md",
    content:
      "Slack access is auto-provisioned for all employees on day one. If you cannot log in to Slack, this is most likely an SSO issue — see the account help section.",
  },
  {
    id: "access-jira",
    source: "policies/access-jira.md",
    content:
      "Jira access is granted by project. Submit a request naming the project (e.g. PROJ, INFRA, MOBILE); the project lead reviews and approves. Standard SLA is two business days.",
  },
  {
    id: "access-aws",
    source: "policies/access-aws.md",
    content:
      "AWS console access requires manager approval AND completion of the cloud security training. Programmatic (CLI/API) access requires an additional security review and is granted only with a clear business justification.",
  },
  {
    id: "access-self-service-list",
    source: "policies/access-self-service.md",
    content:
      "Tools available for self-service activation (no ticket required): Notion (read-only by default, request edit access via team lead), Zoom, Calendly, and the company wiki. Open these tools and sign in with your corporate email.",
  },
  {
    id: "access-unsupported-tool",
    source: "policies/access-unsupported.md",
    content:
      "If the tool you are requesting is not on the approved tools list, IT cannot provision it directly. Submit a Tool Onboarding Request to the Procurement & Security team. Onboarding new tools typically takes 2-4 weeks for security and procurement review.",
  },

  // ────────────────────────────────────────────────────────────────
  // Account help: lockouts, passwords, MFA
  // ────────────────────────────────────────────────────────────────
  {
    id: "account-lockout-too-many-attempts",
    source: "policies/account-lockout.md",
    content:
      "If your account is locked due to too many failed login attempts, accounts auto-unlock after 30 minutes. To recover sooner, click 'Forgot password' on the login screen and follow the email reset link. Reset emails arrive within 5 minutes; check your spam folder if you do not see one.",
  },
  {
    id: "account-forgot-password",
    source: "policies/account-password.md",
    content:
      "To reset a forgotten password: 1) Go to the SSO login page. 2) Click 'Forgot password'. 3) Enter your corporate email. 4) Check your email for a reset link (valid for 30 minutes). 5) Set a new password meeting the password requirements (12+ characters, mix of letters/numbers/symbols, not reused from your last 5 passwords).",
  },
  {
    id: "account-password-requirements",
    source: "policies/password-requirements.md",
    content:
      "Password requirements: minimum 12 characters; must include at least one uppercase letter, one lowercase letter, one number, and one symbol; cannot match your last 5 passwords; cannot contain your name or username; rotation is no longer enforced unless a compromise is suspected.",
  },
  {
    id: "account-mfa-reset",
    source: "policies/mfa-reset.md",
    content:
      "If you lost access to your MFA device, IT must verify your identity before resetting MFA. This requires a video call with the Help Desk and a manager attestation. Allow up to 4 hours for an MFA reset during business hours; after-hours resets are queued until the next business morning.",
  },
  {
    id: "account-suspected-compromise",
    source: "policies/account-compromise.md",
    content:
      "If you suspect your account is compromised: do NOT change the password yourself yet. Open a Security ticket immediately so the SOC can preserve evidence and lock the account from the back end. Suspected compromise is a Priority 1 incident and is escalated to the Security on-call within 15 minutes.",
  },

  // ────────────────────────────────────────────────────────────────
  // Ticket lifecycle and status FAQs
  // ────────────────────────────────────────────────────────────────
  {
    id: "ticket-states",
    source: "faqs/ticket-states.md",
    content:
      "Ticket lifecycle states: open (queued for assignment), in_progress (actively being worked), waiting_on_user (we need information from you), waiting_on_approval (your manager or another approver hasn't acted yet), resolved (work is complete; the ticket auto-closes after 3 days), closed (final state, no further work).",
  },
  {
    id: "ticket-stale",
    source: "faqs/ticket-stale.md",
    content:
      "A ticket is considered stale if it has not had activity in more than 5 business days. Stale tickets are reviewed weekly by the IT lead and either reassigned, escalated, or closed with a note. Adding a comment to a stale ticket bumps it back into the active queue.",
  },
  {
    id: "ticket-priority-sla",
    source: "faqs/ticket-priority-sla.md",
    content:
      "Priority SLA targets: P1 (Critical, e.g. outage or security incident) — first response in 15 min, resolution in 4 hours. P2 (High) — first response in 1 business hour, resolution in 1 business day. P3 (Standard) — first response in 4 business hours, resolution in 3 business days. P4 (Low / informational) — best effort.",
  },

  // ────────────────────────────────────────────────────────────────
  // General IT FAQs
  // ────────────────────────────────────────────────────────────────
  {
    id: "wifi-setup",
    source: "faqs/wifi.md",
    content:
      "To connect to office Wi-Fi: select the 'Corp-Secure' network, sign in with your corporate email and password, and accept the certificate prompt. Guest Wi-Fi ('Corp-Guest') does not require login but cannot reach internal services. If Corp-Secure does not appear, file a Wi-Fi ticket with your office location.",
  },
  {
    id: "escalation-tiers",
    source: "faqs/escalation-tiers.md",
    content:
      "IT support escalation tiers: Tier 1 = this assistant + Help Desk for common requests (access, password, status). Tier 2 = specialist queues (Networking, Identity, Endpoints). Tier 3 = engineering on-call for systems issues. Security escalations bypass the tiers and go to the SOC immediately.",
  },
  {
    id: "contact-info",
    source: "faqs/contact.md",
    content:
      "Contacts: Help Desk Slack channel #it-help (monitored 8am-6pm local time). Help Desk email helpdesk@company.com. Emergency / outage: page IT on-call via the on-call page (link in the IT wiki). Security incidents: security@company.com or page Security on-call.",
  },
];
