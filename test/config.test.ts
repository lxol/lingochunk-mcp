import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("fails fast with a clear message when LINGOCHUNK_TOKEN is unset", () => {
    expect(() => loadConfig({})).toThrowError(/LINGOCHUNK_TOKEN is required/);
  });

  it("fails fast when the token is blank", () => {
    expect(() => loadConfig({ LINGOCHUNK_TOKEN: "   " })).toThrowError(
      /LINGOCHUNK_TOKEN/,
    );
  });

  it("uses production defaults", () => {
    const config = loadConfig({ LINGOCHUNK_TOKEN: "lcp_x" });
    expect(config.token).toBe("lcp_x");
    expect(config.baseUrl).toBe("https://lingochunk.com");
    expect(config.clipDir).toBe(path.join(os.tmpdir(), "lingochunk-mcp"));
  });

  it("honours overrides and strips a trailing slash from the base URL", () => {
    const config = loadConfig({
      LINGOCHUNK_TOKEN: "lcp_x",
      LINGOCHUNK_BASE_URL: "http://localhost:8000/",
      LINGOCHUNK_CLIP_DIR: "/tmp/clips",
    });
    expect(config.baseUrl).toBe("http://localhost:8000");
    expect(config.clipDir).toBe("/tmp/clips");
  });
});
