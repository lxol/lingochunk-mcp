import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { ApiError, type LingoChunkClient, type QueryValue } from "./client.js";
import type { Config } from "./config.js";

/** card.v1 kinds (POST /cards with format=card.v1). Mirrors the server's
 *  CardKindV1 / CARD_V1_BLUR_KINDS in lingochunk_shared.models.public_v1. */
const CARD_V1_KINDS = new Set([
  "word",
  "phrase",
  "collocation",
  "idiom",
  "chunk",
  "grammar",
  "cloze",
  "contrast",
  "qa",
  "production",
]);
const CARD_V1_BLUR_KINDS = new Set(["grammar", "cloze", "contrast", "production"]);

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

// Shared cadence for the async-job pollers (deck export and language apply):
// both start a job then poll its status to completion.
const POLL_INTERVAL_MS = 2_000;
const POLL_BUDGET_MS = 60_000;
// Fallback wait when a 429 carries no Retry-After.
const POLL_RETRY_FALLBACK_MS = 5_000;

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
          : POLL_RETRY_FALLBACK_MS;
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
  const deadline = Date.now() + POLL_BUDGET_MS;
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
    await sleep(POLL_INTERVAL_MS);
  }
}

/** POST the draft commit, absorbing a 429 with a Retry-After backoff (capped by
 *  the remaining budget) rather than aborting. Returns the apply job id, or null
 *  when the budget runs out mid-backoff. A 400/403/404/409 bubbles up. */
async function commitDraft(
  client: LingoChunkClient,
  submissionId: string,
  language: string,
  deadline: number,
): Promise<string | null> {
  for (;;) {
    try {
      const { job_id } = await client.commitTranslationDraft(
        submissionId,
        language,
      );
      return job_id;
    } catch (err) {
      if (!(err instanceof ApiError) || err.status !== 429) throw err;
      const remaining = deadline - Date.now();
      if (remaining <= 0) return null;
      const wait =
        err.retryAfter && err.retryAfter > 0
          ? err.retryAfter * 1000
          : POLL_RETRY_FALLBACK_MS;
      await sleep(Math.min(wait, remaining));
    }
  }
}

/** Commit a language draft, then poll the apply job for up to ~60s. On success
 *  resolve the new sibling's submission id via list_languages. A 409 (the draft
 *  is missing sentence positions) or 403 bubbles up as an ApiError. */
async function commitAndPoll(
  client: LingoChunkClient,
  submissionId: string,
  language: string,
): Promise<CallToolResult> {
  const deadline = Date.now() + POLL_BUDGET_MS;
  const jobId = await commitDraft(client, submissionId, language, deadline);
  if (jobId === null) {
    return jsonResult({
      status: "processing",
      language,
      message:
        "Rate limited before the commit could start; call commit_language " +
        "again shortly (a duplicate commit converges safely).",
    });
  }
  for (;;) {
    const job = await client.getJob(jobId);
    if (job.status === "completed") {
      let siblingId: string | undefined;
      try {
        const langs = await client.listSubmissionLanguages(submissionId);
        siblingId = langs.languages.find(
          (l) => l.language === language,
        )?.submission_id;
      } catch {
        // The apply succeeded; failing to resolve the sibling id is non-fatal.
      }
      return jsonResult({
        status: "completed",
        language,
        submission_id: siblingId,
        job_id: jobId,
      });
    }
    if (job.status === "failed") {
      return jsonResult({
        status: "failed",
        language,
        job_id: jobId,
        error: job.error ?? null,
        message:
          "The apply job failed. Check the draft with list_languages, then " +
          "call commit_language again to retry.",
      });
    }
    if (Date.now() >= deadline) {
      return jsonResult({
        status: "processing",
        language,
        job_id: jobId,
        message:
          "Still applying. Call list_languages shortly to see the new " +
          "sibling's status; do not re-commit unless it never appears.",
      });
    }
    await sleep(POLL_INTERVAL_MS);
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
        "'new'). PREFER the card.v1 kinds (word | phrase | collocation | idiom " +
        "| chunk | grammar | cloze | contrast | qa | production): they produce " +
        "native-grade cards - the server derives the highlight/blur painting " +
        "and (for the lexical kinds) a native-audio clip of the focus span " +
        "from the episode recording. Every card.v1 card anchors to a real " +
        "transcript sentence: pass submission_id + sentence_position (from " +
        "get_transcript) + headword + translation, and focus_span as a " +
        "VERBATIM substring of that sentence (the exact surface form: 'habe', " +
        "not 'haben'; copy it from the transcript, never paraphrase). " +
        "grammar/cloze/contrast/production REQUIRE focus_span - it is the " +
        "hidden answer - and reject with code=focus_span_not_verbatim if it " +
        "does not match. Lexical kinds create a forward+reverse pair " +
        "(direction=forward to skip the reverse); study kinds are forward-only. " +
        "Responses carry a problems[] list of degradations (e.g. " +
        "focus_span_no_timings) - fix and resend to clear them; resending the " +
        "same headword updates the card in place (created=false), preserving " +
        "review history. Read the lingochunk-cards skill for per-kind guidance " +
        "and quality rules before batch-creating cards. LEGACY kinds still " +
        "work: kind=vocab adds a word ALREADY in the user's vocabulary by " +
        "lemma (409 code=ambiguous_lemma: pass submission_id or pos); " +
        "kind=custom is a flat front/back card (409 code=duplicate_card is " +
        "expected, not worth retrying). Omit deck_id and the card goes to the " +
        "deck for its own submission (immediately visible, reviewable, " +
        "exportable); an explicit deck_id must belong to that submission. " +
        "NOTE: deleting the anchoring episode deletes the card (cascade), and " +
        "a card added while the app's Words tab is open on that episode may be " +
        "overwritten by the app's own save. Requires the cards:write scope.",
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
          .enum([
            "word",
            "phrase",
            "collocation",
            "idiom",
            "chunk",
            "grammar",
            "cloze",
            "contrast",
            "qa",
            "production",
            "vocab",
            "custom",
          ])
          .describe(
            "card.v1 kinds: word/phrase/collocation/idiom/chunk (lexical; " +
              "fwd+rev pair, span audio) and grammar/cloze/contrast/qa/" +
              "production (study; forward-only, per-kind chrome). Legacy: " +
              "vocab (existing word by lemma), custom (flat front/back).",
          ),
        // --- card.v1 fields ---
        headword: z
          .string()
          .max(200)
          .optional()
          .describe(
            "card.v1: citation form shown on the card; include the article for " +
              "gendered nouns ('die Landschaft'). For qa this is the question.",
          ),
        translation: z
          .string()
          .max(500)
          .optional()
          .describe(
            "card.v1: learner-language gloss (lexical), the answer (qa), or " +
              "the meaning prompt (production).",
          ),
        sentence_position: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe(
            "1-based transcript position (see get_transcript). card.v1: the " +
              "example sentence the card anchors to (REQUIRED). Legacy custom: " +
              "optional example anchor.",
          ),
        focus_span: z
          .string()
          .max(150)
          .optional()
          .describe(
            "card.v1: VERBATIM substring of the anchor sentence locating the " +
              "target (drives highlight/blur + span audio). REQUIRED for " +
              "grammar/cloze/contrast/production (it is the hidden answer).",
          ),
        context_positions: z
          .array(z.number().int().min(1))
          .max(4)
          .optional()
          .describe(
            "card.v1: up to 4 neighbouring sentence positions shown as framing " +
              "context.",
          ),
        hint: z
          .string()
          .max(160)
          .optional()
          .describe("card.v1: optional on-demand hint (stored in card_meta)."),
        cefr: z
          .enum(["A1", "A2", "B1", "B2", "C1", "C2"])
          .optional()
          .describe("card.v1: optional CEFR tag."),
        options: z
          .array(z.string().max(80))
          .max(3)
          .optional()
          .describe("card.v1 contrast: the 2-3 confusable choices."),
        correct: z
          .string()
          .max(80)
          .optional()
          .describe("card.v1 contrast: the right option; must be in options."),
        question: z
          .string()
          .max(200)
          .optional()
          .describe("card.v1 qa: overrides headword as the displayed question."),
        direction: z
          .enum(["both", "forward"])
          .optional()
          .describe(
            "card.v1 lexical kinds: 'both' (default) or 'forward' to skip the " +
              "reverse twin. Study kinds are always forward-only.",
          ),
        // --- legacy fields ---
        lemma: z
          .string()
          .max(200)
          .optional()
          .describe("Dictionary form to add (legacy kind=vocab)."),
        pos: z
          .string()
          .max(20)
          .optional()
          .describe(
            "Part of speech, to disambiguate the lemma (legacy kind=vocab); " +
              "case-insensitive.",
          ),
        submission_id: z
          .string()
          .optional()
          .describe(
            "The episode the card anchors to (REQUIRED for card.v1 and legacy " +
              "custom); disambiguates the lemma for legacy vocab.",
          ),
        front: z
          .string()
          .max(200)
          .optional()
          .describe("Front/prompt text (legacy kind=custom; max 200 chars)."),
        back: z
          .string()
          .max(500)
          .optional()
          .describe("Back/answer text (legacy kind=custom; max 500 chars)."),
        note: z
          .string()
          .max(300)
          .optional()
          .describe(
            "One-line 'why', shown on the back note rail (card.v1 and legacy " +
              "custom; max 300 chars).",
          ),
      },
    },
    async (args) => {
      // Mirror the server's cross-field rules so the message is precise and no
      // request is wasted.
      if (CARD_V1_KINDS.has(args.kind)) {
        if (
          !(
            args.submission_id &&
            args.headword &&
            args.translation &&
            args.sentence_position
          )
        ) {
          return errorResult(
            new Error(
              "card.v1 kinds require 'submission_id', 'headword', " +
                "'translation' and 'sentence_position'.",
            ),
          );
        }
        if (CARD_V1_BLUR_KINDS.has(args.kind) && !args.focus_span) {
          return errorResult(
            new Error(
              `add_card kind=${args.kind} requires 'focus_span' (the hidden ` +
                "answer, copied VERBATIM from the sentence).",
            ),
          );
        }
        if (
          args.kind === "contrast" &&
          !(
            args.options &&
            args.options.length >= 2 &&
            args.correct &&
            args.options.includes(args.correct)
          )
        ) {
          return errorResult(
            new Error(
              "add_card kind=contrast requires 2-3 'options' and 'correct' " +
                "∈ options.",
            ),
          );
        }
        return runJson(() =>
          client.addCard({
            format: "card.v1",
            deck_id: args.deck_id,
            submission_id: args.submission_id,
            kind: args.kind,
            headword: args.headword,
            translation: args.translation,
            note: args.note,
            hint: args.hint,
            cefr: args.cefr,
            example: {
              sentence_position: args.sentence_position,
              focus_span: args.focus_span,
            },
            context_positions: args.context_positions,
            options: args.options,
            correct: args.correct,
            question: args.question,
            direction: args.direction,
          }),
        );
      }
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
        "Save a lesson to the user's private LingoChunk library (up to 100 " +
        "lessons, private by default). PREFERRED: pass `document`, a " +
        "structured lesson.v1 JSON document (see the lingochunk-lesson " +
        "skill) - the app renders it natively in a Lessons tab on the source " +
        "episode, with real audio playback, live vocabulary state, links " +
        "into the Words/Listen tabs and a built-in Ask AI tutor; the " +
        "response's app_url is where it opens, and unknown_lemmas lists any " +
        "glossary lemmas the episode does not know (fix and re-save to " +
        "restore their crosslinks). The server validates the document " +
        "against the source episode and rejects misquoted or out-of-range " +
        "sentence references (400 with a stable code). LEGACY: pass `html` " +
        "(a complete self-contained HTML file, 10 MB max, title + language " +
        "required) to store an opaque artefact opened via a short-lived " +
        "view URL. Exactly one of document/html. Requires the lessons:write " +
        "scope.",
      inputSchema: {
        title: z
          .string()
          .min(1)
          .max(255)
          .optional()
          .describe("Lesson title (required with html; ignored with document)."),
        language: z
          .string()
          .min(1)
          .max(10)
          .optional()
          .describe("Target language, ISO 639-1 (required with html)."),
        html: z
          .string()
          .min(1)
          .optional()
          .describe("LEGACY: the complete self-contained HTML document."),
        document: z
          .record(z.unknown())
          .optional()
          .describe(
            "A lesson.v1 document (format:'lesson.v1'). The server is the " +
              "validator of record; on 400/422 read the error detail, fix " +
              "the document and retry.",
          ),
        source_submission_ids: z
          .array(z.string())
          .optional()
          .describe("Optional provenance: the episode ids the lesson was built from."),
      },
    },
    async (args) => runJson(() => client.createLesson(args)),
  );

  server.registerTool(
    "delete_lesson",
    {
      title: "Delete a lesson",
      description:
        "Permanently delete ONE of the user's saved lessons (the stored " +
        "document and its metadata row). Destructive and not undoable: only " +
        "delete a lesson the user has explicitly named or has just asked to " +
        "replace; never sweep lessons unprompted. Typical use: iterating on " +
        "a lesson - re-saving always creates a NEW lesson, so delete the " +
        "superseded draft (its id is in save_lesson's response) to stay " +
        "under the 100-lesson cap. 404 means the id does not exist or is " +
        "not the user's. Requires the lessons:write scope.",
      annotations: { destructiveHint: true, idempotentHint: true },
      inputSchema: {
        lesson_id: z
          .string()
          .min(1)
          .max(36)
          .describe("The lesson to delete (id from save_lesson's response)."),
      },
    },
    async ({ lesson_id }) =>
      runJson(async () => {
        await client.deleteLesson(lesson_id);
        return { deleted: true, lesson_id };
      }),
  );

  // --- Language / translation tools (phase 4) -----------------------------

  server.registerTool(
    "list_languages",
    {
      title: "List submission languages",
      description:
        "List a submission's target languages and how to add more. Returns " +
        "'languages' (the fan-out group so far, each with its own " +
        "submission_id, status and is_primary flag), 'available_targets' " +
        "(ordinary languages you can hand to add_language for the server-side " +
        "Groq fan-out), 'simplify_targets' (leveled same-language codes like " +
        "'de-a2' = German audio glossed in simpler A2 German, which ONLY the " +
        "draft flow accepts) and 'drafts' (in-progress agent translations with " +
        "sentences_drafted / sentence_count). Use it to choose a target and to " +
        "poll a target's status after add_language or commit_language. " +
        "Requires the content:read scope.",
      inputSchema: {
        submission_id: z.string().min(1).describe("The submission id."),
      },
    },
    async ({ submission_id }) =>
      runJson(() => client.listSubmissionLanguages(submission_id)),
  );

  server.registerTool(
    "add_language",
    {
      title: "Add languages (server-side fan-out)",
      description:
        "Fan a submission out into extra ORDINARY target languages " +
        "server-side (Groq translation; spends none of your tokens). Pass " +
        "1-10 language codes from list_languages' available_targets; returns a " +
        "job per accepted language and a 'skipped' list (e.g. the source " +
        "language, an existing sibling, or a leveled code with reason " +
        "'agent_only_target'). Poll list_languages until each new sibling's " +
        "status is 'ready'. Leveled same-language codes (en-a2, de-b1, ...) " +
        "are NOT accepted here: translate and commit them yourself via " +
        "get_translation_source + put_language_translations + commit_language. " +
        "Requires the translations:write scope.",
      inputSchema: {
        submission_id: z.string().min(1).describe("The submission id."),
        languages: z
          .array(
            z
              .string()
              .min(1)
              .transform((v) => v.trim().toLowerCase()),
          )
          .min(1)
          .max(10)
          .describe(
            "1-10 ordinary target codes from available_targets " +
              "(normalised to lowercase).",
          ),
      },
    },
    async ({ submission_id, languages }) =>
      runJson(() => client.addLanguages(submission_id, languages)),
  );

  server.registerTool(
    "get_translation_source",
    {
      title: "Get translation source",
      description:
        "Page through the primary submission's sentences to translate " +
        "yourself. Each sentence gives the source 'text', a " +
        "'pivot_translation' (the whole sentence in the pivot language) and " +
        "'tokens' (surface, lemma, pos and a 'pivot_meaning' that FIXES each " +
        "word's sense in context). THE CONTRACT you must honour when you " +
        "translate: produce exactly one meaning per token, in the same order, " +
        "same length as 'tokens'; render the sense the 'pivot_meaning' fixes " +
        "(do not re-interpret the word); PUNCT and INTJ tokens map to \"\"; " +
        "proper nouns stay as the name; never copy the pivot or source word " +
        "verbatim as its meaning. Read the lingochunk-add-language skill for " +
        "the full per-level rules (ordinary target vs leveled same-language). " +
        "Page with 'from_position' (0-based) until 'next_from_position' is " +
        "null. Only the READY primary of a group is a valid source. Requires " +
        "the content:read scope.",
      inputSchema: {
        submission_id: z.string().min(1).describe("The submission id."),
        from_position: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe("0-based sentence position to start from (default 0)."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe("Sentences per page (max 100)."),
      },
    },
    async ({ submission_id, ...rest }) =>
      runJson(() => client.getTranslationSource(submission_id, params(rest))),
  );

  server.registerTool(
    "put_language_translations",
    {
      title: "Put draft translations",
      description:
        "Upload a batch of your draft sentences for one target or leveled " +
        "language (1-100 per call; page with get_translation_source and PUT " +
        "25-50 at a time). Each sentence carries its 0-based 'position', a " +
        "whole-sentence 'translation' (or null to leave the sentence back " +
        "blank - hide-on-fail for leveled decks) and 'meanings' (one per " +
        "source token, SAME ORDER and EXACT length as that sentence's " +
        "tokens). The server validates each sentence against the real " +
        "transcript and returns a 'rejected' list (meanings_length_mismatch " +
        "with expected/got, unknown position, oversize strings) while " +
        "ACCEPTING the rest - fix the rejected ones and PUT them again. " +
        "'sentences_drafted' / 'sentence_count' track completeness. Set " +
        "'generator' to the model producing the translations, for provenance. " +
        "Keep a local tally of covered positions: commit_language needs every " +
        "one. Requires the translations:write scope.",
      inputSchema: {
        submission_id: z.string().min(1).describe("The submission id."),
        language: z
          .string()
          .min(1)
          .transform((v) => v.trim().toLowerCase())
          .describe(
            "The target or leveled code being drafted (normalised to " +
              "lowercase).",
          ),
        generator: z
          .string()
          .max(100)
          .optional()
          .describe("Model producing the translations, recorded for provenance."),
        sentences: z
          .array(
            z.object({
              position: z
                .number()
                .int()
                .min(0)
                .describe("0-based sentence position from get_translation_source."),
              translation: z
                .string()
                .nullable()
                .optional()
                .describe("Whole-sentence text, or null for no sentence back."),
              meanings: z
                .array(z.string())
                .describe(
                  "One meaning per source token, same order and exact length " +
                    "as the sentence's tokens.",
                ),
            }),
          )
          .min(1)
          .max(100)
          .describe("1-100 draft sentences."),
      },
    },
    async ({ submission_id, language, generator, sentences }) =>
      runJson(() =>
        client.putTranslations(submission_id, language, {
          generator,
          sentences: sentences.map((s) => ({
            position: s.position,
            translation: s.translation ?? null,
            meanings: s.meanings,
          })),
        }),
      ),
  );

  server.registerTool(
    "commit_language",
    {
      title: "Commit a language draft",
      description:
        "Validate a complete draft for one language and apply it, minting a " +
        "new sibling submission (its own deck). The draft must cover EVERY " +
        "sentence position of the primary: a 409 lists the missing count and " +
        "first missing positions - PUT those with put_language_translations, " +
        "then commit again. This starts the apply job and polls it for up to " +
        "~60s: it returns {status:'completed', submission_id} with the new " +
        "sibling's id when ready, {status:'processing'} (call list_languages " +
        "shortly to check) if it is still applying, or {status:'failed'} to " +
        "retry. A duplicate commit while a job is in flight converges safely. " +
        "Requires the translations:write scope.",
      inputSchema: {
        submission_id: z.string().min(1).describe("The submission id."),
        language: z
          .string()
          .min(1)
          .transform((v) => v.trim().toLowerCase())
          .describe(
            "The target or leveled code to commit (normalised to lowercase).",
          ),
      },
    },
    async ({ submission_id, language }) =>
      runResult(() => commitAndPoll(client, submission_id, language)),
  );

  server.registerTool(
    "discard_language_draft",
    {
      title: "Discard a language draft",
      description:
        "Permanently delete the in-progress draft sentences for one language " +
        "on a submission (NOT any committed sibling deck - those are " +
        "untouched). Destructive: only discard a draft the user has asked to " +
        "abandon or restart. Returns {deleted_sentences}. Requires the " +
        "translations:write scope.",
      annotations: { destructiveHint: true, idempotentHint: true },
      inputSchema: {
        submission_id: z.string().min(1).describe("The submission id."),
        language: z
          .string()
          .min(1)
          .transform((v) => v.trim().toLowerCase())
          .describe(
            "The target or leveled code whose draft to delete (normalised to " +
              "lowercase).",
          ),
      },
    },
    async ({ submission_id, language }) =>
      runJson(() => client.deleteTranslationDraft(submission_id, language)),
  );
}
