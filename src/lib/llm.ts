/**
 * Pluggable LLM provider.
 *
 * PRD section 10.1: `generateResponse(prompt, context)` is the single
 * contract; OpenAI / Ollama implementations are selected via the
 * `LLM_PROVIDER` env var at boot.
 *
 * Three providers ship out of the box:
 *
 *   - `MockProvider`. Deterministic, hash based. No API key needed.
 *     Used by the test suite and when `LLM_PROVIDER=mock` (the default).
 *
 *   - `OpenAIProvider`. Real OpenAI calls.
 *     - Embeddings: `text-embedding-3-small` (1536 dims, ~$0.02/1M tokens)
 *     - Chat:       `gpt-4o-mini` (cheap, fast, more than capable here)
 *     Activated by `LLM_PROVIDER=openai` + `OPENAI_API_KEY=...`.
 *
 *   - `OllamaProvider`. Real local LLM via Ollama's REST API.
 *     - Embeddings: `nomic-embed-text` (768 dims, free, local)
 *     - Chat:       `llama3.1` (free, local, ~1-5s/query on a laptop)
 *     Activated by `LLM_PROVIDER=ollama`. Requires Ollama running locally.
 *     See README "Path C — fully local development" for setup.
 *
 * Agent code only depends on `LLMProvider`, never on a concrete SDK.
 * That's how we keep the prototype testable without API keys and how
 * we let groupmates run the system locally without paying for OpenAI.
 */

export interface LLMProvider {
  /** Identifies the provider for logging / health checks. */
  readonly name: string;
  /** Generate a text completion. */
  generateResponse(prompt: string, context?: string): Promise<string>;
  /** Optional: produce an embedding vector for RAG. */
  embed?(text: string): Promise<number[]>;
  /** Dimensionality of vectors returned by `embed()`. Used by the vector store. */
  readonly embeddingDimensions?: number;
}

/**
 * Mock provider — returns deterministic, recognizable output.
 * Good enough to demo the multi-agent flow without API keys.
 */
export class MockProvider implements LLMProvider {
  readonly name = "mock";
  readonly embeddingDimensions = 64;

  async generateResponse(prompt: string, context?: string): Promise<string> {
    const head = prompt.slice(0, 80).replace(/\s+/g, " ").trim();
    return [
      `[mock-llm] Acknowledged prompt: "${head}${prompt.length > 80 ? "…" : ""}"`,
      context ? `[mock-llm] Context summary: ${context.slice(0, 200)}` : null,
    ]
      .filter(Boolean)
      .join("\n");
  }

  async embed(text: string): Promise<number[]> {
    // A tiny, stable hash-based embedding so retrieval is reproducible.
    // Real systems use OpenAI's text-embedding-3-small (1536 dims).
    // This is intentionally low-dimensional for fast tests.
    const dim = this.embeddingDimensions;
    const v = new Array<number>(dim).fill(0);
    for (let i = 0; i < text.length; i++) {
      const idx = text.charCodeAt(i) % dim;
      v[idx] += 1;
    }
    // L2-normalize so cosine similarity is well-behaved.
    const norm = Math.sqrt(v.reduce((acc, x) => acc + x * x, 0)) || 1;
    return v.map((x) => x / norm);
  }
}

/**
 * Real OpenAI provider.
 *
 * Lazily imports the `openai` package so projects that don't install it
 * (e.g. CI running with mocks) still type-check and run.
 */
export class OpenAIProvider implements LLMProvider {
  readonly name = "openai";
  readonly embeddingDimensions = 1536; // text-embedding-3-small default
  readonly embeddingModel: string;
  readonly chatModel: string;
  // Use `unknown` to avoid a hard type dep on the openai package at compile time.
  private clientPromise: Promise<unknown> | null = null;

  constructor(opts?: { embeddingModel?: string; chatModel?: string }) {
    this.embeddingModel =
      opts?.embeddingModel ||
      process.env.OPENAI_EMBEDDING_MODEL ||
      "text-embedding-3-small";
    this.chatModel =
      opts?.chatModel || process.env.OPENAI_CHAT_MODEL || "gpt-4o-mini";
  }

  private async getClient(): Promise<{
    chat: { completions: { create: (args: unknown) => Promise<unknown> } };
    embeddings: { create: (args: unknown) => Promise<unknown> };
  }> {
    if (!this.clientPromise) {
      this.clientPromise = (async () => {
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
          throw new Error(
            "OPENAI_API_KEY is not set. Add it to .env.local or run with LLM_PROVIDER=mock."
          );
        }
        // Dynamic import keeps the dependency optional at compile time.
        const mod = await import("openai");
        const OpenAICtor = (mod as unknown as { default: new (opts: { apiKey: string }) => unknown }).default;
        return new OpenAICtor({ apiKey });
      })();
    }
    return this.clientPromise as Promise<{
      chat: { completions: { create: (args: unknown) => Promise<unknown> } };
      embeddings: { create: (args: unknown) => Promise<unknown> };
    }>;
  }

  async generateResponse(prompt: string, context?: string): Promise<string> {
    const client = await this.getClient();
    const messages: { role: "system" | "user"; content: string }[] = [
      {
        role: "system",
        content:
          "You are an internal IT support assistant. Answer using ONLY the provided context. " +
          "Be concise. If the context does not contain the answer, say so plainly. " +
          "Do not invent policies, ticket IDs, or tool names.",
      },
    ];
    if (context && context.trim().length > 0) {
      messages.push({
        role: "user",
        content: `CONTEXT:\n${context}\n\nQUESTION:\n${prompt}`,
      });
    } else {
      messages.push({ role: "user", content: prompt });
    }
    const completion = (await client.chat.completions.create({
      model: this.chatModel,
      messages,
      temperature: 0.2,
      max_tokens: 400,
    })) as { choices: { message?: { content?: string } }[] };
    return completion.choices[0]?.message?.content?.trim() || "";
  }

  async embed(text: string): Promise<number[]> {
    const client = await this.getClient();
    const res = (await client.embeddings.create({
      model: this.embeddingModel,
      input: text,
    })) as { data: { embedding: number[] }[] };
    return res.data[0].embedding;
  }
}

/**
 * Real Ollama provider. Talks to a local Ollama daemon via its standard
 * REST API on port 11434. No SDK dependency required, just `fetch`.
 *
 * Default models:
 *   - chat: `llama3.1` (about 4.7 GB download, runs fine on most laptops)
 *   - embeddings: `nomic-embed-text` (about 270 MB, 768 dim vectors)
 *
 * Both can be overridden via env vars:
 *   - `OLLAMA_CHAT_MODEL`
 *   - `OLLAMA_EMBEDDING_MODEL`
 *   - `OLLAMA_HOST` (defaults to `http://localhost:11434`)
 *
 * Setup for groupmates without an OpenAI key:
 *   1. Install Ollama from https://ollama.com/download
 *   2. Pull the models:
 *        ollama pull llama3.1
 *        ollama pull nomic-embed-text
 *   3. Set `LLM_PROVIDER=ollama` in `.env.local`
 *   4. Run `npm run ingest` and `npm run dev`
 *
 * Note: Ollama's vector dimension (768) differs from OpenAI's (1536),
 * so the Chroma collection is provider specific. Switching providers
 * after ingest requires re ingesting. The vector store uses the
 * provider's `embeddingDimensions` to size the collection correctly.
 */
export class OllamaProvider implements LLMProvider {
  readonly name = "ollama";
  readonly embeddingDimensions = 768; // nomic-embed-text default
  readonly chatModel: string;
  readonly embeddingModel: string;
  readonly host: string;

  constructor(opts?: {
    chatModel?: string;
    embeddingModel?: string;
    host?: string;
  }) {
    this.chatModel =
      opts?.chatModel || process.env.OLLAMA_CHAT_MODEL || "llama3.1";
    this.embeddingModel =
      opts?.embeddingModel ||
      process.env.OLLAMA_EMBEDDING_MODEL ||
      "nomic-embed-text";
    this.host =
      opts?.host || process.env.OLLAMA_HOST || "http://localhost:11434";
  }

  async generateResponse(prompt: string, context?: string): Promise<string> {
    const messages: { role: "system" | "user"; content: string }[] = [
      {
        role: "system",
        content:
          "You are an internal IT support assistant. Answer using ONLY the provided context. " +
          "Be concise. If the context does not contain the answer, say so plainly. " +
          "Do not invent policies, ticket IDs, or tool names.",
      },
    ];
    if (context && context.trim().length > 0) {
      messages.push({
        role: "user",
        content: `CONTEXT:\n${context}\n\nQUESTION:\n${prompt}`,
      });
    } else {
      messages.push({ role: "user", content: prompt });
    }

    let res: Response;
    try {
      res = await fetch(`${this.host}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.chatModel,
          messages,
          stream: false,
          options: {
            temperature: 0.2,
            num_predict: 400,
          },
        }),
      });
    } catch (err) {
      throw new Error(
        `[ollama] Could not reach ${this.host}. Is Ollama running? ` +
          `Install from https://ollama.com/download and run 'ollama serve'. ` +
          `Original error: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `[ollama] Chat request failed (${res.status}): ${body.slice(0, 200)}`
      );
    }

    const data = (await res.json()) as {
      message?: { content?: string };
    };
    return data.message?.content?.trim() || "";
  }

  async embed(text: string): Promise<number[]> {
    let res: Response;
    try {
      res = await fetch(`${this.host}/api/embeddings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.embeddingModel,
          prompt: text,
        }),
      });
    } catch (err) {
      throw new Error(
        `[ollama] Could not reach ${this.host}. Is Ollama running? ` +
          `Original error: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `[ollama] Embedding request failed (${res.status}): ${body.slice(0, 200)}`
      );
    }

    const data = (await res.json()) as { embedding: number[] };
    if (!Array.isArray(data.embedding)) {
      throw new Error(
        `[ollama] Embedding response missing 'embedding' array. ` +
          `Did you 'ollama pull ${this.embeddingModel}'?`
      );
    }
    return data.embedding;
  }
}

function selectProvider(): LLMProvider {
  const name = (process.env.LLM_PROVIDER || "mock").toLowerCase();
  switch (name) {
    case "openai":
      return new OpenAIProvider();
    case "ollama":
      return new OllamaProvider();
    case "gemini":
      // Not implemented in this iteration. Fall back so the app still runs.
      console.warn(
        `[llm] LLM_PROVIDER=gemini is declared but not implemented; using mock.`
      );
      return new MockProvider();
    case "mock":
    default:
      return new MockProvider();
  }
}

export const llm: LLMProvider = selectProvider();
