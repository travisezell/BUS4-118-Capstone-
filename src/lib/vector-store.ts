/**
 * Vector store
 *
 * PRD §8.3: a Chroma-backed similarity store. For the prototype we ship
 * an in-memory fallback that uses the same `embed()` function from
 * `llm.ts`, so retrieval works without spinning up Chroma.
 *
 * To switch to Chroma:
 *   1. `npm install chromadb`
 *   2. Set `CHROMA_URL` (default `http://localhost:8000`).
 *   3. Replace `InMemoryVectorStore` below with a thin wrapper around
 *      the Chroma client. The interface (`VectorStore`) does not change.
 */

import { knowledgeBase, type KBChunk } from "../data/knowledge-base";
import { llm } from "./llm";
import type { RetrievedChunk } from "../agents/types";

export interface VectorStore {
  /** Index a chunk for retrieval. Idempotent on `id`. */
  upsert(chunk: KBChunk): Promise<void>;
  /** Retrieve top-k chunks for a query. */
  query(text: string, k: number): Promise<RetrievedChunk[]>;
}

function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length && i < b.length; i++) s += a[i] * b[i];
  return s;
}

/**
 * Tiny in-memory store. Embeds chunks lazily on first query, then keeps
 * the vectors warm for subsequent queries.
 */
class InMemoryVectorStore implements VectorStore {
  private chunks: KBChunk[] = [];
  private embeddings: Map<string, number[]> = new Map();
  private warmed = false;

  async upsert(chunk: KBChunk): Promise<void> {
    const idx = this.chunks.findIndex((c) => c.id === chunk.id);
    if (idx >= 0) {
      this.chunks[idx] = chunk;
    } else {
      this.chunks.push(chunk);
    }
    this.embeddings.delete(chunk.id);
  }

  private async warm() {
    if (this.warmed) return;
    if (this.chunks.length === 0) {
      for (const c of knowledgeBase) {
        this.chunks.push(c);
      }
    }
    if (!llm.embed) {
      // No embedding capability — keyword search only.
      this.warmed = true;
      return;
    }
    for (const c of this.chunks) {
      if (!this.embeddings.has(c.id)) {
        const v = await llm.embed(c.content);
        this.embeddings.set(c.id, v);
      }
    }
    this.warmed = true;
  }

  async query(text: string, k: number): Promise<RetrievedChunk[]> {
    await this.warm();

    // Keyword score is a fallback / boost: counts overlapping terms.
    const queryTerms = text.toLowerCase().split(/\W+/).filter(Boolean);
    const keywordScore = (content: string): number => {
      const lc = content.toLowerCase();
      let hits = 0;
      for (const t of queryTerms) {
        if (t.length < 3) continue;
        if (lc.includes(t)) hits += 1;
      }
      return hits / Math.max(queryTerms.length, 1);
    };

    let scored: { chunk: KBChunk; score: number }[];

    if (llm.embed) {
      const qVec = await llm.embed(text);
      scored = this.chunks.map((c) => {
        const v = this.embeddings.get(c.id)!;
        const cosine = dot(qVec, v); // both are unit-normalized
        // Blend cosine with keyword overlap so the ranking still works
        // when our mock embedding is uninformative (it often is).
        const score = 0.6 * cosine + 0.4 * keywordScore(c.content);
        return { chunk: c, score };
      });
    } else {
      scored = this.chunks.map((c) => ({
        chunk: c,
        score: keywordScore(c.content),
      }));
    }

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, k)
      .map(({ chunk, score }) => ({
        id: chunk.id,
        source: chunk.source,
        content: chunk.content,
        score,
      }));
  }
}

export const vectorStore: VectorStore = new InMemoryVectorStore();
