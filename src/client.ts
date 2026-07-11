import type { Config } from "./config.js";

/** An error returned by the LingoChunk API (non-2xx), carrying the HTTP status,
 *  the API's `detail` message, and its stable machine-readable `code` (e.g.
 *  ``ambiguous_lemma``) when present, so tools can branch on the outcome. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string,
    readonly retryAfter?: number,
    readonly code?: string,
  ) {
    super(`LingoChunk API ${status}: ${detail}`);
    this.name = "ApiError";
  }
}

/** A binary audio clip plus the media type the server reported. */
export interface AudioClip {
  data: Buffer;
  contentType: string;
}

/** Result of POST /decks/{id}/export. */
export interface DeckExportStart {
  status: "ready" | "queued";
  poll: string;
}

/** Result of GET /decks/{id}/export/status. */
export interface DeckExportStatus {
  status: "ready" | "pending" | "failed" | "none";
  download_url?: string;
}

/** One target language present on a submission's fan-out group. */
export interface SubmissionLanguage {
  language: string;
  submission_id: string;
  status: string;
  is_primary: boolean;
}

/** An in-progress agent-supplied translation draft for one language. */
export interface DraftSummary {
  language: string;
  sentences_drafted: number;
  sentence_count: number;
}

/** Result of GET /submissions/{id}/languages. */
export interface SubmissionLanguages {
  source_language: string;
  languages: SubmissionLanguage[];
  /** Ordinary Groq targets addable via add_language (source + existing removed). */
  available_targets: string[];
  /** Leveled same-language codes (e.g. de-a2) for the draft flow only. */
  simplify_targets: string[];
  drafts: DraftSummary[];
}

/** One source token as the Groq translator would see it. */
export interface SourceToken {
  surface: string;
  lemma: string;
  pos: string;
  pivot_meaning: string;
}

/** One source sentence to translate, with its pivot-language gloss. */
export interface SourceSentence {
  position: number;
  text: string;
  pivot_translation: string;
  tokens: SourceToken[];
}

/** Result of GET /submissions/{id}/translation-source (one page). */
export interface TranslationSource {
  source_language: string;
  pivot_language: string;
  sentence_count: number;
  sentences: SourceSentence[];
  /** null when the page exhausts the submission. */
  next_from_position: number | null;
}

/** Result of POST /submissions/{id}/languages (Groq fan-out trigger). */
export interface AddLanguagesResult {
  jobs: { language: string; job_id: string }[];
  skipped: { language: string; reason: string }[];
}

/** One draft sentence in a PUT batch: whole-sentence target text (null = no
 *  sentence back) plus one meaning per source token, in order. */
export interface DraftSentence {
  position: number;
  translation: string | null;
  meanings: string[];
}

/** Result of PUT /submissions/{id}/translations/{language}. */
export interface PutTranslationsResult {
  accepted: number;
  rejected: { position: number; reason: string; expected?: number; got?: number }[];
  sentences_drafted: number;
  sentence_count: number;
}

/** Result of POST /submissions/{id}/translations/{language}/commit. */
export interface CommitDraftResult {
  job_id: string;
  language: string;
}

/** Result of GET /jobs/{id}: status of a fan-out or draft-apply job. */
export interface JobStatus {
  status: string;
  progress?: number;
  step?: string | null;
  error?: string | null;
}

/** Result of DELETE /submissions/{id}/translations/{language}. */
export interface DeleteDraftResult {
  deleted_sentences: number;
}

export type QueryValue = string | number | boolean | undefined | null;

/** How long any single request may take before we abort it. */
export const REQUEST_TIMEOUT_MS = 30_000;
/** Refuse to buffer a clip larger than this (a runaway or wrong endpoint). */
export const MAX_CLIP_BYTES = 25 * 1024 * 1024;
/** Never read more than this much of an error body into the message. */
const MAX_ERROR_BODY = 10_000;

function truncate(value: string, max = 300): string {
  return value.length > max ? `${value.slice(0, max)}...` : value;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** Coerce a FastAPI error `detail` into a single readable line.
 *
 *  Intentional errors (400/403/404/429) carry a string detail. Automatic
 *  request-validation errors (422) carry a LIST of `{loc, msg, ...}` objects;
 *  without this they would collapse to the bare status text ("Unprocessable
 *  Entity") and lose the field message that tells the agent what to fix. A
 *  detail of any other shape is stringified (truncated) rather than dropped.
 *  Returns undefined when there is nothing usable, so the caller keeps the
 *  status text. */
export function formatDetail(detail: unknown): string | undefined {
  if (typeof detail === "string") {
    return detail.trim() || undefined;
  }
  if (Array.isArray(detail)) {
    const parts = detail
      .map(formatDetailItem)
      .filter((p): p is string => p !== undefined);
    return parts.length ? parts.join("; ") : undefined;
  }
  if (detail && typeof detail === "object") {
    return truncate(safeStringify(detail));
  }
  return undefined;
}

function formatDetailItem(item: unknown): string | undefined {
  if (typeof item === "string") return item;
  if (item && typeof item === "object") {
    const rec = item as { loc?: unknown; msg?: unknown };
    if (typeof rec.msg === "string") {
      const loc = Array.isArray(rec.loc)
        ? rec.loc
            .filter((p) => typeof p === "string" || typeof p === "number")
            .join(".")
        : "";
      return loc ? `${loc}: ${rec.msg}` : rec.msg;
    }
    return truncate(safeStringify(item));
  }
  return undefined;
}

/** Thin, typed client over the public `/api/v1` surface. One instance per
 *  process, holding the configured base URL + token. */
export class LingoChunkClient {
  constructor(private readonly config: Config) {}

  private buildUrl(path: string, params?: Record<string, QueryValue>): URL {
    const url = new URL(`${this.config.baseUrl}/api/v1${path}`);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== "") {
          url.searchParams.set(key, String(value));
        }
      }
    }
    return url;
  }

  private authHeaders(accept: string): Record<string, string> {
    return {
      Authorization: `Bearer ${this.config.token}`,
      Accept: accept,
      "User-Agent": "lingochunk-mcp",
    };
  }

  private async raiseForStatus(res: Response): Promise<never> {
    let detail = res.statusText || `HTTP ${res.status}`;
    let code: string | undefined;
    // Only read a JSON error body, and only a bounded slice of it: a 5xx from a
    // proxy can be a whole HTML page, which we neither want to buffer nor dump
    // into the tool message. Non-JSON errors fall back to the status text.
    if ((res.headers.get("content-type") ?? "").includes("json")) {
      try {
        const raw = (await res.text()).slice(0, MAX_ERROR_BODY);
        const body = JSON.parse(raw) as { detail?: unknown; code?: unknown };
        const formatted = formatDetail(body?.detail);
        if (formatted) detail = formatted;
        if (typeof body?.code === "string") code = body.code;
      } catch {
        // Malformed or truncated JSON error body; keep the status text.
      }
    }
    const retryHeader = res.headers.get("retry-after");
    const retryAfter = retryHeader ? Number(retryHeader) : undefined;
    throw new ApiError(
      res.status,
      detail,
      Number.isFinite(retryAfter) ? retryAfter : undefined,
      code,
    );
  }

  /** GET a JSON endpoint. */
  private async getJson<T>(
    path: string,
    params?: Record<string, QueryValue>,
  ): Promise<T> {
    const res = await fetch(this.buildUrl(path, params), {
      method: "GET",
      headers: this.authHeaders("application/json"),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
      await this.raiseForStatus(res);
    }
    return (await res.json()) as T;
  }

  /** DELETE an endpoint; success is 204 with no body to parse. */
  private async deleteNoContent(path: string): Promise<void> {
    const res = await fetch(this.buildUrl(path), {
      method: "DELETE",
      headers: this.authHeaders("application/json"),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
      await this.raiseForStatus(res);
    }
  }

  /** POST a JSON body to an endpoint and parse the JSON response. */
  private async postJson<T>(path: string, body?: unknown): Promise<T> {
    const headers = this.authHeaders("application/json");
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const res = await fetch(this.buildUrl(path), {
      method: "POST",
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
      await this.raiseForStatus(res);
    }
    return (await res.json()) as T;
  }

  /** PUT a JSON body to an endpoint and parse the JSON response. */
  private async putJson<T>(path: string, body: unknown): Promise<T> {
    const headers = this.authHeaders("application/json");
    headers["Content-Type"] = "application/json";
    const res = await fetch(this.buildUrl(path), {
      method: "PUT",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
      await this.raiseForStatus(res);
    }
    return (await res.json()) as T;
  }

  /** DELETE an endpoint that returns a JSON body (unlike deleteNoContent). */
  private async deleteJson<T>(path: string): Promise<T> {
    const res = await fetch(this.buildUrl(path), {
      method: "DELETE",
      headers: this.authHeaders("application/json"),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
      await this.raiseForStatus(res);
    }
    return (await res.json()) as T;
  }

  // --- Read endpoints (thin pass-throughs; the tools shape the arguments) ---

  getVocabulary(params: Record<string, QueryValue>): Promise<unknown> {
    return this.getJson("/vocab", params);
  }

  lookupWord(params: Record<string, QueryValue>): Promise<unknown> {
    return this.getJson("/vocab/lookup", params);
  }

  listLibrary(params: Record<string, QueryValue>): Promise<unknown> {
    return this.getJson("/library", params);
  }

  getTranscript(
    submissionId: string,
    params: Record<string, QueryValue>,
  ): Promise<unknown> {
    return this.getJson(
      `/submissions/${encodeURIComponent(submissionId)}/transcript`,
      params,
    );
  }

  getAudioUrl(submissionId: string): Promise<unknown> {
    return this.getJson(
      `/submissions/${encodeURIComponent(submissionId)}/audio-url`,
    );
  }

  searchExamples(params: Record<string, QueryValue>): Promise<unknown> {
    return this.getJson("/sentences/search", params);
  }

  // --- Write endpoints (phase 3) ------------------------------------------

  listDecks(): Promise<unknown> {
    return this.getJson("/decks");
  }

  addCard(body: object): Promise<unknown> {
    return this.postJson("/cards", body);
  }

  createLesson(body: object): Promise<unknown> {
    return this.postJson("/lessons", body);
  }

  /** Owner-scoped server-side: a foreign or unknown id is a 404, never a leak. */
  deleteLesson(lessonId: string): Promise<void> {
    return this.deleteNoContent(`/lessons/${encodeURIComponent(lessonId)}`);
  }

  /** Start an Anki export (no body). 400 for a deck with no linked submission. */
  exportDeck(deckId: number): Promise<DeckExportStart> {
    return this.postJson(`/decks/${deckId}/export`);
  }

  exportDeckStatus(deckId: number): Promise<DeckExportStatus> {
    return this.getJson(`/decks/${deckId}/export/status`);
  }

  /** GET a clip as raw audio bytes (the endpoint streams audio, not JSON). */
  async getAudioClip(
    submissionId: string,
    start: number,
    end: number,
  ): Promise<AudioClip> {
    const res = await fetch(
      this.buildUrl(`/submissions/${encodeURIComponent(submissionId)}/clip`, {
        start,
        end,
      }),
      {
        method: "GET",
        headers: this.authHeaders("audio/*"),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
    );
    if (!res.ok) {
      await this.raiseForStatus(res);
    }
    // Guard against buffering something huge: a short clip is a few hundred KB,
    // so a Content-Length past the cap means a wrong/overlong request. Reject
    // before reading the body into memory.
    const declared = Number(res.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_CLIP_BYTES) {
      throw new Error(
        `Clip is too large (${Math.round(declared / (1024 * 1024))} MB); ` +
          "request a shorter time range.",
      );
    }
    const data = Buffer.from(await res.arrayBuffer());
    const contentType = res.headers.get("content-type") ?? "audio/mpeg";
    return { data, contentType };
  }

  // --- Language / translation endpoints (phase 4) -------------------------

  /** (a) The submission's fan-out group languages, addable targets, leveled
   *  simplify targets, and in-progress drafts. */
  listSubmissionLanguages(submissionId: string): Promise<SubmissionLanguages> {
    return this.getJson(
      `/submissions/${encodeURIComponent(submissionId)}/languages`,
    );
  }

  /** (b) A page of the primary's sentences (source text + pivot glosses) as the
   *  Groq translator would see them, for the agent to translate. */
  getTranslationSource(
    submissionId: string,
    params: Record<string, QueryValue>,
  ): Promise<TranslationSource> {
    return this.getJson(
      `/submissions/${encodeURIComponent(submissionId)}/translation-source`,
      params,
    );
  }

  /** (c) Trigger the server-side Groq fan-out into extra ordinary target
   *  languages; returns a job per accepted language plus per-code skips. */
  addLanguages(
    submissionId: string,
    languages: string[],
  ): Promise<AddLanguagesResult> {
    return this.postJson(
      `/submissions/${encodeURIComponent(submissionId)}/languages`,
      { languages },
    );
  }

  /** (d) Upsert a batch of agent-supplied draft sentences for one language. */
  putTranslations(
    submissionId: string,
    language: string,
    body: { generator?: string; sentences: DraftSentence[] },
  ): Promise<PutTranslationsResult> {
    return this.putJson(
      `/submissions/${encodeURIComponent(submissionId)}/translations/${encodeURIComponent(
        language,
      )}`,
      body,
    );
  }

  /** (e) Validate a complete draft and enqueue the apply job that mints the
   *  sibling submission. 409 when the draft misses sentence positions. */
  commitTranslationDraft(
    submissionId: string,
    language: string,
  ): Promise<CommitDraftResult> {
    return this.postJson(
      `/submissions/${encodeURIComponent(submissionId)}/translations/${encodeURIComponent(
        language,
      )}/commit`,
    );
  }

  /** (f) Owner-scoped job status, for polling a fan-out (c) or draft-apply (e)
   *  job to completion. */
  getJob(jobId: string): Promise<JobStatus> {
    return this.getJson(`/jobs/${encodeURIComponent(jobId)}`);
  }

  /** (g) Delete the draft rows for one language (never a committed sibling). */
  deleteTranslationDraft(
    submissionId: string,
    language: string,
  ): Promise<DeleteDraftResult> {
    return this.deleteJson(
      `/submissions/${encodeURIComponent(submissionId)}/translations/${encodeURIComponent(
        language,
      )}`,
    );
  }
}
