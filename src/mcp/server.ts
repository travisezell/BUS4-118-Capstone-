/**
 * MCP-style tool server.
 *
 * PRD §10: the Workflow Agent talks to this server instead of calling
 * tool handlers directly. The contract is identical to a real MCP
 * server's `tools/list` and `tools/call` semantics — only the transport
 * is in-process for the prototype.
 *
 * Adding a real MCP transport later means replacing the `call()`
 * implementation with an HTTP/JSON-RPC client; agent code stays put.
 */

import { tools, type Tool } from "./tools";
import type { ToolResult } from "../agents/types";

class MCPServer {
  private byName: Map<string, Tool>;

  constructor(toolList: Tool[]) {
    this.byName = new Map(toolList.map((t) => [t.name, t]));
  }

  /** MCP `tools/list` — describe every registered tool. */
  list(): Array<{ name: string; description: string; inputSchema: Tool["inputSchema"] }> {
    return [...this.byName.values()].map(({ name, description, inputSchema }) => ({
      name,
      description,
      inputSchema,
    }));
  }

  /** MCP `tools/call` — invoke a tool by name. */
  async call(
    name: string,
    args: Record<string, unknown>
  ): Promise<ToolResult> {
    const tool = this.byName.get(name);
    if (!tool) {
      return { name, ok: false, error: `Unknown tool: ${name}` };
    }
    try {
      return await tool.handler(args);
    } catch (err) {
      // PRD §9.2: tool failures must surface to Escalation, not raw errors.
      const message = err instanceof Error ? err.message : String(err);
      return { name, ok: false, error: message };
    }
  }
}

export const mcpServer = new MCPServer(tools);
