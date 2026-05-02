import { NextResponse } from "next/server";
import { getRequests, summarize } from "@/src/lib/metrics";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const includeRequests = url.searchParams.get("requests") === "1";
  const summary = summarize();
  return NextResponse.json({
    summary,
    requests: includeRequests ? getRequests() : undefined,
  });
}
