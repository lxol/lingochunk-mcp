import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { HttpConfig } from "./config.js";
import { LingoChunkClient } from "./client.js";
import { registerTools } from "./tools.js";

/** Options for the hosted (Streamable HTTP) server. */
export interface HttpServerOptions extends HttpConfig {
  /** Server version reported in the MCP handshake. */
  version: string;
}

// Remote MCP clients (claude.ai, ChatGPT, Le Chat, ...) call server-to-server,
// but browser-based clients (the MCP inspector, web IDEs) preflight with CORS.
// The wildcard origin is safe: authentication is a per-request Bearer token,
// never a cookie, so no ambient credentials can be replayed cross-origin.
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID",
  "Access-Control-Expose-Headers": "Mcp-Session-Id, Mcp-Protocol-Version",
};

function applyCors(res: ServerResponse): void {
  for (const [name, value] of Object.entries(CORS_HEADERS)) {
    res.setHeader(name, value);
  }
}

function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): void {
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(JSON.stringify(body));
}

/** Extract the Bearer credential, or null when absent/malformed. */
function bearerToken(req: IncomingMessage): string | null {
  const header = req.headers.authorization;
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header);
  const token = match?.[1]?.trim();
  return token ? token : null;
}

function unauthorized(res: ServerResponse): void {
  // JSON-RPC error shape so MCP clients surface the message; -32001 is the
  // de-facto "auth required" code used across MCP servers.
  sendJson(
    res,
    401,
    {
      jsonrpc: "2.0",
      error: {
        code: -32001,
        message:
          "Authentication required. Create a personal access token in your " +
          "LingoChunk account settings (Settings -> API tokens, it starts " +
          "with 'lcp_') and send it as 'Authorization: Bearer <token>'. " +
          "For clients without a token field (e.g. claude.ai custom " +
          "connectors), put it in the URL instead: /mcp/t/<token>.",
      },
      id: null,
    },
    { "WWW-Authenticate": 'Bearer realm="LingoChunk", error="invalid_token"' },
  );
}

/**
 * Serve the MCP server over Streamable HTTP for remote clients.
 *
 * Stateless by design: every POST builds a fresh McpServer + transport bound
 * to the caller's own Bearer token, so one process serves many users with no
 * session affinity and no token ever outliving its request. The token is not
 * validated here - it is forwarded verbatim and the LingoChunk API stays the
 * single authority (a bad token fails at the first tool call with the API's
 * own 401 message).
 *
 * Endpoints: POST /mcp (the MCP wire), GET /health (liveness). GET/DELETE
 * /mcp return 405: stateless mode has no server-push stream and no session
 * to delete.
 */
export function startHttpServer(options: HttpServerOptions): Promise<Server> {
  const httpServer = createServer((req, res) => {
    void handle(req, res, options).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`lingochunk-mcp http error: ${message}\n`);
      if (!res.headersSent) {
        sendJson(res, 500, {
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error." },
          id: null,
        });
      } else {
        res.end();
      }
    });
  });

  return new Promise((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(options.port, () => {
      httpServer.removeListener("error", reject);
      resolve(httpServer);
    });
  });
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  options: HttpServerOptions,
): Promise<void> {
  applyCors(res);
  // Serve the MCP wire on both /mcp and / : deployed behind a path-stripping
  // proxy (kamal-proxy --path-prefix /mcp strips by default), requests to
  // https://host/mcp arrive here as "/"; run directly (docker -p), they
  // arrive as "/mcp". Health likewise answers /health and /mcp/health.
  const rawPath = new URL(req.url ?? "/", "http://localhost").pathname;
  let path =
    rawPath === "/mcp" || rawPath === "/"
      ? "/"
      : rawPath.startsWith("/mcp/")
        ? rawPath.slice("/mcp".length)
        : rawPath;

  // Tokened-URL auth: /t/<token> is the MCP wire with the credential in the
  // path, for clients whose connector UI has no header/token field and no
  // OAuth-less fallback (claude.ai custom connectors). The URL is then a
  // secret - it lands in proxy/access logs - which is acceptable as a
  // documented stopgap because PATs are scoped and one-click revocable.
  // An Authorization header, when present, still wins below.
  let pathToken: string | null = null;
  const tokened = /^\/t\/([^/]+)$/.exec(path);
  if (tokened?.[1]) {
    pathToken = decodeURIComponent(tokened[1]).trim() || null;
    path = "/";
  }

  if (req.method === "OPTIONS") {
    res.writeHead(204).end();
    return;
  }

  if (path === "/health" && req.method === "GET") {
    sendJson(res, 200, {
      status: "ok",
      name: "lingochunk-mcp",
      version: options.version,
      transport: "streamable-http",
    });
    return;
  }

  if (path !== "/") {
    sendJson(res, 404, { detail: "Not found. The MCP endpoint is POST /mcp." });
    return;
  }

  if (req.method !== "POST") {
    sendJson(
      res,
      405,
      {
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message:
            "Method not allowed. This server is stateless: POST /mcp only.",
        },
        id: null,
      },
      { Allow: "POST" },
    );
    return;
  }

  const token = bearerToken(req) ?? pathToken;
  if (!token) {
    unauthorized(res);
    return;
  }

  // Fresh server per request: tools close over THIS caller's client. clipDir
  // is never used because remote mode does not register get_audio_clip.
  const client = new LingoChunkClient({
    baseUrl: options.baseUrl,
    token,
    clipDir: "",
  });
  const server = new McpServer({ name: "lingochunk", version: options.version });
  registerTools(server, client, { baseUrl: options.baseUrl, token, clipDir: "" }, "remote");

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });

  await server.connect(transport);
  await transport.handleRequest(req, res);
}
