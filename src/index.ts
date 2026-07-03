#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { LingoChunkClient } from "./client.js";
import { registerTools } from "./tools.js";

const VERSION = "0.2.1";

async function main(): Promise<void> {
  // Fail fast (to stderr, never stdout - stdout is the MCP wire) if the token
  // is missing, so onboarding surfaces the problem immediately.
  const config = loadConfig();
  const client = new LingoChunkClient(config);

  const server = new McpServer({ name: "lingochunk", version: VERSION });
  registerTools(server, client, config);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`lingochunk-mcp failed to start: ${message}\n`);
  process.exit(1);
});
