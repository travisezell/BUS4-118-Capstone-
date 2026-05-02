import { NextResponse } from "next/server";
import { getTicket } from "@/src/data/tickets";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const ticket = getTicket(id);
  if (!ticket) {
    return NextResponse.json({ error: `Ticket not found: ${id}` }, { status: 404 });
  }
  return NextResponse.json({ ticket });
}
