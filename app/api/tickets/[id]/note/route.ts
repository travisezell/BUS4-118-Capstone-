import { NextResponse } from "next/server";
import { updateTicketWithNote } from "@/src/data/tickets";
import { isJiraConfigured, jiraUpdateTicketWithNote } from "@/src/data/jira-adapter";

export const runtime = "nodejs";

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;

  let body: { note?: unknown };
  try {
    body = (await req.json()) as { note?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { note } = body;
  if (!note || typeof note !== "string" || note.trim().length === 0) {
    return NextResponse.json(
      { error: "`note` is required and must be a non-empty string." },
      { status: 400 }
    );
  }

  const ok = isJiraConfigured()
    ? await jiraUpdateTicketWithNote(id, note.trim())
    : updateTicketWithNote(id, note.trim());

  if (!ok) {
    return NextResponse.json(
      { error: `Ticket not found: ${id}` },
      { status: 404 }
    );
  }

  return NextResponse.json({ ok: true, ticket_id: id });
}
