import { NextResponse } from "next/server";
import { listTickets } from "@/src/data/tickets";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const userId = url.searchParams.get("user_id") ?? undefined;
  const tickets = listTickets(userId);
  return NextResponse.json({ tickets });
}
