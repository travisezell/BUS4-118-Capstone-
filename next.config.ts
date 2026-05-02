import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // chromadb has optional peer deps (cohere-ai, voyageai, etc.) that we don't
  // use. Next.js's bundler still tries to resolve them and fails. Marking
  // chromadb as a "server external package" tells Next to load it natively
  // from node_modules at runtime instead of bundling it.
  serverExternalPackages: ["chromadb", "openai", "@modelcontextprotocol/sdk"],
};

export default nextConfig;