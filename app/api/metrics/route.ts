import { NextResponse } from "next/server";
import { buildMetricsPayload } from "@/src/application/api/metrics";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const includeRequests = url.searchParams.get("requests") === "1";
  return NextResponse.json(buildMetricsPayload(includeRequests));
}
