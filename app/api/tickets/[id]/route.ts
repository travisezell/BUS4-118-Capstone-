import { NextResponse } from "next/server";
import { getTicketForApi } from "@/src/application/api/tickets";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;

  try {
    const ticket = await getTicketForApi(id);
    if (!ticket) {
      return NextResponse.json({ error: `Ticket not found: ${id}` }, { status: 404 });
    }
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
