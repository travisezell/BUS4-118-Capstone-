/**
 * Vector store
 *
 * PRD §8.3: a Chroma-backed similarity store. The prototype ships
 * BOTH backends behind one interface, selected via env vars:
 *
 *   - `InMemoryVectorStore` (default) — uses `llm.embed()` to embed the
 *     hardcoded chunks at boot. Works offline, used by the test suite.
 *
 *   - `ChromaVectorStore` — talks to a running Chroma server (see
 *     `docker-compose.yml`). Activated by `VECTOR_STORE=chroma` and
 *     `CHROMA_URL=http://localhost:8000`. Embeddings come from the
 *     selected `LLMProvider` (typically OpenAI).
 *
 * The Knowledge Agent depends only on the `VectorStore` interface,
 * so swapping backends is a one-line config change.
 */

import { knowledgeBase, type KBChunk } from "../data/knowledge-base";
import { llm } from "./llm";
import type { RetrievedChunk } from "../agents/types";

export interface VectorStore {
  /** Identifier for logs / health checks. */
  readonly name: string;
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
 * the vectors warm for subsequent queries. Blends cosine similarity
 * with keyword overlap so retrieval still ranks well even when the
 * embedding is uninformative (mock provider).
 */
export class InMemoryVectorStore implements VectorStore {
  readonly name = "in-memory";
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
        const cosine = dot(qVec, v);
        // Blend cosine with keyword overlap. With real OpenAI embeddings
        // the cosine signal carries; with the mock the keyword score
        // saves the ranking from being uninformative.
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

/**
 * Chroma-backed vector store.
 *
 * Connects to a running Chroma server (see `docker-compose.yml`) and
 * delegates similarity search to it. Embeddings come from the configured
 * `LLMProvider` so we don't ship two embedding functions.
 *
 * Collection name defaults to `it-support-kb`. The collection is created
 * lazily on first use and chunks are upserted by their stable `id`.
 */
export class ChromaVectorStore implements VectorStore {
  readonly name = "chroma";
  private collectionName: string;
  private url: string;
  private collectionPromise: Promise<unknown> | null = null;

  constructor(opts?: { url?: string; collection?: string }) {
    this.url = opts?.url || process.env.CHROMA_URL || "http://localhost:8000";
    this.collectionName =
      opts?.collection || process.env.CHROMA_COLLECTION || "it-support-kb";
  }

  private async getCollection() {
    if (!this.collectionPromise) {
      this.collectionPromise = (async () => {
        if (!llm.embed) {
          throw new Error(
            "ChromaVectorStore requires an LLM provider with embed() support."
          );
        }
        const mod = await import("chromadb");
        // chromadb v1.x: ChromaClient({ path })
        const ChromaClient = (mod as unknown as {
          ChromaClient: new (opts: { path: string }) => {
            getOrCreateCollection: (opts: {
              name: string;
              embeddingFunction: { generate: (texts: string[]) => Promise<number[][]> };
            }) => Promise<unknown>;
          };
        }).ChromaClient;

        const client = new ChromaClient({ path: this.url });
        const embeddingFunction = {
          generate: async (texts: string[]) => {
            const out: number[][] = [];
            for (const t of texts) {
              out.push(await llm.embed!(t));
            }
            return out;
          },
        };
        return await client.getOrCreateCollection({
          name: this.collectionName,
          embeddingFunction,
        });
      })();
    }
    return this.collectionPromise as Promise<{
      upsert: (args: {
        ids: string[];
        documents: string[];
        metadatas: Record<string, string>[];
      }) => Promise<void>;
      query: (args: {
        queryTexts: string[];
        nResults: number;
      }) => Promise<{
        ids: string[][];
        documents: (string | null)[][];
        distances: number[][];
        metadatas: (Record<string, string> | null)[][];
      }>;
    }>;
  }

  async upsert(chunk: KBChunk): Promise<void> {
    const col = await this.getCollection();
    await col.upsert({
      ids: [chunk.id],
      documents: [chunk.content],
      metadatas: [{ source: chunk.source }],
    });
  }

  async query(text: string, k: number): Promise<RetrievedChunk[]> {
    const col = await this.getCollection();
    const res = await col.query({ queryTexts: [text], nResults: k });

    const ids = res.ids[0] || [];
    const docs = res.documents[0] || [];
    const dists = res.distances[0] || [];
    const metas = res.metadatas[0] || [];

    const out: RetrievedChunk[] = [];
    for (let i = 0; i < ids.length; i++) {
      // Chroma returns L2 distance for default; we convert to a similarity
      // in [0, 1] so the rest of the pipeline treats it the same way as
      // the in-memory cosine score.
      const distance = dists[i] ?? 1;
      const score = Math.max(0, 1 - distance / 2);
      out.push({
        id: ids[i],
        source: metas[i]?.source || "unknown",
        content: docs[i] || "",
        score,
      });
    }
    return out;
  }
}

function selectStore(): VectorStore {
  const name = (process.env.VECTOR_STORE || "memory").toLowerCase();
  switch (name) {
    case "chroma":
      return new ChromaVectorStore();
    case "memory":
    case "in-memory":
    default:
      return new InMemoryVectorStore();
  }
}

export const vectorStore: VectorStore = selectStore();
