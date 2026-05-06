import { NextResponse } from "next/server";
import { listTickets } from "@/src/data/tickets";
import { isJiraConfigured, jiraListTickets } from "@/src/data/jira-adapter";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const userId = url.searchParams.get("user_id") ?? undefined;

  if (isJiraConfigured()) {
    try {
      const tickets = await jiraListTickets();
      // Client-side filter by user_id if provided (Jira reporter email)
      const filtered = userId
        ? tickets.filter((t) => t.user_id === userId)
        : tickets;
      return NextResponse.json({ tickets: filtered });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return NextResponse.json(
        { error: `Jira error: ${message}` },
        { status: 502 }
      );
    }
  }

  const tickets = listTickets(userId);
  return NextResponse.json({ tickets });
}
