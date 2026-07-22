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
  it("registers all thirty-nine tools", () => {
    expect([...tools.keys()].sort()).toEqual(
      [
        "add_card",
        "add_language",
        "commit_language",
        "create_annotation",
        "create_course",
        "delete_annotation",
        "delete_course",
        "delete_lesson",
        "discard_language_draft",
        "export_anki_deck",
        "get_audio_clip",
        "get_audio_url",
        "get_authoring_guide",
        "get_guided_path",
        "get_guided_translation_source",
        "get_guided_writer_brief",
        "get_lesson",
        "get_lesson_translation_source",
        "get_transcript",
        "get_translation_source",
        "get_vocabulary",
        "list_annotations",
        "list_courses",
        "list_decks",
        "list_languages",
        "list_lessons",
        "list_library",
        "lookup_word",
        "plan_guided_path",
        "put_guided_translation",
        "put_language_translations",
        "put_lesson_translation",
        "save_lesson",
        "search_examples",
        "submit_guided_lesson",
        "update_annotation",
        "update_lesson",
        "validate_lesson",
        "whats_possible",
      ].sort(),
    );
  });
});

describe("whats_possible", () => {
  it("returns the overview menu without any fetch", async () => {
    const result = await call("whats_possible", {});
    expect(result.isError).toBeFalsy();
    const text = textOf(result);
    expect(text).toContain("# What you can do with LingoChunk");
    expect(text).toContain("get_authoring_guide");
    expect(text.length).toBeGreaterThan(1000);
  });
});

describe("get_authoring_guide", () => {
  it("returns the lesson guide markdown for topic=lesson", async () => {
    const result = await call("get_authoring_guide", { topic: "lesson" });
    expect(result.isError).toBeFalsy();
    const text = textOf(result);
    expect(text).toContain("# LingoChunk lesson builder");
    expect(text.length).toBeGreaterThan(1000);
    // The YAML frontmatter must be stripped, not served over MCP.
    expect(text).not.toMatch(/^---\n/);
    expect(text).not.toContain("name: lingochunk-lesson");
  });

  it("serves a distinct, non-trivial guide for each of the seven topics", async () => {
    const topics = ["overview", "lesson", "course", "cards", "annotations", "add-language", "discuss"];
    const bodies = new Set<string>();
    for (const topic of topics) {
      const text = textOf(await call("get_authoring_guide", { topic }));
      expect(text.length).toBeGreaterThan(500);
      bodies.add(text);
    }
    expect(bodies.size).toBe(topics.length);
  });

  it("rejects an unknown topic at the schema (no fetch)", async () => {
    await expect(
      call("get_authoring_guide", { topic: "nope" }),
    ).rejects.toThrow();
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

  it("add_card card.v1 kind maps fields into a format=card.v1 body", async () => {
    mockFetch(
      jsonResponse(
        {
          deck_id: 1,
          card_id: 10,
          card_type: "expression",
          state: "new",
          card_ids: [10],
          created: true,
          problems: [],
        },
        201,
      ),
    );
    await call("add_card", {
      kind: "grammar",
      submission_id: "s1",
      headword: "einem",
      translation: "dative after 'in' (location)",
      note: "in + Dativ for location",
      hint: "dative",
      sentence_position: 2,
      focus_span: "einem",
    });
    expect(lastUrl).toBe("https://api.test/api/v1/cards");
    expect(JSON.parse(String(lastInit.body))).toEqual({
      format: "card.v1",
      kind: "grammar",
      submission_id: "s1",
      headword: "einem",
      translation: "dative after 'in' (location)",
      note: "in + Dativ for location",
      hint: "dative",
      example: { sentence_position: 2, focus_span: "einem" },
    });
  });

  it("add_card blur kind without focus_span errors client-side", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    const result = await call("add_card", {
      kind: "cloze",
      submission_id: "s1",
      headword: "sehen",
      translation: "to see",
      sentence_position: 1,
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("focus_span");
    expect(spy).not.toHaveBeenCalled();
  });

  it("add_card contrast requires correct within options client-side", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    const result = await call("add_card", {
      kind: "contrast",
      submission_id: "s1",
      headword: "wissen",
      translation: "to know a fact",
      sentence_position: 1,
      focus_span: "weiß",
      options: ["wissen", "kennen"],
      correct: "sehen",
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("correct");
    expect(spy).not.toHaveBeenCalled();
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

  it("export_anki_deck surfaces a 400 for a deck with no linked submission", async () => {
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

  it("export_anki_deck absorbs a 429 while triggering, then completes", async () => {
    vi.useFakeTimers();
    try {
      mockFetchSequence([
        jsonResponse({ detail: "rate limited" }, 429, { "retry-after": "5" }),
        jsonResponse({ status: "queued", poll: "/api/v1/decks/4/export/status" }),
        jsonResponse({ status: "pending" }),
        jsonResponse({ status: "ready", download_url: "https://r2/d.apkg" }),
      ]);
      const p = call("export_anki_deck", { deck_id: 4 });
      // 5s Retry-After backoff on the POST, then a 2s poll gap.
      await vi.advanceTimersByTimeAsync(7100);
      const payload = JSON.parse(textOf(await p));
      expect(payload.status).toBe("ready");
      expect(payload.download_url).toBe("https://r2/d.apkg");
    } finally {
      vi.useRealTimers();
    }
  });

  it("export_anki_deck returns re-trigger guidance on status none", async () => {
    mockFetchSequence([
      jsonResponse({ status: "queued", poll: "/api/v1/decks/8/export/status" }),
      jsonResponse({ status: "none" }),
    ]);
    const result = await call("export_anki_deck", { deck_id: 8 });
    const payload = JSON.parse(textOf(result));
    expect(payload.status).toBe("none");
    expect(payload.message).toContain("call export_anki_deck again");
  });

  it("export_anki_deck returns pending guidance when the budget expires", async () => {
    vi.useFakeTimers();
    try {
      // Queued on the POST, then pending forever: a fresh response per call so
      // no body is read twice.
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: string | URL, init?: RequestInit) => {
          lastUrl = String(input);
          lastInit = init ?? {};
          const url = String(input);
          return url.endsWith("/export")
            ? jsonResponse({ status: "queued", poll: `${url}/status` })
            : jsonResponse({ status: "pending" });
        }),
      );
      const p = call("export_anki_deck", { deck_id: 9 });
      await vi.advanceTimersByTimeAsync(61_000);
      const payload = JSON.parse(textOf(await p));
      expect(payload.status).toBe("pending");
      expect(payload.message).toContain("Only re-trigger");
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

  it("save_lesson forwards visibility so creators can publish", async () => {
    mockFetch(
      jsonResponse(
        {
          id: "l2",
          title: "T",
          language: "de",
          size_bytes: 9,
          source_submission_ids: [],
          created_at: "2026-07-12T00:00:00Z",
          visibility: "public",
        },
        201,
      ),
    );
    await call("save_lesson", {
      document: { format: "lesson.v1" },
      visibility: "public",
    });
    expect(JSON.parse(String(lastInit.body))).toEqual({
      document: { format: "lesson.v1" },
      visibility: "public",
    });
  });

  it("list_lessons GETs /lessons with the paging params", async () => {
    mockFetch(jsonResponse({ lessons: [], next_cursor: null }));
    const result = await call("list_lessons", { limit: 2, cursor: "abc" });
    expect(lastUrl).toContain("https://api.test/api/v1/lessons?");
    expect(lastUrl).toContain("limit=2");
    expect(lastUrl).toContain("cursor=abc");
    expect(JSON.parse(textOf(result))).toEqual({ lessons: [], next_cursor: null });
  });

  it("get_lesson GETs the document by id and pairs it with the version token", async () => {
    mockFetch(
      jsonResponse(
        { format: "lesson.v1", title: "T", blocks: [] },
        200,
        { "x-lesson-version": "2026-07-13T09:00:00.123456+00:00" },
      ),
    );
    const result = await call("get_lesson", { lesson_id: "l1/../x" });
    expect(lastUrl).toBe("https://api.test/api/v1/lessons/l1%2F..%2Fx/document");
    expect(JSON.parse(textOf(result))).toEqual({
      version: "2026-07-13T09:00:00.123456+00:00",
      document: { format: "lesson.v1", title: "T", blocks: [] },
    });
  });

  it("get_lesson surfaces the 404 for an HTML lesson (no document)", async () => {
    mockFetch(jsonResponse({ detail: "Lesson has no document" }, 404));
    const result = await call("get_lesson", { lesson_id: "html-one" });
    expect(textOf(result)).toContain("404");
    expect(textOf(result)).toContain("Lesson has no document");
  });

  it("update_lesson document mode PUTs the replacement with base_version", async () => {
    mockFetch(
      jsonResponse(
        { id: "l1", title: "Rewritten", updated_at: "2026-07-13T10:00:00Z" },
        200,
        { "x-lesson-version": "2026-07-13T10:00:00+00:00" },
      ),
    );
    const doc = { format: "lesson.v1", title: "Rewritten", blocks: [{}] };
    const result = await call("update_lesson", {
      lesson_id: "l1/../x",
      base_version: "v-base",
      document: doc,
    });
    expect(lastUrl).toBe("https://api.test/api/v1/lessons/l1%2F..%2Fx/document");
    expect(lastInit.method).toBe("PUT");
    expect(JSON.parse(String(lastInit.body))).toEqual({
      document: doc,
      base_version: "v-base",
    });
    expect(JSON.parse(textOf(result))).toEqual({
      version: "2026-07-13T10:00:00+00:00",
      lesson: { id: "l1", title: "Rewritten", updated_at: "2026-07-13T10:00:00Z" },
    });
  });

  it("update_lesson ops mode patches the fresh document sequentially", async () => {
    const stored = {
      format: "lesson.v1",
      title: "T",
      blocks: [
        { type: "section", title: "A" },
        { type: "prose", text: "old" },
        { type: "review" },
      ],
    };
    mockFetchSequence([
      jsonResponse(stored, 200, { "x-lesson-version": "v1" }),
      jsonResponse({ id: "l1", title: "T" }, 200, {
        "x-lesson-version": "v2",
      }),
    ]);
    // Descending block order: delete §3, replace §2, insert a new §1.
    const result = await call("update_lesson", {
      lesson_id: "l1",
      base_version: "v1",
      ops: [
        { action: "delete", block: 3 },
        { action: "replace", block: 2, value: { type: "prose", text: "new" } },
        { action: "insert", block: 1, value: { type: "prose", text: "intro" } },
      ],
    });
    const putBody = JSON.parse(String(lastInit.body));
    expect(putBody.base_version).toBe("v1");
    expect(putBody.document.blocks).toEqual([
      { type: "prose", text: "intro" },
      { type: "section", title: "A" },
      { type: "prose", text: "new" },
    ]);
    expect(JSON.parse(textOf(result)).version).toBe("v2");
  });

  it("update_lesson meta edits set and null-clear lesson-level fields", async () => {
    const stored = {
      format: "lesson.v1",
      title: "Old title",
      subtitle: "Old strap",
      blocks: [{ type: "review" }],
    };
    mockFetchSequence([
      jsonResponse(stored, 200, { "x-lesson-version": "v1" }),
      jsonResponse({ id: "l1" }, 200, { "x-lesson-version": "v2" }),
    ]);
    await call("update_lesson", {
      lesson_id: "l1",
      base_version: "v1",
      meta: { title: "New title", subtitle: null },
    });
    const putBody = JSON.parse(String(lastInit.body));
    expect(putBody.document.title).toBe("New title");
    expect("subtitle" in putBody.document).toBe(false);
    expect(putBody.document.blocks).toEqual([{ type: "review" }]);
  });

  it("update_lesson ops mode refuses a stale base_version WITHOUT writing", async () => {
    // Only ONE response mocked: a PUT after the version check would throw
    // "unexpected extra fetch" and fail this test.
    mockFetchSequence([
      jsonResponse({ format: "lesson.v1", blocks: [] }, 200, {
        "x-lesson-version": "v2-moved-on",
      }),
    ]);
    const result = await call("update_lesson", {
      lesson_id: "l1",
      base_version: "v1-what-i-read",
      ops: [{ action: "delete", block: 1 }],
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("changed under you");
    expect(textOf(result)).toContain("get_lesson again");
  });

  it("update_lesson surfaces the server's 409 stale_document remediation", async () => {
    mockFetch(
      jsonResponse(
        { detail: "The lesson changed...", code: "stale_document" },
        409,
      ),
    );
    const result = await call("update_lesson", {
      lesson_id: "l1",
      base_version: "v-old",
      document: { format: "lesson.v1", blocks: [{}] },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("changed under you");
  });

  it("update_lesson names the failing op and current length on bad bounds", async () => {
    mockFetchSequence([
      jsonResponse(
        { format: "lesson.v1", blocks: [{ type: "review" }] },
        200,
        { "x-lesson-version": "v1" },
      ),
    ]);
    const result = await call("update_lesson", {
      lesson_id: "l1",
      base_version: "v1",
      ops: [{ action: "replace", block: 5, value: { type: "prose", text: "x" } }],
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("ops[1]");
    expect(textOf(result)).toContain("1 blocks");
  });

  it("update_lesson enforces the ops/document/meta shape rules", async () => {
    const doc = { format: "lesson.v1", blocks: [{}] };
    let result = await call("update_lesson", {
      lesson_id: "l1",
      base_version: "v1",
      ops: [{ action: "delete", block: 1 }],
      document: doc,
    });
    expect(textOf(result)).toContain("exactly one");
    result = await call("update_lesson", {
      lesson_id: "l1",
      base_version: "v1",
      document: doc,
      meta: { title: "X" },
    });
    expect(textOf(result)).toContain("cannot combine");
    result = await call("update_lesson", { lesson_id: "l1", base_version: "v1" });
    expect(textOf(result)).toContain("Nothing to change");
  });

  it("update_lesson rejects a delete op carrying a value", async () => {
    mockFetchSequence([
      jsonResponse(
        { format: "lesson.v1", blocks: [{ type: "review" }] },
        200,
        { "x-lesson-version": "v1" },
      ),
    ]);
    const result = await call("update_lesson", {
      lesson_id: "l1",
      base_version: "v1",
      ops: [{ action: "delete", block: 1, value: { type: "prose", text: "x" } }],
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("forbidden for delete");
  });

  it("delete_lesson DELETEs by id (URL-encoded) and reports the deletion", async () => {
    mockFetch(new Response(null, { status: 204 }));
    const result = await call("delete_lesson", { lesson_id: "l1/../x" });
    expect(lastUrl).toBe("https://api.test/api/v1/lessons/l1%2F..%2Fx");
    expect(lastInit.method).toBe("DELETE");
    expect(JSON.parse(textOf(result))).toEqual({
      deleted: true,
      lesson_id: "l1/../x",
    });
  });

  it("delete_lesson surfaces a 404 for a foreign or unknown lesson", async () => {
    mockFetch(jsonResponse({ detail: "Lesson not found" }, 404));
    const result = await call("delete_lesson", { lesson_id: "nope" });
    expect(textOf(result)).toContain("404");
    expect(textOf(result)).toContain("Lesson not found");
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

describe("language tools", () => {
  it("list_languages GETs /submissions/{id}/languages and returns the JSON", async () => {
    const body = {
      source_language: "de",
      languages: [
        { language: "ru", submission_id: "s1", status: "ready", is_primary: true },
      ],
      available_targets: ["fr", "uk"],
      simplify_targets: ["de-a1", "de-a2", "de-b1", "de-b2"],
      drafts: [{ language: "de-a2", sentences_drafted: 12, sentence_count: 118 }],
    };
    mockFetch(jsonResponse(body));
    const result = await call("list_languages", { submission_id: "s1" });
    expect(lastUrl).toBe("https://api.test/api/v1/submissions/s1/languages");
    expect(lastInit.method).toBe("GET");
    expect(JSON.parse(textOf(result))).toEqual(body);
  });

  it("add_language POSTs lowercased codes as {languages} and returns jobs + skipped", async () => {
    mockFetch(
      jsonResponse({
        jobs: [{ language: "fr", job_id: "j1" }],
        skipped: [{ language: "en-a2", reason: "agent_only_target" }],
      }),
    );
    const result = await call("add_language", {
      submission_id: "s1",
      languages: ["FR", "en-a2"],
    });
    expect(lastUrl).toBe("https://api.test/api/v1/submissions/s1/languages");
    expect(lastInit.method).toBe("POST");
    expect(JSON.parse(String(lastInit.body))).toEqual({
      languages: ["fr", "en-a2"],
    });
    const payload = JSON.parse(textOf(result));
    expect(payload.jobs).toEqual([{ language: "fr", job_id: "j1" }]);
    expect(payload.skipped[0].reason).toBe("agent_only_target");
  });

  it("add_language rejects an empty language list client-side", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    await expect(
      call("add_language", { submission_id: "s1", languages: [] }),
    ).rejects.toThrow();
    expect(spy).not.toHaveBeenCalled();
  });

  it("add_language rejects more than ten languages client-side", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    await expect(
      call("add_language", {
        submission_id: "s1",
        languages: Array.from({ length: 11 }, (_, i) => `l${i}`),
      }),
    ).rejects.toThrow();
    expect(spy).not.toHaveBeenCalled();
  });

  it("get_translation_source passes from_position (including 0) and limit", async () => {
    mockFetch(
      jsonResponse({
        source_language: "de",
        pivot_language: "ru",
        sentence_count: 118,
        sentences: [],
        next_from_position: 50,
      }),
    );
    await call("get_translation_source", {
      submission_id: "abc/123",
      from_position: 0,
      limit: 50,
    });
    expect(lastUrl).toContain(
      "/api/v1/submissions/abc%2F123/translation-source?",
    );
    expect(lastUrl).toContain("from_position=0");
    expect(lastUrl).toContain("limit=50");
  });

  it("put_language_translations PUTs the batch, coercing an absent translation to null", async () => {
    mockFetch(
      jsonResponse({
        accepted: 2,
        rejected: [],
        sentences_drafted: 2,
        sentence_count: 118,
      }),
    );
    await call("put_language_translations", {
      submission_id: "s1",
      language: "DE-A2",
      generator: "claude-fable-5",
      sentences: [
        { position: 0, translation: "Die Gruppe traf sich.", meanings: ["die Gruppe", "traf", ""] },
        { position: 1, meanings: ["ja", ""] },
      ],
    });
    expect(lastUrl).toBe(
      "https://api.test/api/v1/submissions/s1/translations/de-a2",
    );
    expect(lastInit.method).toBe("PUT");
    expect(JSON.parse(String(lastInit.body))).toEqual({
      generator: "claude-fable-5",
      sentences: [
        {
          position: 0,
          translation: "Die Gruppe traf sich.",
          meanings: ["die Gruppe", "traf", ""],
        },
        { position: 1, translation: null, meanings: ["ja", ""] },
      ],
    });
  });

  it("put_language_translations surfaces the server's per-sentence rejections", async () => {
    mockFetch(
      jsonResponse({
        accepted: 1,
        rejected: [
          { position: 7, reason: "meanings_length_mismatch", expected: 12, got: 11 },
        ],
        sentences_drafted: 96,
        sentence_count: 118,
      }),
    );
    const result = await call("put_language_translations", {
      submission_id: "s1",
      language: "fr",
      sentences: [{ position: 7, translation: "x", meanings: ["y"] }],
    });
    const payload = JSON.parse(textOf(result));
    expect(payload.rejected[0].reason).toBe("meanings_length_mismatch");
    expect(payload.rejected[0].expected).toBe(12);
    expect(payload.sentences_drafted).toBe(96);
    // generator omitted -> not serialised.
    expect(JSON.parse(String(lastInit.body))).toEqual({
      sentences: [{ position: 7, translation: "x", meanings: ["y"] }],
    });
  });

  it("put_language_translations rejects more than 100 sentences client-side", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    await expect(
      call("put_language_translations", {
        submission_id: "s1",
        language: "fr",
        sentences: Array.from({ length: 101 }, (_, i) => ({
          position: i,
          translation: "x",
          meanings: [],
        })),
      }),
    ).rejects.toThrow();
    expect(spy).not.toHaveBeenCalled();
  });

  it("commit_language polls the apply job then resolves the sibling id", async () => {
    vi.useFakeTimers();
    try {
      mockFetchSequence([
        jsonResponse({ job_id: "j1", language: "de-a2" }),
        jsonResponse({ status: "processing", progress: 20 }),
        jsonResponse({ status: "completed", progress: 100 }),
        jsonResponse({
          source_language: "de",
          languages: [
            {
              language: "de-a2",
              submission_id: "sib1",
              status: "ready",
              is_primary: false,
            },
          ],
          available_targets: [],
          simplify_targets: [],
          drafts: [],
        }),
      ]);
      const p = call("commit_language", {
        submission_id: "s1",
        language: "de-a2",
      });
      await vi.advanceTimersByTimeAsync(2100);
      const payload = JSON.parse(textOf(await p));
      expect(payload.status).toBe("completed");
      expect(payload.language).toBe("de-a2");
      expect(payload.submission_id).toBe("sib1");
      expect(lastUrl).toBe("https://api.test/api/v1/submissions/s1/languages");
    } finally {
      vi.useRealTimers();
    }
  });

  it("commit_language reports a failed apply job for retry", async () => {
    mockFetchSequence([
      jsonResponse({ job_id: "j2", language: "fr" }),
      jsonResponse({ status: "failed", error: "boom" }),
    ]);
    const result = await call("commit_language", {
      submission_id: "s1",
      language: "fr",
    });
    const payload = JSON.parse(textOf(result));
    expect(payload.status).toBe("failed");
    expect(payload.error).toBe("boom");
    expect(payload.message).toContain("commit_language again");
  });

  it("commit_language surfaces a 409 incomplete draft with the missing positions", async () => {
    mockFetch(
      jsonResponse(
        {
          detail: {
            missing_positions_count: 3,
            first_missing_positions: [5, 9, 12],
          },
        },
        409,
      ),
    );
    const result = await call("commit_language", {
      submission_id: "s1",
      language: "de-a2",
    });
    expect(result.isError).toBe(true);
    const text = textOf(result);
    expect(text).toContain("409");
    expect(text).toContain("missing_positions_count");
  });

  it("get_lesson_translation_source lowercases the language", async () => {
    mockFetch(
      jsonResponse({
        lesson_id: "l1",
        language: "de",
        translation_language: "en",
        target_language: "fr",
        level: "A1",
        version: "2026-07-22T00:00:00+00:00",
        sibling_exists: true,
        sibling_submission_id: "sib-1",
        sibling_status: "ready",
        existing_edition_id: null,
        existing_edition_edited: false,
        units: [],
      }),
    );
    await call("get_lesson_translation_source", {
      lesson_id: "l1",
      language: " FR ",
    });
    expect(lastUrl).toBe(
      "https://api.test/api/v1/lessons/l1/translation-source?language=fr",
    );
  });

  it("put_lesson_translation PUTs base_version and units verbatim", async () => {
    mockFetch(
      jsonResponse({
        lesson_id: "ed-1",
        submission_id: "sib-1",
        language: "fr",
        replaced: false,
        unknown_lemmas: [],
      }),
    );
    await call("put_lesson_translation", {
      lesson_id: "l1",
      language: "fr",
      base_version: "2026-07-22T00:00:00+00:00",
      units: [{ path: "title", text: "FR Titre" }],
    });
    expect(lastUrl).toBe(
      "https://api.test/api/v1/lessons/l1/translations/fr",
    );
    expect(lastInit.method).toBe("PUT");
    expect(JSON.parse(String(lastInit.body))).toEqual({
      base_version: "2026-07-22T00:00:00+00:00",
      units: [{ path: "title", text: "FR Titre" }],
    });
  });

  it("put_guided_translation routes plan vs section modes", async () => {
    mockFetch(
      jsonResponse({
        language: "fr",
        sibling_submission_id: "sib-1",
        section_count: 3,
      }),
    );
    await call("put_guided_translation", {
      submission_id: "s1",
      language: "fr",
      units: [{ path: "sections.0.title", text: "FR Salutations" }],
    });
    expect(lastUrl).toBe(
      "https://api.test/api/v1/submissions/s1/guided/translations/fr",
    );

    mockFetch(
      jsonResponse({
        lesson_id: "ed-2",
        section_index: 0,
        language: "fr",
        unknown_lemmas: [],
      }),
    );
    await call("put_guided_translation", {
      submission_id: "s1",
      language: "fr",
      section_index: 0,
      base_version: "2026-07-22T00:00:00+00:00",
      units: [{ path: "title", text: "FR Section" }],
    });
    expect(lastUrl).toBe(
      "https://api.test/api/v1/submissions/s1/guided/sections/0/translations/fr",
    );
  });

  it("put_guided_translation with section_index but no base_version errors locally", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    const result = await call("put_guided_translation", {
      submission_id: "s1",
      language: "fr",
      section_index: 0,
      units: [{ path: "title", text: "FR Section" }],
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("base_version");
    expect(spy).not.toHaveBeenCalled();
  });

  it("discard_language_draft DELETEs the draft and returns the count", async () => {
    mockFetch(jsonResponse({ deleted_sentences: 96 }));
    const result = await call("discard_language_draft", {
      submission_id: "s1",
      language: "DE-A2",
    });
    expect(lastUrl).toBe(
      "https://api.test/api/v1/submissions/s1/translations/de-a2",
    );
    expect(lastInit.method).toBe("DELETE");
    expect(JSON.parse(textOf(result))).toEqual({ deleted_sentences: 96 });
  });

  it("a write tool surfaces a 403 naming the translations:write scope", async () => {
    mockFetch(
      jsonResponse(
        {
          detail: "This token is missing the required scope(s): translations:write",
        },
        403,
      ),
    );
    const result = await call("add_language", {
      submission_id: "s1",
      languages: ["fr"],
    });
    expect(result.isError).toBe(true);
    const text = textOf(result);
    expect(text).toContain("translations:write");
    expect(text).toContain("Mint a new token");
  });
});

describe("annotation tools", () => {
  it("list_annotations GETs /submissions/{id}/annotations and returns the JSON", async () => {
    const body = {
      annotations: [
        {
          id: 1,
          sentence_id: 42,
          char_start: 4,
          char_end: 12,
          selected_text: "am Ball",
          note: "**am Ball**",
          stale: false,
          start_time: null,
          end_time: null,
        },
      ],
      count: 1,
      max_annotations: 200,
    };
    mockFetch(jsonResponse(body));
    const result = await call("list_annotations", { submission_id: "s1" });
    expect(lastUrl).toBe("https://api.test/api/v1/submissions/s1/annotations");
    expect(lastInit.method).toBe("GET");
    expect(JSON.parse(textOf(result))).toEqual(body);
  });

  it("create_annotation POSTs a span annotation and echoes selected_text", async () => {
    mockFetch(
      jsonResponse(
        {
          id: 5,
          sentence_id: 42,
          char_start: 4,
          char_end: 12,
          selected_text: "am Ball",
          note: "**am Ball** - informal",
          stale: false,
          start_time: null,
          end_time: null,
        },
        201,
      ),
    );
    const result = await call("create_annotation", {
      submission_id: "abc/123",
      sentence_id: 42,
      char_start: 4,
      char_end: 12,
      note: "**am Ball** - informal",
    });
    expect(lastUrl).toBe(
      "https://api.test/api/v1/submissions/abc%2F123/annotations",
    );
    expect(lastInit.method).toBe("POST");
    // start_time/end_time absent -> not serialised (JSON.stringify drops them).
    expect(JSON.parse(String(lastInit.body))).toEqual({
      sentence_id: 42,
      char_start: 4,
      char_end: 12,
      note: "**am Ball** - informal",
    });
    expect(JSON.parse(textOf(result)).selected_text).toBe("am Ball");
  });

  it("create_annotation omits both offsets for a whole-sentence note", async () => {
    mockFetch(
      jsonResponse(
        {
          id: 6,
          sentence_id: 7,
          char_start: null,
          char_end: null,
          selected_text: null,
          note: "whole line",
          stale: false,
          start_time: null,
          end_time: null,
        },
        201,
      ),
    );
    await call("create_annotation", {
      submission_id: "s1",
      sentence_id: 7,
      note: "whole line",
    });
    expect(JSON.parse(String(lastInit.body))).toEqual({
      sentence_id: 7,
      note: "whole line",
    });
  });

  it("create_annotation rejects a one-sided char range client-side, naming both", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    const result = await call("create_annotation", {
      submission_id: "s1",
      sentence_id: 7,
      char_start: 4,
      note: "x",
    });
    expect(result.isError).toBe(true);
    const text = textOf(result);
    expect(text).toContain("char_start");
    expect(text).toContain("char_end");
    expect(spy).not.toHaveBeenCalled();
  });

  it("create_annotation rejects char_start >= char_end client-side", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    const result = await call("create_annotation", {
      submission_id: "s1",
      sentence_id: 7,
      char_start: 8,
      char_end: 8,
      note: "x",
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("char_start < char_end");
    expect(spy).not.toHaveBeenCalled();
  });

  it("create_annotation rejects an over-long note client-side (cap 5000)", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    await expect(
      call("create_annotation", {
        submission_id: "s1",
        sentence_id: 7,
        note: "x".repeat(5001),
      }),
    ).rejects.toThrow();
    expect(spy).not.toHaveBeenCalled();
  });

  it("update_annotation PATCHes just the note to /annotations/{id}", async () => {
    mockFetch(
      jsonResponse({
        id: 5,
        sentence_id: 42,
        char_start: 4,
        char_end: 12,
        selected_text: "am Ball",
        note: "reworded",
        stale: false,
        start_time: null,
        end_time: null,
      }),
    );
    const result = await call("update_annotation", {
      submission_id: "s1",
      annotation_id: 5,
      note: "reworded",
    });
    expect(lastUrl).toBe(
      "https://api.test/api/v1/submissions/s1/annotations/5",
    );
    expect(lastInit.method).toBe("PATCH");
    expect(JSON.parse(String(lastInit.body))).toEqual({ note: "reworded" });
    expect(JSON.parse(textOf(result)).note).toBe("reworded");
  });

  it("delete_annotation DELETEs by id and returns {deleted, annotation_id}", async () => {
    mockFetch(jsonResponse({ deleted: true, annotation_id: 5 }));
    const result = await call("delete_annotation", {
      submission_id: "s1",
      annotation_id: 5,
    });
    expect(lastUrl).toBe(
      "https://api.test/api/v1/submissions/s1/annotations/5",
    );
    expect(lastInit.method).toBe("DELETE");
    expect(JSON.parse(textOf(result))).toEqual({
      deleted: true,
      annotation_id: 5,
    });
  });

  it("an annotation write tool surfaces a 403 naming the annotations:write scope", async () => {
    mockFetch(
      jsonResponse(
        {
          detail:
            "This token is missing the required scope(s): annotations:write",
        },
        403,
      ),
    );
    const result = await call("create_annotation", {
      submission_id: "s1",
      sentence_id: 1,
      note: "x",
    });
    expect(result.isError).toBe(true);
    const text = textOf(result);
    expect(text).toContain("annotations:write");
    expect(text).toContain("Mint a new token");
  });
});

describe("guided path tools", () => {
  it("plan_guided_path POSTs the trigger, polls the job, then reports ready", async () => {
    vi.useFakeTimers();
    try {
      mockFetchSequence([
        jsonResponse({ job_id: "gp1" }),
        jsonResponse({ status: "processing", progress: 30 }),
        jsonResponse({ status: "completed", progress: 100 }),
      ]);
      const p = call("plan_guided_path", { submission_id: "s1" });
      await vi.advanceTimersByTimeAsync(2100);
      const payload = JSON.parse(textOf(await p));
      expect(payload.status).toBe("ready");
      expect(payload.job_id).toBe("gp1");
      expect(payload.message).toContain("get_guided_path");
      expect(lastUrl).toBe("https://api.test/api/v1/jobs/gp1");
    } finally {
      vi.useRealTimers();
    }
  });

  it("plan_guided_path returns friendly pending guidance when the budget expires", async () => {
    vi.useFakeTimers();
    try {
      // Trigger returns a job, then the job stays processing forever: a fresh
      // response per call so no body is read twice.
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: string | URL, init?: RequestInit) => {
          lastUrl = String(input);
          lastInit = init ?? {};
          return String(input).endsWith("/guided/plan")
            ? jsonResponse({ job_id: "gp9" })
            : jsonResponse({ status: "processing" });
        }),
      );
      const p = call("plan_guided_path", { submission_id: "s1" });
      await vi.advanceTimersByTimeAsync(61_000);
      const payload = JSON.parse(textOf(await p));
      expect(payload.status).toBe("pending");
      expect(payload.message).toContain("get_guided_path");
    } finally {
      vi.useRealTimers();
    }
  });

  it("plan_guided_path treats a 409 plan_ready as a success (calling twice is safe)", async () => {
    mockFetch(
      jsonResponse(
        { detail: { code: "plan_ready", message: "A ready guided path exists." } },
        409,
      ),
    );
    const result = await call("plan_guided_path", { submission_id: "abc/1" });
    expect(lastUrl).toBe(
      "https://api.test/api/v1/submissions/abc%2F1/guided/plan",
    );
    expect(lastInit.method).toBe("POST");
    expect(result.isError).toBeFalsy();
    const payload = JSON.parse(textOf(result));
    expect(payload.status).toBe("ready");
    expect(payload.message).toContain("get_guided_path");
  });

  it("plan_guided_path treats a 409 plan_in_progress as pending", async () => {
    mockFetch(
      jsonResponse(
        {
          detail: {
            code: "plan_in_progress",
            message: "Planning is already underway.",
          },
        },
        409,
      ),
    );
    const result = await call("plan_guided_path", { submission_id: "s1" });
    expect(result.isError).toBeFalsy();
    const payload = JSON.parse(textOf(result));
    expect(payload.status).toBe("pending");
    expect(payload.message).toContain("get_guided_path");
  });

  it("plan_guided_path reports a failed planner job for retry", async () => {
    mockFetchSequence([
      jsonResponse({ job_id: "gp2" }),
      jsonResponse({ status: "failed", error: "planner boom" }),
    ]);
    const result = await call("plan_guided_path", { submission_id: "s1" });
    const payload = JSON.parse(textOf(result));
    expect(payload.status).toBe("failed");
    expect(payload.error).toBe("planner boom");
    expect(payload.message).toContain("plan_guided_path again");
  });

  it("plan_guided_path surfaces a 429 guided_daily_limit message and Retry-After", async () => {
    // The guided detail is a {code, message} OBJECT, not a string: its message
    // must surface cleanly, never as [object Object].
    mockFetch(
      jsonResponse(
        {
          detail: {
            code: "guided_daily_limit",
            message: "You have reached today's guided limit.",
          },
        },
        429,
        { "retry-after": "3600" },
      ),
    );
    const result = await call("plan_guided_path", { submission_id: "s1" });
    expect(result.isError).toBe(true);
    const text = textOf(result);
    expect(text).toContain("You have reached today's guided limit.");
    expect(text).not.toContain("[object Object]");
    expect(text).toContain("429");
    expect(text).toContain("3600");
  });

  it("plan_guided_path surfaces a 422 submission_too_long message", async () => {
    mockFetch(
      jsonResponse(
        {
          detail: {
            code: "submission_too_long",
            message: "This episode is too long to plan.",
          },
        },
        422,
      ),
    );
    const result = await call("plan_guided_path", { submission_id: "s1" });
    expect(result.isError).toBe(true);
    const text = textOf(result);
    expect(text).toContain("This episode is too long to plan.");
    expect(text).not.toContain("[object Object]");
  });

  it("get_guided_path GETs /submissions/{id}/guided and returns the JSON", async () => {
    const body = {
      status: "ready",
      error: null,
      course_id: "c1",
      generating_section: null,
      sections: [
        {
          index: 0,
          title: "Intro",
          summary: "Warm-up on greetings.",
          from_position: 1,
          to_position: 20,
          cefr: "A2",
          study_minutes: 8,
          suggested_focus: "comprehension",
          lesson_id: null,
          lesson_focus: null,
          completion: null,
        },
      ],
      active_job: null,
      last_generation_error: null,
    };
    mockFetch(jsonResponse(body));
    const result = await call("get_guided_path", { submission_id: "abc/1" });
    expect(lastUrl).toBe("https://api.test/api/v1/submissions/abc%2F1/guided");
    expect(lastInit.method).toBe("GET");
    expect(JSON.parse(textOf(result))).toEqual(body);
  });
});

describe("guided writer tools", () => {
  it("get_guided_writer_brief GETs /guided/brief and returns the JSON", async () => {
    const body = {
      section_index: 2,
      focus: "grammar",
      pack_version: "0.3.0",
      instructions: "Write the section following this pack.",
      contract: "lesson.v1 schema reference...",
      materials: {
        language: "de",
        translation_language: "en",
        level: "B1",
        source: { submission_id: "abc/1", from_time: 30, to_time: 95 },
        plan_entry: { index: 2, title: "Modal verbs" },
        sentences: [
          {
            position: 5,
            text: "Ich muss gehen.",
            translation: "I have to go.",
            speaker: "A",
            start: 31.2,
            end: 33.0,
          },
        ],
        known_lemmas: ["ich", "gehen"],
      },
    };
    mockFetch(jsonResponse(body));
    const result = await call("get_guided_writer_brief", {
      submission_id: "abc/1",
    });
    expect(lastUrl).toBe(
      "https://api.test/api/v1/submissions/abc%2F1/guided/brief",
    );
    expect(lastInit.method).toBe("GET");
    expect(JSON.parse(textOf(result))).toEqual(body);
  });

  it("get_guided_writer_brief surfaces a 409 plan_not_ready with its code", async () => {
    mockFetch(
      jsonResponse(
        {
          detail: {
            code: "plan_not_ready",
            message: "The guided path is not planned yet.",
          },
        },
        409,
      ),
    );
    const result = await call("get_guided_writer_brief", {
      submission_id: "s1",
    });
    expect(result.isError).toBe(true);
    const text = textOf(result);
    expect(text).toContain("The guided path is not planned yet.");
    expect(text).not.toContain("[object Object]");
    expect(text).toContain("plan_guided_path");
  });

  it("submit_guided_lesson POSTs the document + generator to the section slot", async () => {
    const summary = {
      lesson_id: "l9",
      app_url: "https://app.test/lessons/l9",
      section_index: 2,
      focus: "grammar",
      unknown_lemmas: [],
    };
    mockFetch(jsonResponse(summary, 201));
    const document = { format: "lesson.v1", blocks: [] };
    const result = await call("submit_guided_lesson", {
      submission_id: "abc/1",
      section_index: 2,
      document,
      generator: { skill: "lingochunk-guided", version: "0.11.0" },
    });
    expect(lastUrl).toBe(
      "https://api.test/api/v1/submissions/abc%2F1/guided/sections/2/lesson",
    );
    expect(lastInit.method).toBe("POST");
    expect(JSON.parse(String(lastInit.body))).toEqual({
      document,
      generator: { skill: "lingochunk-guided", version: "0.11.0" },
    });
    expect(JSON.parse(textOf(result))).toEqual(summary);
  });

  it("submit_guided_lesson surfaces every invalid_document error legibly", async () => {
    // The 422 lists EVERY problem at once; each must be readable (code +
    // message + locator), never collapsed to "[object Object]".
    mockFetch(
      jsonResponse(
        {
          detail: {
            code: "invalid_document",
            message: "The document is invalid.",
            errors: [
              {
                code: "dialogue_mismatch",
                message: "Line does not match the transcript.",
                positions: [5, 6],
              },
              {
                code: "audio_outside_slice",
                message: "Audio window is outside the section.",
                audio_windows: [{ start: 10, end: 40 }],
              },
              {
                code: "missing_field",
                message: "Field is required.",
                loc: "blocks.0.kind",
              },
            ],
            unknown_lemmas: [],
          },
        },
        422,
      ),
    );
    const result = await call("submit_guided_lesson", {
      submission_id: "s1",
      section_index: 0,
      document: { format: "lesson.v1", blocks: [] },
    });
    expect(result.isError).toBe(true);
    const text = textOf(result);
    expect(text).not.toContain("[object Object]");
    expect(text).toContain("dialogue_mismatch: Line does not match the transcript.");
    expect(text).toContain("positions 5, 6");
    expect(text).toContain("audio_outside_slice");
    expect(text).toContain("missing_field: Field is required. (blocks.0.kind)");
    // The remediation nudges fixing them all in one pass.
    expect(text).toContain("submit_guided_lesson again");
  });

  it("submit_guided_lesson treats a 409 section_taken as a re-brief cue", async () => {
    mockFetch(
      jsonResponse(
        {
          detail: {
            code: "section_taken",
            message: "This section already has a lesson.",
          },
        },
        409,
      ),
    );
    const result = await call("submit_guided_lesson", {
      submission_id: "s1",
      section_index: 1,
      document: { format: "lesson.v1", blocks: [] },
    });
    expect(result.isError).toBe(true);
    const text = textOf(result);
    expect(text).toContain("This section already has a lesson.");
    expect(text).toContain("get_guided_writer_brief");
    expect(text).not.toContain("[object Object]");
  });
});
