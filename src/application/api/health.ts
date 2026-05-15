import { mcpServer } from "../../infrastructure/mcp/server";
import { llm } from "../../infrastructure/lib/llm";
import { vectorStore } from "../../infrastructure/lib/vector-store";

export function buildHealthPayload() {
  return {
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
  };
}
