import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { LingoChunkClient } from "../src/client.js";
import type { Config } from "../src/config.js";
import { registerTools } from "../src/tools.js";

type Handler = (args: Record<string, unknown>) => Promise<CallToolResult>;

interface Registered {
  handler: Handler;
  schema: z.ZodRawShape;
}

/** A stand-in server that captures each tool's schema and handler, so `call`
 *  can validate + transform args exactly as the real server would before the
 *  handler runs. */
function fakeServer(): { server: McpServer; tools: Map<string, Registered> } {
  const tools = new Map<string, Registered>();
  const server = {
    registerTool(
      name: string,
      config: { inputSchema: z.ZodRawShape },
      handler: Handler,
    ): void {
      tools.set(name, { handler, schema: config.inputSchema });
    },
  } as unknown as McpServer;
  return { server, tools };
}

let clipDir: string;
let tools: Map<string, Registered>;
let lastUrl = "";
let lastInit: RequestInit = {};

beforeEach(async () => {
  clipDir = await fs.mkdtemp(path.join(os.tmpdir(), "lc-mcp-test-"));
  const config: Config = { baseUrl: "https://api.test", token: "lcp_test", clipDir };
  const client = new LingoChunkClient(config);
  const fake = fakeServer();
  tools = fake.tools;
  lastUrl = "";
  lastInit = {};
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

/** Install a fetch mock that rejects, to exercise timeout/network handling. */
function mockFetchReject(err: unknown): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw err;
    }),
  );
}

/** Install a fetch mock that returns each response in order (one read each);
 *  throws if the code fetches more times than expected. Records every URL. */
function mockFetchSequence(responses: Response[]): void {
  let i = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL, init?: RequestInit) => {
      lastUrl = String(input);
      lastInit = init ?? {};
      if (i >= responses.length) throw new Error("unexpected extra fetch");
      return responses[i++]!;
    }),
  );
}

async function call(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
  const tool = tools.get(name);
  if (!tool) throw new Error(`no handler for ${name}`);
  // Mirror the real server: validate + transform args through the tool's schema
  // before the handler runs, so normalisation (lowercase language, uppercase
  // cefr) and refinements are exercised.
  const parsed = z.object(tool.schema).parse(args) as Record<string, unknown>;
  return tool.handler(parsed);
}

function textOf(result: CallToolResult): string {
  return result.content
    .map((c) => (c.type === "text" ? c.text : ""))
    .join("\n");
}

describe("tool registration", () => {
  it("registers all eleven tools", () => {
    expect([...tools.keys()].sort()).toEqual(
      [
        "add_card",
        "export_anki_deck",
        "get_audio_clip",
        "get_audio_url",
        "get_transcript",
        "get_vocabulary",
        "list_decks",
        "list_library",
        "lookup_word",
        "save_lesson",
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
    mockFetch(jsonResponse({ detail: "Unsupported language" }, 400));
    const result = await call("lookup_word", { lemma: "x", language: "de" });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("Unsupported language");
  });

  it("404 passes the detail through", async () => {
    mockFetch(jsonResponse({ detail: "Submission not found" }, 404));
    const result = await call("get_transcript", { submission_id: "nope" });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("Submission not found");
  });

  it("422 validation errors surface the field message, not just the status", async () => {
    // FastAPI's automatic request validation returns a LIST detail, unlike the
    // string detail of intentional 4xx errors; the client must flatten it.
    mockFetch(
      jsonResponse(
        {
          detail: [
            {
              type: "datetime_parsing",
              loc: ["query", "since"],
              msg: "Input should be a valid datetime",
            },
          ],
        },
        422,
      ),
    );
    // Args are empty so the client-side since refinement does not pre-empt the
    // mocked server 422 whose formatting is under test.
    const result = await call("get_vocabulary", {});
    expect(result.isError).toBe(true);
    const text = textOf(result);
    expect(text).toContain("422");
    expect(text).toContain("query.since: Input should be a valid datetime");
    expect(text).not.toContain("Unprocessable");
  });

  it("a non-JSON 500 body falls back to the status text, not the HTML", async () => {
    mockFetch(
      new Response("<html><body>Bad Gateway</body></html>", {
        status: 500,
        statusText: "Internal Server Error",
        headers: { "content-type": "text/html" },
      }),
    );
    const result = await call("list_library", {});
    expect(result.isError).toBe(true);
    const text = textOf(result);
    expect(text).toContain("500");
    expect(text).toContain("Internal Server Error");
    expect(text).not.toContain("<html>");
  });

  it("a request timeout maps to a clear 'timed out' message", async () => {
    const timeout = Object.assign(new Error("The operation was aborted"), {
      name: "TimeoutError",
    });
    mockFetchReject(timeout);
    const result = await call("get_vocabulary", {});
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("timed out");
  });

  it("a network failure appends the underlying cause", async () => {
    const netErr = Object.assign(new TypeError("fetch failed"), {
      cause: new Error("getaddrinfo ENOTFOUND api.test"),
    });
    mockFetchReject(netErr);
    const result = await call("list_library", {});
    expect(result.isError).toBe(true);
    const text = textOf(result);
    expect(text).toContain("fetch failed");
    expect(text).toContain("ENOTFOUND");
  });

  it("never leaks the token into an error message", async () => {
    mockFetch(jsonResponse({ detail: "Invalid or missing API token" }, 401));
    const result = await call("get_vocabulary", {});
    expect(textOf(result)).not.toContain("lcp_test");
  });
});

describe("input validation and URL building", () => {
  it("encodes a lemma with a space and non-ASCII exactly", async () => {
    mockFetch(jsonResponse({ hits: [] }));
    await call("search_examples", { lemma: "über mich" });
    expect(lastUrl).toBe(
      "https://api.test/api/v1/sentences/search?lemma=%C3%BCber+mich",
    );
  });

  it("omits absent optionals entirely (no trailing query string)", async () => {
    mockFetch(jsonResponse({ items: [], next_cursor: null }));
    await call("get_vocabulary", {});
    expect(lastUrl).toBe("https://api.test/api/v1/vocab");
  });

  it("lowercases language and uppercases cefr before sending", async () => {
    mockFetch(jsonResponse({ items: [], next_cursor: null }));
    await call("get_vocabulary", { language: "DE", cefr: "b1" });
    expect(lastUrl).toContain("language=de");
    expect(lastUrl).toContain("cefr=B1");
  });

  it("rejects an unknown cefr value before the request", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    await expect(call("get_vocabulary", { cefr: "D9" })).rejects.toThrow();
    expect(spy).not.toHaveBeenCalled();
  });

  it("search_examples with neither lemma nor q errors client-side, naming both", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    const result = await call("search_examples", {});
    expect(result.isError).toBe(true);
    const text = textOf(result);
    expect(text).toContain("lemma");
    expect(text).toContain("q");
    expect(spy).not.toHaveBeenCalled();
  });

  it("get_audio_clip rejects start >= end client-side", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    const result = await call("get_audio_clip", {
      submission_id: "abc",
      start: 5,
      end: 5,
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("start < end");
    expect(spy).not.toHaveBeenCalled();
  });

  it("get_audio_clip rejects a span longer than 60s client-side", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    const result = await call("get_audio_clip", {
      submission_id: "abc",
      start: 0,
      end: 61,
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("60 seconds");
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("write tools", () => {
  it("list_decks GETs /decks and returns the JSON", async () => {
    mockFetch(jsonResponse({ decks: [] }));
    const result = await call("list_decks", {});
    expect(lastUrl).toBe("https://api.test/api/v1/decks");
    expect(lastInit.method).toBe("GET");
    expect(JSON.parse(textOf(result))).toEqual({ decks: [] });
  });

  it("add_card POSTs the card body to /cards", async () => {
    mockFetch(
      jsonResponse(
        { deck_id: 1, card_id: 10, card_type: "vocab", state: "new" },
        201,
      ),
    );
    await call("add_card", { kind: "vocab", lemma: "Haus" });
    expect(lastUrl).toBe("https://api.test/api/v1/cards");
    expect(lastInit.method).toBe("POST");
    expect(JSON.parse(String(lastInit.body))).toEqual({
      kind: "vocab",
      lemma: "Haus",
    });
  });

  it("add_card kind=custom without back/submission_id errors client-side", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    const result = await call("add_card", { kind: "custom", front: "Guten Tag" });
    expect(result.isError).toBe(true);
    const text = textOf(result);
    expect(text).toContain("front");
    expect(text).toContain("back");
    expect(text).toContain("submission_id");
    expect(spy).not.toHaveBeenCalled();
  });

  it("add_card surfaces a 409 already-exists as a friendly message", async () => {
    mockFetch(jsonResponse({ detail: "This word is already in that deck" }, 409));
    const result = await call("add_card", { kind: "vocab", lemma: "Haus" });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("already in that deck");
  });

  it("add_card surfaces a 403 missing-scope with remediation", async () => {
    mockFetch(
      jsonResponse(
        { detail: "This token is missing the required scope(s): cards:write" },
        403,
      ),
    );
    const result = await call("add_card", { kind: "vocab", lemma: "Haus" });
    expect(result.isError).toBe(true);
    const text = textOf(result);
    expect(text).toContain("cards:write");
    expect(text).toContain("Mint a new token");
  });

  it("export_anki_deck surfaces a 400 for a non-exportable (External) deck", async () => {
    mockFetch(
      jsonResponse(
        { detail: "This deck cannot be exported (it has no linked submission)." },
        400,
      ),
    );
    const result = await call("export_anki_deck", { deck_id: 3 });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("cannot be exported");
  });

  it("export_anki_deck polls queued -> pending -> ready and returns the URL", async () => {
    vi.useFakeTimers();
    try {
      mockFetchSequence([
        jsonResponse({ status: "queued", poll: "/api/v1/decks/7/export/status" }),
        jsonResponse({ status: "pending" }),
        jsonResponse({ status: "ready", download_url: "https://r2/deck.apkg" }),
      ]);
      const p = call("export_anki_deck", { deck_id: 7 });
      await vi.advanceTimersByTimeAsync(2100);
      const result = await p;
      const payload = JSON.parse(textOf(result));
      expect(payload.status).toBe("ready");
      expect(payload.download_url).toBe("https://r2/deck.apkg");
      expect(lastUrl).toBe("https://api.test/api/v1/decks/7/export/status");
    } finally {
      vi.useRealTimers();
    }
  });

  it("save_lesson POSTs the lesson to /lessons", async () => {
    mockFetch(
      jsonResponse(
        {
          id: "l1",
          title: "T",
          language: "de",
          size_bytes: 9,
          source_submission_ids: [],
          created_at: "2026-07-03T00:00:00Z",
          view_url: "https://r2/l1",
        },
        201,
      ),
    );
    await call("save_lesson", { title: "T", language: "de", html: "<h1></h1>" });
    expect(lastUrl).toBe("https://api.test/api/v1/lessons");
    expect(lastInit.method).toBe("POST");
    expect(JSON.parse(String(lastInit.body))).toEqual({
      title: "T",
      language: "de",
      html: "<h1></h1>",
    });
  });

  it("save_lesson surfaces the 413 size-cap message", async () => {
    mockFetch(jsonResponse({ detail: "Lesson HTML exceeds the 10 MB cap." }, 413));
    const result = await call("save_lesson", {
      title: "T",
      language: "de",
      html: "<h1></h1>",
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("10 MB cap");
  });

  it("add_card custom passes sentence_position through in the body", async () => {
    mockFetch(
      jsonResponse(
        { deck_id: 2, card_id: 5, card_type: "expression", state: "new" },
        201,
      ),
    );
    await call("add_card", {
      kind: "custom",
      front: "Guten Tag",
      back: "Good day",
      submission_id: "s1",
      sentence_position: 3,
    });
    expect(lastUrl).toBe("https://api.test/api/v1/cards");
    expect(JSON.parse(String(lastInit.body))).toEqual({
      kind: "custom",
      front: "Guten Tag",
      back: "Good day",
      submission_id: "s1",
      sentence_position: 3,
    });
  });

  it("add_card rejects an over-long custom front client-side (cap 200)", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    await expect(
      call("add_card", {
        kind: "custom",
        front: "x".repeat(201),
        back: "ok",
        submission_id: "s1",
      }),
    ).rejects.toThrow();
    expect(spy).not.toHaveBeenCalled();
  });

  it("add_card surfaces code=ambiguous_lemma with a disambiguation hint", async () => {
    mockFetch(
      jsonResponse(
        {
          detail:
            "This word has several parts of speech here (NOUN, VERB); pass 'pos' to choose one.",
          code: "ambiguous_lemma",
        },
        409,
      ),
    );
    const result = await call("add_card", { kind: "vocab", lemma: "das" });
    expect(result.isError).toBe(true);
    const text = textOf(result);
    expect(text).toContain("NOUN, VERB");
    expect(text).toContain("pos");
    expect(text).toContain("submission_id");
  });

  it("add_card surfaces code=duplicate_card as safe-to-ignore", async () => {
    mockFetch(
      jsonResponse(
        { detail: "This word is already in that deck", code: "duplicate_card" },
        409,
      ),
    );
    const result = await call("add_card", { kind: "vocab", lemma: "Haus" });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("safe to ignore");
  });

  it("save_lesson surfaces code=lesson_cap with a delete hint", async () => {
    mockFetch(
      jsonResponse(
        {
          detail:
            "You already have the maximum of 100 lessons. Delete one before saving another.",
          code: "lesson_cap",
        },
        409,
      ),
    );
    const result = await call("save_lesson", {
      title: "T",
      language: "de",
      html: "<h1></h1>",
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("delete an old lesson");
  });
});
