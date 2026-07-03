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

/** AbortSignal.timeout rejects with a DOMException named "TimeoutError" (a
 *  manual abort is "AbortError"); both mean the request gave up waiting. */
function isTimeoutError(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.name === "TimeoutError" || err.name === "AbortError")
  );
}

/** Node's fetch reports a network failure as "fetch failed" with the real
 *  reason on `.cause` (e.g. getaddrinfo ENOTFOUND). Surface that reason. */
function causeMessage(err: Error): string | undefined {
  const cause = (err as { cause?: unknown }).cause;
  if (cause instanceof Error && cause.message) return cause.message;
  if (typeof cause === "string" && cause) return cause;
  return undefined;
}

/** Turn an error into a tool error result the agent can read and act on. */
function errorResult(err: unknown): CallToolResult {
  let text: string;
  if (err instanceof ApiError) {
    text = `LingoChunk API error ${err.status}: ${err.detail}`;
    // A machine-readable code (when present) is more specific than the status.
    if (err.code === "ambiguous_lemma") {
      text +=
        "\nRetry with the 'pos' (or 'submission_id') value named above to pick " +
        "one.";
    } else if (err.code === "duplicate_card") {
      text += "\nThe card already exists; this is safe to ignore, not to retry.";
    } else if (err.code === "lesson_cap") {
      text +=
        "\nYou are at the lesson limit; delete an old lesson in your LingoChunk " +
        "library (Settings) to make room.";
    } else if (err.status === 401) {
      text += "\nCheck LINGOCHUNK_TOKEN is a valid, un-revoked token (prefix lcp_).";
    } else if (err.status === 403) {
      text +=
        "\nThe token lacks the scope named above. Mint a new token in " +
        "LingoChunk settings that includes it.";
    } else if (err.status === 429 && err.retryAfter !== undefined) {
      text += `\nRate limited; retry after ${err.retryAfter}s.`;
    }
  } else if (isTimeoutError(err)) {
    text =
      "The request to the LingoChunk API timed out after 30s. Check your " +
      "connection (and LINGOCHUNK_BASE_URL) and try again.";
  } else if (err instanceof Error) {
    text = err.message;
    const cause = causeMessage(err);
    if (cause) text += `: ${cause}`;
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

const EXPORT_POLL_INTERVAL_MS = 2_000;
const EXPORT_POLL_BUDGET_MS = 60_000;
// Fallback wait when a 429 carries no Retry-After.
const EXPORT_RETRY_FALLBACK_MS = 5_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** POST the export, absorbing a 429 by sleeping for Retry-After (capped by the
 *  remaining budget) and retrying rather than aborting the whole tool. Returns
 *  false only when the budget runs out mid-backoff. A 400/403/etc bubbles up. */
async function triggerExport(
  client: LingoChunkClient,
  deckId: number,
  deadline: number,
): Promise<boolean> {
  for (;;) {
    try {
      await client.exportDeck(deckId);
      return true;
    } catch (err) {
      if (!(err instanceof ApiError) || err.status !== 429) throw err;
      const remaining = deadline - Date.now();
      if (remaining <= 0) return false;
      const wait =
        err.retryAfter && err.retryAfter > 0
          ? err.retryAfter * 1000
          : EXPORT_RETRY_FALLBACK_MS;
      await sleep(Math.min(wait, remaining));
    }
  }
}

/** Start a deck export, then poll its status for up to ~60s and return a compact
 *  result the agent can act on. The endpoint does not re-enqueue while a job is
 *  in flight, so a 429 while triggering is absorbed with a Retry-After backoff
 *  (not an abort). A 400 (e.g. a deck with no linked submission) or 403 bubbles
 *  up as an ApiError for errorResult. */
async function exportAndPoll(
  client: LingoChunkClient,
  deckId: number,
): Promise<CallToolResult> {
  const deadline = Date.now() + EXPORT_POLL_BUDGET_MS;
  if (!(await triggerExport(client, deckId, deadline))) {
    return jsonResult({
      status: "pending",
      message:
        "Rate limited before the export could start; call export_anki_deck " +
        "again shortly.",
    });
  }
  for (;;) {
    const st = await client.exportDeckStatus(deckId);
    if (st.status === "ready") {
      return jsonResult({ status: "ready", download_url: st.download_url });
    }
    if (st.status === "failed") {
      return jsonResult({
        status: "failed",
        message: "Export failed; call export_anki_deck again to retry.",
      });
    }
    if (st.status === "none") {
      return jsonResult({
        status: "none",
        message:
          "No export is available to download; call export_anki_deck again to " +
          "trigger a fresh one.",
      });
    }
    if (Date.now() >= deadline) {
      return jsonResult({
        status: "pending",
        message:
          "Still generating. Call export_anki_deck again shortly to check " +
          "status; it will not start a second job while one is in flight. Only " +
          "re-trigger if a later call reports 'failed' or 'none'.",
      });
    }
    await sleep(EXPORT_POLL_INTERVAL_MS);
  }
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
        "for incremental sync. Sync is additive-only, so full-resync periodically. " +
        "The list is cursor-paginated (limit up to 200); follow next_cursor until " +
        "it is null to read the complete set.",
      inputSchema: {
        language: z
          .string()
          .transform((v) => v.toLowerCase())
          .optional()
          .describe(
            "Filter to one learning language, ISO 639-1, e.g. 'de' " +
              "(normalised to lowercase).",
          ),
        status: z
          .enum(["known", "learning", "new", "due"])
          .optional()
          .describe("Filter by learning status derived from FSRS state."),
        cefr: z
          .string()
          .transform((v) => v.toUpperCase())
          .refine((v) => ["A1", "A2", "B1", "B2", "C1", "C2"].includes(v), {
            message: "cefr must be one of A1, A2, B1, B2, C1, C2",
          })
          .optional()
          .describe("Filter by CEFR level; one of A1-C2 (normalised to uppercase)."),
        since: z
          .string()
          .refine((v) => !Number.isNaN(Date.parse(v)), {
            message:
              "since must be a date or datetime string, e.g. 2026-07-01 or " +
              "2026-07-01T10:00:00Z",
          })
          .optional()
          .describe("Return only words changed at/after this date or datetime."),
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
        language: z
          .string()
          .min(1)
          .transform((v) => v.toLowerCase())
          .describe("Language of the word, ISO 639-1 (normalised to lowercase)."),
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
        "substring match on sentence text. At least one is required, and 'lemma' " +
        "takes precedence when both are given. Results are a capped sample, not " +
        "exhaustive.",
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
        language: z
          .string()
          .transform((v) => v.toLowerCase())
          .optional()
          .describe("Restrict to one language (normalised to lowercase)."),
        limit: z.number().int().min(1).max(100).optional(),
      },
    },
    async (args) => {
      // The API also 400s on this, but validating here names both fields and
      // saves a round trip.
      if (!args.lemma && !args.q) {
        return errorResult(
          new Error("search_examples needs at least one of 'lemma' or 'q'."),
        );
      }
      return runJson(() => client.searchExamples(params(args)));
    },
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
        // The API enforces these too; checking here gives a precise message and
        // avoids a wasted request.
        if (!(start < end)) {
          throw new Error("get_audio_clip needs start < end.");
        }
        if (end - start > 60) {
          throw new Error(
            "get_audio_clip cannot exceed 60 seconds (end - start).",
          );
        }
        const clip = await client.getAudioClip(submission_id, start, end);
        // 0o700: the clip dir holds the user's own study audio, so keep it
        // readable only by them (mode applies to dirs this call creates).
        await fs.mkdir(config.clipDir, { recursive: true, mode: 0o700 });
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

  // --- Write tools (phase 3) ----------------------------------------------

  server.registerTool(
    "list_decks",
    {
      title: "List decks",
      description:
        "List the user's study decks so you can pick a deck_id before adding " +
        "cards (add_card) or exporting (export_anki_deck). Each deck reports its " +
        "language and card counts (total / new / due). Requires the cards:write " +
        "or decks:export scope.",
      inputSchema: {},
    },
    async () => runJson(() => client.listDecks()),
  );

  server.registerTool(
    "add_card",
    {
      title: "Add a card",
      description:
        "Add a card to the user's LingoChunk review queue (FSRS; it starts as " +
        "'new'). kind=vocab adds a word the user ALREADY has in their vocabulary, " +
        "resolved by lemma against their own content (404 if the lemma is not in " +
        "their vocabulary; 409 code=ambiguous_lemma if it occurs in several " +
        "episodes or under several parts of speech, so pass submission_id or pos " +
        "as the message names). kind=custom adds a freeform card and REQUIRES " +
        "front, back and submission_id (the episode it anchors to); pass " +
        "sentence_position to anchor its example to a specific transcript " +
        "sentence. Omit deck_id and the card goes to the deck for its own " +
        "submission (the same deck the app builds, reviews and exports that " +
        "episode from, so it is immediately visible and exportable); an explicit " +
        "deck_id must belong to that submission (400 otherwise). A 409 " +
        "code=duplicate_card means the card already exists: expected, not worth " +
        "retrying. NOTE: deleting the anchoring episode deletes the card " +
        "(cascade), and a card added while the app's Words tab is open on that " +
        "episode may be overwritten by the app's own save, so add cards when the " +
        "app is not actively editing that deck. Requires the cards:write scope.",
      inputSchema: {
        deck_id: z
          .number()
          .int()
          .optional()
          .describe(
            "Target deck id from list_decks; omit to use the deck for the card's " +
              "own submission. When given, it must belong to that submission.",
          ),
        kind: z
          .enum(["vocab", "custom"])
          .describe("vocab = a word from your vocabulary; custom = freeform front/back."),
        lemma: z
          .string()
          .max(200)
          .optional()
          .describe("Dictionary form to add (kind=vocab)."),
        pos: z
          .string()
          .max(20)
          .optional()
          .describe("Part of speech, to disambiguate the lemma (kind=vocab); case-insensitive."),
        submission_id: z
          .string()
          .optional()
          .describe(
            "Disambiguate the lemma to one episode (kind=vocab); the episode the " +
              "card anchors to (REQUIRED for kind=custom).",
          ),
        front: z
          .string()
          .max(200)
          .optional()
          .describe("Front/prompt text (kind=custom; max 200 chars)."),
        back: z
          .string()
          .max(500)
          .optional()
          .describe("Back/answer text (kind=custom; max 500 chars)."),
        note: z
          .string()
          .max(300)
          .optional()
          .describe("Optional note shown on the card (kind=custom; max 300 chars)."),
        sentence_position: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe(
            "1-based transcript position (see get_transcript) to anchor a custom " +
              "card's example; defaults to the submission's first sentence.",
          ),
      },
    },
    async (args) => {
      // Mirror the server's cross-field rules so the message is precise and no
      // request is wasted.
      if (args.kind === "vocab" && !args.lemma) {
        return errorResult(new Error("add_card kind=vocab requires 'lemma'."));
      }
      if (
        args.kind === "custom" &&
        !(args.front && args.back && args.submission_id)
      ) {
        return errorResult(
          new Error(
            "add_card kind=custom requires 'front', 'back' and 'submission_id'.",
          ),
        );
      }
      return runJson(() => client.addCard(args));
    },
  );

  server.registerTool(
    "export_anki_deck",
    {
      title: "Export an Anki deck",
      description:
        "Export one of the user's decks to an Anki .apkg and return a download " +
        "URL. Running it costs nothing (no LLM). This starts the export and polls " +
        "status for up to ~60s, absorbing rate limits with a Retry-After backoff " +
        "and never starting a second job while one is already in flight. It " +
        "returns {status:'ready', download_url} when the file is ready, " +
        "{status:'pending'} (call again shortly to keep checking) while it " +
        "generates, {status:'failed'} to retry, or {status:'none'} (nothing to " +
        "download; call again to trigger a fresh export). A deck with no linked " +
        "source episode cannot be exported (400). Use list_decks to find a " +
        "deck_id. Requires the decks:export scope.",
      inputSchema: {
        deck_id: z.number().int().describe("The deck to export (from list_decks)."),
      },
    },
    async ({ deck_id }) => runResult(() => exportAndPoll(client, deck_id)),
  );

  server.registerTool(
    "save_lesson",
    {
      title: "Save a lesson",
      description:
        "Save a single self-contained HTML lesson to the user's private " +
        "LingoChunk library (10 MB max, up to 100 lessons, private by default). " +
        "Returns the lesson metadata plus a short-lived view URL to open it now; " +
        "its durable home is the app's library, where it opens on any device. Use " +
        "this to keep a lesson the lingochunk-lesson skill produced. Requires the " +
        "lessons:write scope.",
      inputSchema: {
        title: z.string().min(1).max(255).describe("Lesson title."),
        language: z
          .string()
          .min(1)
          .max(10)
          .describe("Target language, ISO 639-1."),
        html: z
          .string()
          .min(1)
          .describe("The complete self-contained HTML document."),
        source_submission_ids: z
          .array(z.string())
          .optional()
          .describe("Optional provenance: the episode ids the lesson was built from."),
      },
    },
    async (args) => runJson(() => client.createLesson(args)),
  );
}
