import { NextResponse } from "next/server";
import { getTicket } from "@/src/data/tickets";
import { isJiraConfigured, jiraIssueToTicket } from "@/src/data/jira-adapter";
import { getIssue } from "@/src/lib/jira";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;

  if (isJiraConfigured()) {
    try {
      const issue = await getIssue(id);
      const ticket = jiraIssueToTicket(issue);
      return NextResponse.json({ ticket });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("404")) {
        return NextResponse.json(
          { error: `Ticket not found: ${id}` },
          { status: 404 }
        );
      }
      return NextResponse.json(
        { error: `Jira error: ${message}` },
        { status: 502 }
      );
    }
  }

  const ticket = getTicket(id);
  if (!ticket) {
    return NextResponse.json({ error: `Ticket not found: ${id}` }, { status: 404 });
  }
  return NextResponse.json({ ticket });
}
