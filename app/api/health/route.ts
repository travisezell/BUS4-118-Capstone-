import { NextResponse } from "next/server";
import { mcpServer } from "@/src/mcp/server";
import { llm } from "@/src/lib/llm";
import { vectorStore } from "@/src/lib/vector-store";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    ok: true,
    llm: {
      provider: llm.name,
      embeddingDimensions: llm.embeddingDimensions ?? null,
      chatModel:
        "chatModel" in llm ? (llm as { chatModel?: string }).chatModel : null,
      embeddingModel:
        "embeddingModel" in llm
          ? (llm as { embeddingModel?: string }).embeddingModel
          : null,
    },
    vectorStore: {
      backend: vectorStore.name,
      chromaUrl:
        vectorStore.name === "chroma"
          ? process.env.CHROMA_URL || "http://localhost:8000"
          : null,
    },
    mcpTools: mcpServer.list().map((t) => t.name),
    timestamp: new Date().toISOString(),
  });
}
