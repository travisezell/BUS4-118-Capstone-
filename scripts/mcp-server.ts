/**
 * IT Support MCP Server
 *
 * A standalone Model Context Protocol server that exposes the four
 * IT support tools defined in `src/mcp/tools.ts`. It speaks the real
 * MCP protocol over stdio and can be consumed by:
 *
 *   - This project's `StdioMCPClient` (via MCP_TRANSPORT=stdio)
 *   - Any MCP-aware client (Claude Desktop, MCP Inspector, etc.)
 *
 * Run directly:
 *
 *   npm run mcp:server
 *
 * Or point Claude Desktop at it via:
 *
 *   {
 *     "mcpServers": {
 *       "it-support": {
 *         "command": "npx",
 *         "args": ["tsx", "scripts/mcp-server.ts"],
 *         "cwd": "/absolute/path/to/this/repo"
 *       }
 *     }
 *   }
 *
 * Tool handlers come from `src/mcp/tools.ts` so the in-process server
 * and the real MCP server share the same business logic.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod";

import { tools as toolDefs } from "../src/mcp/tools";

/**
 * Build a Zod input schema from our internal `Schema` shape. The SDK's
 * `registerTool` accepts an object whose values are zod types — its
 * runtime then handles JSON Schema generation and validation for us.
 */
function buildZodSchema(
  schema: import("../src/mcp/tools").Schema
): Record<string, z.ZodType> {
  const out: Record<string, z.ZodType> = {};
  for (const [key, def] of Object.entries(schema)) {
    let base: z.ZodType;
    switch (def.type) {
      case "number":
        base = z.number();
        break;
      case "boolean":
        base = z.boolean();
        break;
      case "string":
      default:
        base = z.string();
    }
    out[key] = def.description ? base.describe(def.description) : base;
  }
  return out;
}

const server = new McpServer({
  name: "it-support-assistant",
  version: "0.1.0",
});

for (const tool of toolDefs) {
  server.registerTool(
    tool.name,
    {
      description: tool.description,
      inputSchema: buildZodSchema(tool.inputSchema),
    },
    async (args: Record<string, unknown>) => {
      const result = await tool.handler(args);
      // The MCP protocol returns a `content` array. We serialize the
      // ToolResult JSON into the text block so the client can parse it
      // back into the same shape the in-process server returns.
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result),
          },
        ],
        isError: !result.ok,
      };
    }
  );
}

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Important: log to stderr only — stdout is the MCP transport channel.
  console.error(
    `[mcp-server] connected. tools=${toolDefs.map((t) => t.name).join(", ")}`
  );
}

main().catch((err) => {
  console.error("[mcp-server] fatal:", err);
  process.exit(1);
});
