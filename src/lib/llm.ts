/**
 * Pluggable LLM provider.
 *
 * PRD §10.1: `generateResponse(prompt, context)` is the single contract;
 * OpenAI / Gemini / Ollama implementations are selected via the
 * `LLM_PROVIDER` env var at boot.
 *
 * The default provider is a deterministic mock used for offline
 * development and tests. To enable a real provider:
 *
 *   1. `npm install openai` (or your provider SDK).
 *   2. Set `LLM_PROVIDER=openai` and `OPENAI_API_KEY=...`.
 *   3. Implement `OpenAIProvider` below.
 *
 * The agent code must only depend on `LLMProvider`, never on a concrete
 * SDK. That's how we keep the prototype testable without API keys.
 */

export interface LLMProvider {
  /** Generate a text completion. */
  generateResponse(prompt: string, context?: string): Promise<string>;
  /** Optional: produce an embedding vector for RAG. */
  embed?(text: string): Promise<number[]>;
}

/**
 * Mock provider — returns deterministic, recognizable output.
 * Good enough to demo the multi-agent flow without API keys.
 */
class MockProvider implements LLMProvider {
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
    // Real systems use OpenAI's text-embedding-3-small (1536 dims) or
    // similar. This is intentionally low-dimensional for fast tests.
    const dim = 64;
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

function selectProvider(): LLMProvider {
  const name = (process.env.LLM_PROVIDER || "mock").toLowerCase();
  switch (name) {
    case "openai":
    case "gemini":
    case "ollama":
      // Real providers go here. Until then the mock keeps things working.
      // See `docs/ARCHITECTURE.md` "Pluggable Providers" for the contract.
      return new MockProvider();
    case "mock":
    default:
      return new MockProvider();
  }
}

export const llm: LLMProvider = selectProvider();
