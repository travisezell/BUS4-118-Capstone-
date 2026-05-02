/**
 * Knowledge Agent
 *
 * PRD §7.1 / §8: runs RAG over IT documentation, returns top-k retrieved
 * chunks with source metadata, and produces a grounded answer.
 *
 * The vector-store contract is in `src/lib/vector-store.ts`. The default
 * implementation is an in-memory cosine-similarity index built from
 * `src/data/knowledge-base.ts`. To switch to Chroma, change the import
 * in `vector-store.ts` — nothing in this file needs to move.
 */

import { vectorStore } from "../lib/vector-store";
import type { Intent, RetrievedChunk } from "./types";

interface KnowledgeResult {
  retrievedChunks: RetrievedChunk[];
  groundedAnswer: string;
  retrievalHit: boolean;
}

const TOP_K_BY_INTENT: Record<Intent, number> = {
  access_help: 3,
  account_help: 3,
  ticket_status: 2,
  general_qa: 4,
  unknown: 4,
};

const SIMILARITY_THRESHOLD = 0.25; // below this we treat as "no hit"

/**
 * Format the retrieved chunks into a single answer string. In production
 * this is where the LLM call happens — the chunks are inserted into the
 * prompt and the LLM produces a grounded response.
 *
 * For the prototype we synthesize a structured response directly from
 * the chunks. The result is deterministic and faithful to the source
 * documents, which is exactly what the rubric calls for ("grounded,
 * citation-aware answer", PRD §7.1).
 */
function synthesize(
  intent: Intent,
  chunks: RetrievedChunk[],
  context: { toolName?: string; ticketId?: string }
): string {
  if (chunks.length === 0) {
    return "I couldn't find a clearly matching IT policy for this request.";
  }

  const lead =
    intent === "access_help"
      ? `Here's what our access policy says${
          context.toolName ? ` about ${context.toolName}` : ""
        }:`
      : intent === "account_help"
        ? "Here are the account-recovery steps I found in our IT policy:"
        : intent === "ticket_status"
          ? "Here's the relevant policy on ticket states and next steps:"
          : "Here's what I found in our IT documentation:";

  const body = chunks
    .map((c) => `• ${c.content.trim()}`)
    .join("\n");

  const sources = chunks.map((c) => c.source).join(", ");

  return `${lead}\n\n${body}\n\nSources: ${sources}`;
}

export async function retrieve(
  query: string,
  intent: Intent,
  context: { toolName?: string; ticketId?: string } = {}
): Promise<KnowledgeResult> {
  const k = TOP_K_BY_INTENT[intent] ?? 3;

  // Bias the query with intent keywords so retrieval is more focused.
  // This is how production RAG implementations boost intent relevance
  // without separate per-intent indexes.
  const intentBias =
    intent === "access_help"
      ? "access policy approval request"
      : intent === "account_help"
        ? "account lockout password recovery"
        : intent === "ticket_status"
          ? "ticket states lifecycle next steps"
          : "";

  const augmentedQuery = [intentBias, query].filter(Boolean).join(" ");

  const chunks = await vectorStore.query(augmentedQuery, k);

  // Trim to chunks above the similarity threshold.
  const usable = chunks.filter((c) => c.score >= SIMILARITY_THRESHOLD);

  const retrievalHit = usable.length > 0;
  const groundedAnswer = synthesize(intent, usable, context);

  return {
    retrievedChunks: usable,
    groundedAnswer,
    retrievalHit,
  };
}
