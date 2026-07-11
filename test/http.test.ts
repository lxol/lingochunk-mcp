import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { startHttpServer } from "../src/http.js";

/** End-to-end over real sockets: a fake LingoChunk API upstream records the
 *  Authorization header of every request, and a real MCP SDK client speaks
 *  Streamable HTTP to the hosted server. This is the property that matters
 *  in remote mode: each caller's Bearer token - and only theirs - reaches
 *  the API. */

let fakeApi: Server;
let mcp: Server;
let mcpUrl: URL;
const upstreamAuth: string[] = [];

function port(server: Server): number {
  return (server.address() as AddressInfo).port;
}

async function mcpClient(token: string): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(mcpUrl, {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  const client = new Client({ name: "http-test", version: "0.0.0" });
  await client.connect(transport);
  return client;
}

beforeAll(async () => {
  fakeApi = createServer((req, res) => {
    upstreamAuth.push(req.headers.authorization ?? "");
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ url: "https://r2.example/presigned", expires_in: 300 }));
  });
  await new Promise<void>((resolve) => fakeApi.listen(0, resolve));

  mcp = await startHttpServer({
    baseUrl: `http://127.0.0.1:${port(fakeApi)}`,
    port: 0,
    version: "0.0.0-test",
  });
  mcpUrl = new URL(`http://127.0.0.1:${port(mcp)}/mcp`);
});

afterAll(async () => {
  await new Promise((resolve) => mcp.close(resolve));
  await new Promise((resolve) => fakeApi.close(resolve));
});

describe("hosted HTTP server", () => {
  it("reports liveness on /health without auth", async () => {
    const res = await fetch(new URL("/health", mcpUrl));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.name).toBe("lingochunk-mcp");
    expect(body.transport).toBe("streamable-http");
  });

  it("rejects an unauthenticated POST with 401 + WWW-Authenticate and onboarding help", async () => {
    const res = await fetch(mcpUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", method: "ping", id: 1 }),
    });
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toMatch(/Bearer/);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toMatch(/lcp_/);
    expect(body.error.message).toMatch(/API tokens/);
  });

  it("rejects a blank Bearer credential", async () => {
    const res = await fetch(mcpUrl, {
      method: "POST",
      headers: {
        Authorization: "Bearer   ",
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", method: "ping", id: 1 }),
    });
    expect(res.status).toBe(401);
  });

  it("completes the MCP handshake and lists the remote tool set", async () => {
    const client = await mcpClient("lcp_alpha");
    try {
      const { tools } = await client.listTools();
      const names = tools.map((t) => t.name);
      expect(names).toContain("get_vocabulary");
      expect(names).toContain("get_transcript");
      expect(names).toContain("save_lesson");
      // Local-filesystem tool must not be offered by a hosted server.
      expect(names).not.toContain("get_audio_clip");
      const audioUrl = tools.find((t) => t.name === "get_audio_url");
      expect(audioUrl?.description).not.toMatch(/get_audio_clip/);
      const library = tools.find((t) => t.name === "list_library");
      expect(library?.description).not.toMatch(/get_audio_clip/);
    } finally {
      await client.close();
    }
  });

  it("forwards each caller's own token to the API, per request", async () => {
    const alpha = await mcpClient("lcp_alpha");
    try {
      upstreamAuth.length = 0;
      const result = await alpha.callTool({
        name: "get_audio_url",
        arguments: { submission_id: "sub-1" },
      });
      expect(upstreamAuth).toEqual(["Bearer lcp_alpha"]);
      const text = (result.content as { type: string; text: string }[])
        .map((c) => c.text)
        .join("");
      expect(text).toContain("r2.example/presigned");
    } finally {
      await alpha.close();
    }

    // A different user on the same process reaches the API as themselves.
    const beta = await mcpClient("lcp_beta");
    try {
      upstreamAuth.length = 0;
      await beta.callTool({
        name: "get_audio_url",
        arguments: { submission_id: "sub-2" },
      });
      expect(upstreamAuth).toEqual(["Bearer lcp_beta"]);
    } finally {
      await beta.close();
    }
  });

  it("answers GET /mcp with 405: stateless mode has no server-push stream", async () => {
    const res = await fetch(mcpUrl, {
      headers: { Accept: "text/event-stream", Authorization: "Bearer lcp_x" },
    });
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("POST");
  });

  it("404s unknown paths with a pointer to the endpoint", async () => {
    const res = await fetch(new URL("/nope", mcpUrl));
    expect(res.status).toBe(404);
  });

  it("serves the MCP wire at / too (path-stripping proxy) and health at /mcp/health", async () => {
    // Behind kamal-proxy's --path-prefix /mcp (strip on by default), a client
    // request to https://host/mcp reaches the server as "/".
    const rootUrl = new URL("/", mcpUrl);
    const res = await fetch(rootUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", method: "ping", id: 1 }),
    });
    expect(res.status).toBe(401); // reached the MCP handler (auth gate), not a 404

    const health = await fetch(new URL("/mcp/health", mcpUrl));
    expect(health.status).toBe(200);
  });

  it("authenticates via a tokened URL (/t/<token>) for clients with no token field", async () => {
    // claude.ai custom connectors offer only OAuth or nothing - no header
    // field - so the credential can ride the URL path instead.
    const transport = new StreamableHTTPClientTransport(
      new URL("/t/lcp_urltoken", mcpUrl),
    );
    const client = new Client({ name: "url-token-test", version: "0.0.0" });
    await client.connect(transport);
    try {
      upstreamAuth.length = 0;
      await client.callTool({
        name: "get_audio_url",
        arguments: { submission_id: "sub-3" },
      });
      expect(upstreamAuth).toEqual(["Bearer lcp_urltoken"]);
    } finally {
      await client.close();
    }
  });

  it("also accepts the tokened URL under the /mcp prefix (direct access)", async () => {
    const res = await fetch(new URL("/mcp/t/lcp_x", mcpUrl), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", method: "ping", id: 1 }),
    });
    expect(res.status).toBe(200); // past the auth gate, handled by the transport
  });

  it("an Authorization header outranks the URL token", async () => {
    const transport = new StreamableHTTPClientTransport(
      new URL("/t/lcp_from_url", mcpUrl),
      { requestInit: { headers: { Authorization: "Bearer lcp_from_header" } } },
    );
    const client = new Client({ name: "precedence-test", version: "0.0.0" });
    await client.connect(transport);
    try {
      upstreamAuth.length = 0;
      await client.callTool({
        name: "get_audio_url",
        arguments: { submission_id: "sub-4" },
      });
      expect(upstreamAuth).toEqual(["Bearer lcp_from_header"]);
    } finally {
      await client.close();
    }
  });

  it("a blank URL token still 401s", async () => {
    const res = await fetch(new URL("/t/%20", mcpUrl), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", method: "ping", id: 1 }),
    });
    expect(res.status).toBe(401);
  });
});
