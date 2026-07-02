import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { LingoChunkClient } from "../src/client.js";
import type { Config } from "../src/config.js";
import { registerTools } from "../src/tools.js";

type Handler = (args: Record<string, unknown>) => Promise<CallToolResult>;

/** A stand-in server that just captures the registered tool handlers, so we can
 *  call them directly without the full MCP protocol machinery. */
function fakeServer(): { server: McpServer; handlers: Map<string, Handler> } {
  const handlers = new Map<string, Handler>();
  const server = {
    registerTool(name: string, _config: unknown, handler: Handler): void {
      handlers.set(name, handler);
    },
  } as unknown as McpServer;
  return { server, handlers };
}

let clipDir: string;
let handlers: Map<string, Handler>;
let lastUrl = "";
let lastInit: RequestInit = {};

beforeEach(async () => {
  clipDir = await fs.mkdtemp(path.join(os.tmpdir(), "lc-mcp-test-"));
  const config: Config = { baseUrl: "https://api.test", token: "lcp_test", clipDir };
  const client = new LingoChunkClient(config);
  const fake = fakeServer();
  handlers = fake.handlers;
  registerTools(fake.server, client, config);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(clipDir, { recursive: true, force: true });
});

/** Install a fetch mock that records the request and returns `response`. */
function mockFetch(response: Response): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL, init?: RequestInit) => {
      lastUrl = String(input);
      lastInit = init ?? {};
      return response;
    }),
  );
}

function jsonResponse(body: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

async function call(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
  const handler = handlers.get(name);
  if (!handler) throw new Error(`no handler for ${name}`);
  return handler(args);
}

function textOf(result: CallToolResult): string {
  return result.content
    .map((c) => (c.type === "text" ? c.text : ""))
    .join("\n");
}

describe("tool registration", () => {
  it("registers all seven tools", () => {
    expect([...handlers.keys()].sort()).toEqual(
      [
        "get_audio_clip",
        "get_audio_url",
        "get_transcript",
        "get_vocabulary",
        "list_library",
        "lookup_word",
        "search_examples",
      ].sort(),
    );
  });
});

describe("happy paths", () => {
  it("get_vocabulary builds the right URL, sends the bearer token, returns JSON", async () => {
    mockFetch(jsonResponse({ items: [], next_cursor: null }));
    const result = await call("get_vocabulary", {
      language: "de",
      status: "learning",
      limit: 5,
    });
    expect(lastUrl).toContain("https://api.test/api/v1/vocab?");
    expect(lastUrl).toContain("language=de");
    expect(lastUrl).toContain("status=learning");
    expect(lastUrl).toContain("limit=5");
    expect((lastInit.headers as Record<string, string>).Authorization).toBe(
      "Bearer lcp_test",
    );
    expect(JSON.parse(textOf(result))).toEqual({ items: [], next_cursor: null });
  });

  it("lookup_word hits /vocab/lookup", async () => {
    mockFetch(jsonResponse({ lemma: "Haus" }));
    await call("lookup_word", { lemma: "Haus", language: "de" });
    expect(lastUrl).toContain("/api/v1/vocab/lookup?");
    expect(lastUrl).toContain("lemma=Haus");
    expect(lastUrl).toContain("language=de");
  });

  it("list_library hits /library", async () => {
    mockFetch(jsonResponse({ items: [], next_cursor: null }));
    await call("list_library", { limit: 2 });
    expect(lastUrl).toContain("/api/v1/library?");
    expect(lastUrl).toContain("limit=2");
  });

  it("get_transcript encodes the submission id and passes the slice params", async () => {
    mockFetch(jsonResponse({ transcript_state: "ready", sentences: [] }));
    await call("get_transcript", {
      submission_id: "abc/123",
      from_sentence: 2,
      to_sentence: 4,
    });
    expect(lastUrl).toContain("/api/v1/submissions/abc%2F123/transcript?");
    expect(lastUrl).toContain("from_sentence=2");
    expect(lastUrl).toContain("to_sentence=4");
  });

  it("get_audio_url hits /audio-url", async () => {
    mockFetch(jsonResponse({ url: "https://r2/x", expires_in: 3600 }));
    await call("get_audio_url", { submission_id: "abc" });
    expect(lastUrl).toContain("/api/v1/submissions/abc/audio-url");
  });

  it("search_examples hits /sentences/search", async () => {
    mockFetch(jsonResponse({ hits: [] }));
    await call("search_examples", { lemma: "doch", limit: 10 });
    expect(lastUrl).toContain("/api/v1/sentences/search?");
    expect(lastUrl).toContain("lemma=doch");
  });

  it("get_audio_clip saves the bytes to a file and returns its path", async () => {
    const bytes = Buffer.from([0, 1, 2, 3, 4]);
    mockFetch(
      new Response(bytes, { status: 200, headers: { "content-type": "audio/mp4" } }),
    );
    const result = await call("get_audio_clip", {
      submission_id: "abc",
      start: 1,
      end: 3,
    });
    expect(lastUrl).toContain("/api/v1/submissions/abc/clip?");
    expect(lastUrl).toContain("start=1");
    expect(lastUrl).toContain("end=3");
    const payload = JSON.parse(textOf(result));
    expect(payload.media_type).toBe("audio/mp4");
    expect(payload.size_bytes).toBe(5);
    expect(payload.path).toBe(path.join(clipDir, "clip-abc-1-3.m4a"));
    const written = await fs.readFile(payload.path);
    expect(written.equals(bytes)).toBe(true);
  });

  it("get_audio_clip picks the file extension from the content type", async () => {
    mockFetch(
      new Response(Buffer.from([9, 9]), {
        status: 200,
        headers: { "content-type": "audio/mpeg" },
      }),
    );
    const result = await call("get_audio_clip", {
      submission_id: "xyz",
      start: 0,
      end: 2,
    });
    const payload = JSON.parse(textOf(result));
    expect(payload.media_type).toBe("audio/mpeg");
    expect(payload.path).toBe(path.join(clipDir, "clip-xyz-0-2.mp3"));
  });
});

describe("error mapping", () => {
  it("401 tells the user to check LINGOCHUNK_TOKEN", async () => {
    mockFetch(jsonResponse({ detail: "Invalid or missing API token" }, 401));
    const result = await call("get_vocabulary", {});
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("401");
    expect(textOf(result)).toContain("LINGOCHUNK_TOKEN");
  });

  it("403 surfaces the missing scope and how to fix it", async () => {
    mockFetch(
      jsonResponse(
        { detail: "This token is missing the required scope(s): content:read" },
        403,
      ),
    );
    const result = await call("list_library", {});
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("content:read");
    expect(textOf(result)).toContain("Mint a new token");
  });

  it("429 surfaces Retry-After", async () => {
    mockFetch(
      jsonResponse({ detail: "API rate limit exceeded. Please slow down." }, 429, {
        "retry-after": "30",
      }),
    );
    const result = await call("get_audio_clip", {
      submission_id: "abc",
      start: 1,
      end: 3,
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("retry after 30s");
  });

  it("400 passes the detail through", async () => {
    mockFetch(jsonResponse({ detail: "Provide at least one of 'lemma' or 'q'" }, 400));
    const result = await call("search_examples", {});
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("Provide at least one of 'lemma' or 'q'");
  });

  it("404 passes the detail through", async () => {
    mockFetch(jsonResponse({ detail: "Submission not found" }, 404));
    const result = await call("get_transcript", { submission_id: "nope" });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("Submission not found");
  });
});
