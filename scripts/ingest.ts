/**
 * Ingestion pipeline (PRD §8.1).
 *
 *   docs/kb/*.md  →  load  →  chunk  →  embed (OpenAI)  →  store (Chroma)
 *
 * Run with: `npm run ingest`
 *
 * Requires:
 *   - LLM_PROVIDER=openai  (so embeddings come from OpenAI)
 *   - OPENAI_API_KEY=...
 *   - VECTOR_STORE=chroma  (so the writes go to Chroma, not the in-memory store)
 *   - CHROMA_URL=http://localhost:8000  (matches docker-compose.yml)
 *
 * The script chunks by H2 heading. Each H2 section becomes one chunk
 * with `id = "<file-stem>-<slug>"`, `source = "docs/kb/<file>.md#<slug>"`.
 * That gives the assistant clean per-section citations.
 *
 * Re-running is safe: chunks are upserted by stable id.
 */

import { readdir, readFile } from "node:fs/promises";
import { join, basename, extname } from "node:path";
import { vectorStore } from "../src/infrastructure/lib/vector-store";
import { llm } from "../src/infrastructure/lib/llm";
import type { KBChunk } from "../src/domain/data/knowledge-base";

const KB_DIR = join(process.cwd(), "docs", "kb");

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 60);
}

/**
 * Split a markdown document on H2 (`## `) boundaries. The H1 (`# `)
 * becomes the document title; each H2 becomes a chunk whose content
 * is the section body. Lines before the first H2 are dropped (they
 * are usually just the H1).
 */
function chunkMarkdown(
  text: string,
  fileStem: string,
  fileRelPath: string
): KBChunk[] {
  const lines = text.split(/\r?\n/);
  const chunks: KBChunk[] = [];
  let currentTitle: string | null = null;
  let buf: string[] = [];

  const flush = () => {
    if (currentTitle === null) return;
    const body = buf.join("\n").trim();
    if (body.length === 0) return;
    const slug = slugify(currentTitle);
    chunks.push({
      id: `${fileStem}-${slug}`,
      source: `${fileRelPath}#${slug}`,
      content: `${currentTitle}\n\n${body}`,
    });
  };

  for (const line of lines) {
    const m = /^##\s+(.+?)\s*$/.exec(line);
    if (m) {
      flush();
      currentTitle = m[1];
      buf = [];
    } else if (currentTitle !== null) {
      buf.push(line);
    }
  }
  flush();
  return chunks;
}

async function main() {
  console.log("[ingest] starting");
  console.log(`[ingest] llm provider:   ${llm.name}`);
  console.log(`[ingest] vector store:   ${vectorStore.name}`);
  console.log(`[ingest] kb directory:   ${KB_DIR}`);

  if (vectorStore.name === "in-memory") {
    console.warn(
      "[ingest] WARNING: VECTOR_STORE is not set to 'chroma'. " +
        "This run will populate the in-memory store, which doesn't persist. " +
        "Set VECTOR_STORE=chroma to write to Chroma."
    );
  }
  if (llm.name === "mock") {
    console.warn(
      "[ingest] WARNING: LLM_PROVIDER is 'mock'. " +
        "Embeddings will be hash-based, not real. " +
        "Set LLM_PROVIDER=openai to use real OpenAI embeddings."
    );
  }

  let files: string[];
  try {
    files = (await readdir(KB_DIR)).filter((f) => f.endsWith(".md"));
  } catch (err) {
    console.error(`[ingest] could not read ${KB_DIR}:`, err);
    process.exit(1);
  }

  if (files.length === 0) {
    console.error(`[ingest] no markdown files found in ${KB_DIR}`);
    process.exit(1);
  }

  let totalChunks = 0;
  for (const f of files) {
    const stem = basename(f, extname(f));
    const rel = `docs/kb/${f}`;
    const text = await readFile(join(KB_DIR, f), "utf8");
    const chunks = chunkMarkdown(text, stem, rel);
    console.log(`[ingest] ${rel}: ${chunks.length} chunks`);
    for (const c of chunks) {
      await vectorStore.upsert(c);
      totalChunks += 1;
    }
  }

  console.log(
    `[ingest] done. ${totalChunks} chunks written to ${vectorStore.name}.`
  );
}

main().catch((err) => {
  console.error("[ingest] failed:", err);
  process.exit(1);
});
