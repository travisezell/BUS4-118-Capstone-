import { NextResponse } from "next/server";
import { mcpServer } from "@/src/mcp/server";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    ok: true,
    llmProvider: process.env.LLM_PROVIDER ?? "mock",
    mcpTools: mcpServer.list().map((t) => t.name),
    timestamp: new Date().toISOString(),
  });
}
