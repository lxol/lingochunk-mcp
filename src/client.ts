import type { Config } from "./config.js";

/** An error returned by the LingoChunk API (non-2xx), carrying the HTTP status
 *  and the API's `detail` message so tools can surface something actionable. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string,
    readonly retryAfter?: number,
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

export type QueryValue = string | number | boolean | undefined | null;

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
    let detail = res.statusText;
    try {
      const body = (await res.json()) as { detail?: unknown };
      if (body && typeof body.detail === "string") {
        detail = body.detail;
      }
    } catch {
      // Non-JSON error body; keep the status text.
    }
    const retryHeader = res.headers.get("retry-after");
    const retryAfter = retryHeader ? Number(retryHeader) : undefined;
    throw new ApiError(
      res.status,
      detail,
      Number.isFinite(retryAfter) ? retryAfter : undefined,
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
      { method: "GET", headers: this.authHeaders("audio/*") },
    );
    if (!res.ok) {
      await this.raiseForStatus(res);
    }
    const data = Buffer.from(await res.arrayBuffer());
    const contentType = res.headers.get("content-type") ?? "audio/mpeg";
    return { data, contentType };
  }
}
