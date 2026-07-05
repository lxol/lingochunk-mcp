#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { LingoChunkClient } from "./client.js";
import { registerTools } from "./tools.js";

// Single source of truth for the version: the package manifest. A hardcoded
// copy here once drifted (the server reported 0.2.1 while npm shipped 0.3.0),
// which made "is my server up to date?" unanswerable.
const VERSION = (
  JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  ) as { version: string }
).version;

// `npx -y @lingochunk/mcp --version` prints the running version and exits,
// so users can compare against `npm view @lingochunk/mcp version` (README
// "Updating" section). Checked before any config loading: no token needed.
if (process.argv.includes("--version") || process.argv.includes("-v")) {
  process.stdout.write(`${VERSION}\n`);
  process.exit(0);
}

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
