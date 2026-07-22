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

/** One translatable meta-language string of a lesson document or guided plan
 *  (the master + editions surface). */
export interface TranslationUnit {
  /** Dotted path addressing this string in the source revision. */
  path: string;
  text: string;
  /** 'render' (translate faithfully) or 'adapt' (localise the contrast). */
  kind: string;
  /** Character cap the translated text must respect. */
  max_length: number | null;
  /** True when the text may already be target-language and must then be
   *  returned unchanged (MCQ prompt/options). */
  passthrough_if_target: boolean;
  /** Owning model and field, e.g. 'DialogueLine.literal'. */
  context: string;
}

/** One translated unit sent back: path + your text. */
export interface TranslationUnitPut {
  path: string;
  text: string;
}

/** Result of GET /lessons/{id}/translation-source. */
export interface LessonTranslationSource {
  lesson_id: string;
  language: string;
  translation_language: string;
  target_language: string;
  level: string | null;
  /** Echo verbatim as the PUT's base_version. */
  version: string;
  sibling_exists: boolean;
  sibling_submission_id: string | null;
  sibling_status: string | null;
  existing_edition_id: string | null;
  existing_edition_edited: boolean;
  units: TranslationUnit[];
}

/** Result of PUT /lessons/{id}/translations/{language}. */
export interface LessonTranslationResult {
  lesson_id: string;
  submission_id: string;
  language: string;
  replaced: boolean;
  unknown_lemmas: string[];
}

/** One plan section's translation state. `index` is the plan-index FIELD
 *  (what the section PUT takes); `unit_path_prefix` is the ARRAY position
 *  the plan units use - pair units with sections by the prefix, never by
 *  index. */
export interface GuidedTranslationSection {
  index: number;
  unit_path_prefix: string;
  skip: boolean;
  title: string;
  master_lesson_id: string | null;
  sibling_lesson_id: string | null;
}

/** Result of GET /submissions/{id}/guided/translation-source. */
export interface GuidedTranslationSource {
  language: string;
  translation_language: string;
  target_language: string;
  sibling_exists: boolean;
  sibling_submission_id: string | null;
  sibling_status: string | null;
  sibling_plan_exists: boolean;
  /** Echo verbatim as the plan PUT's base_version. */
  plan_version: string;
  plan_units: TranslationUnit[];
  sections: GuidedTranslationSection[];
}

/** Result of PUT /submissions/{id}/guided/translations/{language}. */
export interface GuidedPlanTranslationResult {
  language: string;
  sibling_submission_id: string;
  section_count: number;
}

/** Result of PUT /submissions/{id}/guided/sections/{i}/translations/{lang}. */
export interface GuidedSectionTranslationResult {
  lesson_id: string;
  section_index: number;
  language: string;
  unknown_lemmas: string[];
}

/** Self-declared translator provenance. */
export interface TranslatorGenerator {
  skill?: string;
  version?: string;
}

/** One creator annotation: a markdown note anchored to a transcript sentence,
 *  tinted onto a char span or the whole sentence. */
export interface AnnotationV1 {
  id: number;
  /** The sentence's stable id (survives split/merge), from get_transcript. */
  sentence_id: number;
  /** null (with char_end) for a whole-sentence note; else a code-point offset. */
  char_start: number | null;
  char_end: number | null;
  /** Server snapshot of display[char_start:char_end]; verify it after create. */
  selected_text: string | null;
  note: string;
  /** The sentence was edited since; the app hides the tint until re-anchored. */
  stale: boolean;
  start_time: number | null;
  end_time: number | null;
}

/** Result of GET /submissions/{id}/annotations. */
export interface AnnotationList {
  /** Ordered by sentence, then char_start. */
  annotations: AnnotationV1[];
  count: number;
  /** The per-submission cap, so an agent can budget how many more to add. */
  max_annotations: number;
}

/** Body of POST /submissions/{id}/annotations. char_start/char_end are
 *  both-or-neither (neither = a whole-sentence note); offsets are Unicode
 *  code points into the sentence's display. */
export interface CreateAnnotationBody {
  sentence_id: number;
  char_start?: number | null;
  char_end?: number | null;
  note: string;
  start_time?: number | null;
  end_time?: number | null;
}

/** Result of DELETE /submissions/{id}/annotations/{annotation_id}. */
export interface DeleteAnnotationResult {
  deleted: boolean;
  annotation_id: number;
}

/** Result of POST /submissions/{id}/guided/plan: the enqueued planner job id,
 *  to poll to completion via getJob. */
export interface GuidedPlanResult {
  job_id: string;
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
    // A structured guided/conflict detail is a `{code, message}` object (the
    // guided W3 convention): surface its human message, not the raw JSON, so
    // errorResult does not print the braces. Any other object is stringified.
    const message = (detail as { message?: unknown }).message;
    const header = typeof message === "string" ? message.trim() : "";
    // An invalid_document detail (submit_guided_lesson's 422) also carries an
    // `errors` list of EVERY problem at once (the validate_lesson philosophy).
    // Surface each on its own line so the agent can fix them all in one pass,
    // never as a single "[object Object]".
    const errors = (detail as { errors?: unknown }).errors;
    if (Array.isArray(errors) && errors.length) {
      const lines = errors
        .map(formatDocumentError)
        .filter((l): l is string => l !== undefined)
        .map((l) => `- ${l}`);
      if (lines.length) {
        // unknown_lemmas rides the 422 too and is ADVISORY - surface it so the
        // agent never mistakes the list for a failure it must fix.
        const lemmas = (detail as { unknown_lemmas?: unknown }).unknown_lemmas;
        if (Array.isArray(lemmas) && lemmas.length) {
          lines.push(
            `(advisory, not an error: unknown lemmas ${lemmas
              .filter((l): l is string => typeof l === "string")
              .join(", ")} - these just lose their Words-tab crosslink)`,
          );
        }
        return [header || "The document is invalid.", ...lines].join("\n");
      }
    }
    if (header) return header;
    return truncate(safeStringify(detail));
  }
  return undefined;
}

/** The stable `code` of a structured object detail (`{code, message}`, the
 *  guided/conflict convention), when present - so a caller can branch on it
 *  even though it rides inside `detail` rather than at the top level. Returns
 *  undefined for a string detail (404/403) or the 422 validation list. */
function objectDetailCode(detail: unknown): string | undefined {
  if (detail && typeof detail === "object" && !Array.isArray(detail)) {
    const code = (detail as { code?: unknown }).code;
    if (typeof code === "string") return code;
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

/** Render one invalid_document error into a readable line. Unlike a FastAPI
 *  validation item (formatDetailItem) it keys on `message`, not `msg`, and
 *  carries the reference-fault locators the lesson validator raises: a dotted
 *  `loc` path for a schema fault, or `positions` / `audio_windows` for a
 *  quote/range fault. Keeps the stable `code` up front so the agent can act on
 *  it. */
function formatDocumentError(item: unknown): string | undefined {
  if (typeof item === "string") return item;
  if (!item || typeof item !== "object") return undefined;
  const rec = item as {
    code?: unknown;
    message?: unknown;
    loc?: unknown;
    positions?: unknown;
    audio_windows?: unknown;
  };
  const code = typeof rec.code === "string" ? rec.code : undefined;
  const message = typeof rec.message === "string" ? rec.message : undefined;
  const locators: string[] = [];
  // The server emits loc as a dotted STRING (api model: loc: str|null); the
  // array branch is kept for forward tolerance of FastAPI-style locs.
  if (typeof rec.loc === "string" && rec.loc) {
    locators.push(rec.loc);
  } else if (Array.isArray(rec.loc)) {
    const loc = rec.loc
      .filter((p) => typeof p === "string" || typeof p === "number")
      .join(".");
    if (loc) locators.push(loc);
  }
  if (Array.isArray(rec.positions) && rec.positions.length) {
    locators.push(`positions ${rec.positions.join(", ")}`);
  }
  if (Array.isArray(rec.audio_windows) && rec.audio_windows.length) {
    locators.push(
      `audio ${rec.audio_windows.map((w) => safeStringify(w)).join(", ")}`,
    );
  }
  const head = [code, message].filter(Boolean).join(": ");
  const body = head || truncate(safeStringify(item));
  return locators.length ? `${body} (${locators.join("; ")})` : body;
}

/** The extra lines of a translation unit-mismatch 400 body
 *  (TranslationUnitsErrorV1: problems / missing_paths / unknown_paths ride
 *  beside `detail`, whose summary truncates at five entries). */
function formatUnitErrorBody(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const rec = body as {
    problems?: unknown;
    missing_paths?: unknown;
    unknown_paths?: unknown;
  };
  const lines: string[] = [];
  if (Array.isArray(rec.problems)) {
    for (const item of rec.problems) {
      if (item && typeof item === "object") {
        const p = item as { path?: unknown; code?: unknown; message?: unknown };
        if (typeof p.path === "string" && typeof p.code === "string") {
          lines.push(`- ${p.path}: ${p.code} (${String(p.message ?? "")})`);
        }
      }
    }
  }
  const paths = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
  const missing = paths(rec.missing_paths);
  if (missing.length) lines.push(`- missing units: ${missing.join(", ")}`);
  const unknown = paths(rec.unknown_paths);
  if (unknown.length) lines.push(`- unknown units: ${unknown.join(", ")}`);
  return lines.length ? lines.join("\n") : undefined;
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
        // Unit-mismatch 400s (translation editions) carry their full
        // repair-in-one-pass payload BESIDE detail: per-unit problems and the
        // exact missing/unknown paths. Append them so the agent never has to
        // work from the truncated summary line alone.
        const unitLines = formatUnitErrorBody(body);
        if (unitLines) detail = `${detail}\n${unitLines}`;
        // A top-level `code` wins; otherwise a structured detail may carry it
        // (guided conflicts put {code, message} in `detail`, not at the top).
        if (typeof body?.code === "string") code = body.code;
        else code = objectDetailCode(body?.detail);
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

  /** GET a JSON endpoint, also capturing one response header (e.g. the
   *  lesson optimistic-concurrency token in X-Lesson-Version). */
  private async getJsonWithHeader<T>(
    path: string,
    header: string,
  ): Promise<{ data: T; header: string | null }> {
    const res = await fetch(this.buildUrl(path), {
      method: "GET",
      headers: this.authHeaders("application/json"),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
      await this.raiseForStatus(res);
    }
    return { data: (await res.json()) as T, header: res.headers.get(header) };
  }

  /** PUT a JSON body, also capturing one response header. */
  private async putJsonWithHeader<T>(
    path: string,
    body: unknown,
    header: string,
  ): Promise<{ data: T; header: string | null }> {
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
    return { data: (await res.json()) as T, header: res.headers.get(header) };
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

  /** PATCH a JSON body to an endpoint and parse the JSON response. */
  private async patchJson<T>(path: string, body: unknown): Promise<T> {
    const headers = this.authHeaders("application/json");
    headers["Content-Type"] = "application/json";
    const res = await fetch(this.buildUrl(path), {
      method: "PATCH",
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

  /** Dry-run validate a lesson.v1 document without saving it: reports every
   *  failing category at once (schema + reference), so a document can be fixed
   *  in one pass instead of save -> 400 -> fix cycles. Stores nothing. */
  validateLesson(body: object): Promise<unknown> {
    return this.postJson("/lessons/validate", body);
  }

  listLessons(params: Record<string, QueryValue>): Promise<unknown> {
    return this.getJson("/lessons", params);
  }

  /** Create a course: a named, ordered series to file lessons under. */
  createCourse(body: object): Promise<unknown> {
    return this.postJson("/courses", body);
  }

  /** The caller's courses, newest first, each with its lesson_count. */
  listCourses(): Promise<unknown> {
    return this.getJson("/courses");
  }

  /** Delete a course (owner-scoped). Its lessons survive - the DB sets their
   *  course_id NULL, un-grouping them. 404 for a foreign or unknown id. */
  deleteCourse(courseId: string): Promise<void> {
    return this.deleteNoContent(`/courses/${encodeURIComponent(courseId)}`);
  }

  /** The stored lesson.v1 document plus its optimistic-concurrency token
   *  (the X-Lesson-Version response header; a caller echoes it verbatim as
   *  an update's base_version). Owner-scoped server-side; 404 for HTML
   *  lessons (they have no document) and for foreign/unknown ids. */
  async getLessonDocument(
    lessonId: string,
  ): Promise<{ version: string | null; document: unknown }> {
    const { data, header } = await this.getJsonWithHeader(
      `/lessons/${encodeURIComponent(lessonId)}/document`,
      "x-lesson-version",
    );
    return { version: header, document: data };
  }

  /** Replace a lesson.v1 document in place (owner-scoped; same id, same
   *  app_url). base_version is the X-Lesson-Version token the edit is based
   *  on - if the lesson changed since, the server answers 409 stale_document
   *  instead of overwriting the other writer. Returns the refreshed lesson
   *  metadata plus the NEW token for chained edits. */
  async updateLesson(
    lessonId: string,
    document: unknown,
    baseVersion: string,
  ): Promise<{ version: string | null; lesson: unknown }> {
    const { data, header } = await this.putJsonWithHeader(
      `/lessons/${encodeURIComponent(lessonId)}/document`,
      { document, base_version: baseVersion },
      "x-lesson-version",
    );
    return { version: header, lesson: data };
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

  /** Units + sibling/edition state for translating one lesson (the master +
   *  editions surface). `version` must be echoed as the PUT's base_version. */
  getLessonTranslationSource(
    lessonId: string,
    language: string,
  ): Promise<LessonTranslationSource> {
    return this.getJson(
      `/lessons/${encodeURIComponent(lessonId)}/translation-source`,
      { language },
    );
  }

  /** Create (or machine-replace) the lesson's edition on the sibling. */
  putLessonTranslation(
    lessonId: string,
    language: string,
    body: {
      base_version: string;
      generator?: TranslatorGenerator;
      units: TranslationUnitPut[];
    },
  ): Promise<LessonTranslationResult> {
    return this.putJson(
      `/lessons/${encodeURIComponent(lessonId)}/translations/${encodeURIComponent(
        language,
      )}`,
      body,
    );
  }

  /** Plan units + per-section state for translating a guided path. */
  getGuidedTranslationSource(
    submissionId: string,
    language: string,
  ): Promise<GuidedTranslationSource> {
    return this.getJson(
      `/submissions/${encodeURIComponent(submissionId)}/guided/translation-source`,
      { language },
    );
  }

  /** Mint the sibling's guided plan from the master's (translated meta). */
  putGuidedPlanTranslation(
    submissionId: string,
    language: string,
    body: { base_version: string; units: TranslationUnitPut[] },
  ): Promise<GuidedPlanTranslationResult> {
    return this.putJson(
      `/submissions/${encodeURIComponent(submissionId)}/guided/translations/${encodeURIComponent(
        language,
      )}`,
      body,
    );
  }

  /** Attach the translated edition of one master part to the sibling plan. */
  putGuidedSectionTranslation(
    submissionId: string,
    index: number,
    language: string,
    body: {
      base_version: string;
      generator?: TranslatorGenerator;
      units: TranslationUnitPut[];
    },
  ): Promise<GuidedSectionTranslationResult> {
    return this.putJson(
      `/submissions/${encodeURIComponent(submissionId)}/guided/sections/${index}/translations/${encodeURIComponent(
        language,
      )}`,
      body,
    );
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

  // --- Creator annotation endpoints (phase 5) -----------------------------

  /** List a submission's creator annotations (ordered), with the per-submission
   *  cap so an agent can budget how many more to add. */
  listAnnotations(submissionId: string): Promise<AnnotationList> {
    return this.getJson(
      `/submissions/${encodeURIComponent(submissionId)}/annotations`,
    );
  }

  /** Create one annotation on a sentence span (or the whole sentence). The
   *  response echoes the server's selected_text snapshot so the caller can
   *  verify the span it anchored. */
  createAnnotation(
    submissionId: string,
    body: CreateAnnotationBody,
  ): Promise<AnnotationV1> {
    return this.postJson(
      `/submissions/${encodeURIComponent(submissionId)}/annotations`,
      body,
    );
  }

  /** Replace one annotation's markdown note (anchor unchanged; staleness is
   *  recomputed against the current sentence). */
  updateAnnotation(
    submissionId: string,
    annotationId: number,
    note: string,
  ): Promise<AnnotationV1> {
    return this.patchJson(
      `/submissions/${encodeURIComponent(submissionId)}/annotations/${annotationId}`,
      { note },
    );
  }

  /** Delete one annotation. Returns {deleted, annotation_id}. */
  deleteAnnotation(
    submissionId: string,
    annotationId: number,
  ): Promise<DeleteAnnotationResult> {
    return this.deleteJson(
      `/submissions/${encodeURIComponent(submissionId)}/annotations/${annotationId}`,
    );
  }

  // --- Guided path endpoints (phase G1) -----------------------------------

  /** Trigger the server-side guided-path planner for a submission (Gemini
   *  spend, inside the daily guided budget); returns the enqueued job id to
   *  poll via getJob. Guided conflicts arrive as a `{code, message}` detail:
   *  409 plan_ready / plan_in_progress, 422 submission_too_long, 429
   *  guided_daily_limit (with Retry-After), 503 enqueue_failed. */
  planGuidedPath(submissionId: string): Promise<GuidedPlanResult> {
    return this.postJson(
      `/submissions/${encodeURIComponent(submissionId)}/guided/plan`,
    );
  }

  /** The submission's guided path: its ordered sections (bounds, focus, the
   *  attached lesson and completion), plan status, and any in-flight
   *  generation. */
  getGuidedPath(submissionId: string): Promise<unknown> {
    return this.getJson(
      `/submissions/${encodeURIComponent(submissionId)}/guided`,
    );
  }

  // --- Guided writer endpoints (phase G2) ---------------------------------

  /** The writer brief for the NEXT unwritten guided section: the assembled
   *  pack instructions, the lesson.v1 contract reference and the section's
   *  materials (source sentences, plan entry, level, known lemmas). Read-only
   *  and claims nothing. Guided conflicts arrive as a `{code, message}` detail:
   *  409 plan_not_ready / path_complete / section_has_no_sentences. Requires
   *  the guided:write scope (the brief carries the pack). */
  getGuidedWriterBrief(submissionId: string): Promise<unknown> {
    return this.getJson(
      `/submissions/${encodeURIComponent(submissionId)}/guided/brief`,
    );
  }

  /** Submit a composed lesson.v1 document into one guided section; the server
   *  re-validates it against the section bounds and atomically attaches it.
   *  `generator` names the writing skill, for provenance. 201 returns the
   *  lesson summary + app_url + unknown_lemmas. Conflicts arrive as a
   *  `{code, message}` detail: 409 section_not_next / generation_in_flight /
   *  section_taken / plan_not_ready / section_has_no_sentences, 413
   *  document_too_large, 422 invalid_document (with an `errors` list of every
   *  problem), 429 guided_daily_limit (with Retry-After). Requires the
   *  guided:write scope. */
  submitGuidedLesson(
    submissionId: string,
    sectionIndex: number,
    body: {
      document: unknown;
      generator?: { skill?: string; version?: string };
    },
  ): Promise<unknown> {
    return this.postJson(
      `/submissions/${encodeURIComponent(submissionId)}/guided/sections/${sectionIndex}/lesson`,
      body,
    );
  }
}
