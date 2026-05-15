import { NextResponse } from "next/server";
import { listTicketsForApi } from "@/src/application/api/tickets";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const userId = url.searchParams.get("user_id") ?? undefined;

  try {
    const tickets = await listTicketsForApi(userId);
    return NextResponse.json({ tickets });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Jira error: ${message}` },
      { status: 502 }
    );
  }
}
