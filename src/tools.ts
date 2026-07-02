import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { ApiError, type LingoChunkClient, type QueryValue } from "./client.js";
import type { Config } from "./config.js";

/** Format a successful JSON result as a single text block. */
function jsonResult(value: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

/** Turn an error into a tool error result the agent can read and act on. */
function errorResult(err: unknown): CallToolResult {
  let text: string;
  if (err instanceof ApiError) {
    text = `LingoChunk API error ${err.status}: ${err.detail}`;
    if (err.status === 401) {
      text += "\nCheck LINGOCHUNK_TOKEN is a valid, un-revoked token (prefix lcp_).";
    } else if (err.status === 403) {
      text +=
        "\nThe token lacks the scope named above. Mint a new token in " +
        "LingoChunk settings that includes it.";
    } else if (err.status === 429 && err.retryAfter !== undefined) {
      text += `\nRate limited; retry after ${err.retryAfter}s.`;
    }
  } else if (err instanceof Error) {
    text = err.message;
  } else {
    text = String(err);
  }
  return { content: [{ type: "text", text }], isError: true };
}

/** Run a fetch and format its JSON, converting any error into a tool error. */
async function runJson(fn: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    return jsonResult(await fn());
  } catch (err) {
    return errorResult(err);
  }
}

/** Run a handler that builds its own result, converting errors uniformly. */
async function runResult(
  fn: () => Promise<CallToolResult>,
): Promise<CallToolResult> {
  try {
    return await fn();
  } catch (err) {
    return errorResult(err);
  }
}

const AUDIO_EXTENSIONS: Record<string, string> = {
  "audio/mp4": ".m4a",
  "audio/mpeg": ".mp3",
  "audio/webm": ".webm",
  "audio/wav": ".wav",
  "audio/ogg": ".ogg",
};

function extensionFor(contentType: string): string {
  const base = contentType.split(";")[0]!.trim().toLowerCase();
  return AUDIO_EXTENSIONS[base] ?? ".audio";
}

function sanitise(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}

/** Adapt a validated (zod-inferred) args object to the client's query shape.
 *  The client skips undefined/null/empty values, so this is a plain view. */
function params(obj: object): Record<string, QueryValue> {
  return obj as Record<string, QueryValue>;
}

export function registerTools(
  server: McpServer,
  client: LingoChunkClient,
  config: Config,
): void {
  server.registerTool(
    "get_vocabulary",
    {
      title: "Get vocabulary",
      description:
        "List the user's vocabulary, aggregated per word with FSRS maturity " +
        "(state/stability/due/reps). Grounded in the user's real listening " +
        "history. Filter by language, status (known|learning|new|due), or CEFR; " +
        "use 'since' (an ISO 8601 time from a prior 'updated_at') plus 'cursor' " +
        "for incremental sync. Sync is additive-only, so full-resync periodically.",
      inputSchema: {
        language: z
          .string()
          .optional()
          .describe("Filter to one learning language, ISO 639-1 (e.g. 'de')."),
        status: z
          .enum(["known", "learning", "new", "due"])
          .optional()
          .describe("Filter by learning status derived from FSRS state."),
        cefr: z.string().optional().describe("Filter by CEFR level (A1-C2)."),
        since: z
          .string()
          .optional()
          .describe("ISO 8601 time; return only words changed at/after it."),
        limit: z.number().int().min(1).max(200).optional(),
        cursor: z
          .string()
          .optional()
          .describe("Opaque cursor from a previous page's next_cursor."),
      },
    },
    async (args) => runJson(() => client.getVocabulary(params(args))),
  );

  server.registerTool(
    "lookup_word",
    {
      title: "Look up a word",
      description:
        "Look up one word: the user's own context (translation, gender, CEFR, " +
        "FSRS state) if they have cards for it, backed by the shared enrichment " +
        "lexicon as a gender/CEFR fallback. Use this to ground an LLM's guesses " +
        "about a word rather than inventing them.",
      inputSchema: {
        lemma: z.string().min(1).describe("Dictionary (base) form to look up."),
        language: z.string().min(1).describe("Language of the word, ISO 639-1."),
        pos: z.string().optional().describe("Part of speech, if known (e.g. NOUN)."),
      },
    },
    async (args) => runJson(() => client.lookupWord(params(args))),
  );

  server.registerTool(
    "list_library",
    {
      title: "List library",
      description:
        "List the user's ready-to-study episodes (their own submissions plus " +
        "collections they follow), newest first. Cursor-paginated. Use the " +
        "returned submission ids with get_transcript / get_audio_url / " +
        "get_audio_clip.",
      inputSchema: {
        limit: z.number().int().min(1).max(200).optional(),
        cursor: z
          .string()
          .optional()
          .describe("Opaque cursor from a previous page's next_cursor."),
      },
    },
    async (args) => runJson(() => client.listLibrary(params(args))),
  );

  server.registerTool(
    "get_transcript",
    {
      title: "Get transcript",
      description:
        "Fetch a submission's transcript: timestamped sentences with " +
        "translations. Sliceable by sentence-position range (from_sentence/" +
        "to_sentence) or time range in seconds (from_time/to_time) so you can " +
        "pull an excerpt instead of a whole episode. transcript_state tells you " +
        "if it is ready, still processing, or unavailable.",
      inputSchema: {
        submission_id: z.string().min(1).describe("The submission id."),
        from_sentence: z.number().int().min(1).optional(),
        to_sentence: z.number().int().min(1).optional(),
        from_time: z.number().min(0).optional().describe("Start of window (s)."),
        to_time: z.number().min(0).optional().describe("End of window (s)."),
      },
    },
    async ({ submission_id, ...rest }) =>
      runJson(() => client.getTranscript(submission_id, params(rest))),
  );

  server.registerTool(
    "get_audio_url",
    {
      title: "Get audio URL",
      description:
        "Get a short-lived presigned URL to a submission's full native audio " +
        "(supports HTTP Range). Use for streaming; for a durable snippet to " +
        "embed in a lesson, use get_audio_clip instead.",
      inputSchema: {
        submission_id: z.string().min(1).describe("The submission id."),
      },
    },
    async ({ submission_id }) =>
      runJson(() => client.getAudioUrl(submission_id)),
  );

  server.registerTool(
    "search_examples",
    {
      title: "Search example sentences",
      description:
        "Search the user's readable library for sentences. 'lemma' returns the " +
        "curated example sentences for that word; 'q' does a case-insensitive " +
        "substring match on sentence text. At least one is required. Results are " +
        "a capped sample, not exhaustive.",
      inputSchema: {
        lemma: z
          .string()
          .max(200)
          .optional()
          .describe("Find example sentences for this dictionary form."),
        q: z
          .string()
          .max(200)
          .optional()
          .describe("Case-insensitive substring match on sentence text."),
        language: z.string().optional().describe("Restrict to one language."),
        limit: z.number().int().min(1).max(100).optional(),
      },
    },
    async (args) => runJson(() => client.searchExamples(params(args))),
  );

  server.registerTool(
    "get_audio_clip",
    {
      title: "Get audio clip",
      description:
        "Cut a native-audio snippet [start, end] (seconds, max 60s) from a " +
        "submission and SAVE IT to a local file, returning the file path. Use " +
        "these small clips to embed audio in a self-contained HTML lesson (e.g. " +
        "as a data URI). Rate limited.",
      inputSchema: {
        submission_id: z.string().min(1).describe("The submission id."),
        start: z.number().min(0).describe("Clip start in seconds."),
        end: z.number().gt(0).describe("Clip end in seconds (start < end)."),
      },
    },
    async ({ submission_id, start, end }) =>
      runResult(async () => {
        const clip = await client.getAudioClip(submission_id, start, end);
        await fs.mkdir(config.clipDir, { recursive: true });
        const filename = `clip-${sanitise(submission_id)}-${start}-${end}${extensionFor(
          clip.contentType,
        )}`;
        const filePath = path.join(config.clipDir, filename);
        await fs.writeFile(filePath, clip.data);
        return jsonResult({
          path: filePath,
          media_type: clip.contentType,
          size_bytes: clip.data.byteLength,
        });
      }),
  );
}
