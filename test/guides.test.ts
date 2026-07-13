import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  GUIDES,
  GUIDE_TOPICS,
  type GuideTopic,
} from "../src/generated/guides.js";
import { GUIDE_SOURCES, renderModule } from "../scripts/generate-guides.js";

const TOPICS: GuideTopic[] = [
  "overview",
  "lesson",
  "course",
  "cards",
  "annotations",
  "add-language",
  "discuss",
  "skill-author",
];

describe("embedded authoring guides", () => {
  it("embeds all eight topics", () => {
    expect([...GUIDE_TOPICS].sort()).toEqual([...TOPICS].sort());
    expect(GUIDE_SOURCES.map((s) => s.topic).sort()).toEqual(
      [...TOPICS].sort(),
    );
  });

  it("each guide has non-trivial body, a prompt name and a description", () => {
    for (const topic of TOPICS) {
      const guide = GUIDES[topic];
      expect(guide.topic).toBe(topic);
      // A real skill is thousands of characters; a stub would be a red flag.
      expect(guide.body.length).toBeGreaterThan(1000);
      expect(guide.promptName).toMatch(/^lingochunk-/);
      expect(guide.description.length).toBeGreaterThan(40);
      // Frontmatter must be stripped from the body.
      expect(guide.body.startsWith("---")).toBe(false);
    }
  });

  it("the lesson guide carries its anchoring mandate", () => {
    // A content marker unique to the enriched lesson skill, so a truncated or
    // wrong-file embed would fail rather than pass silently.
    expect(GUIDES.lesson.body).toContain("Anchoring (mandatory)");
  });

  // Drift guard: the committed src/generated/guides.ts must match what the
  // generator produces from the current skills/. If a skill is edited without
  // rebuilding, this fails and tells you to run `npm run generate`.
  it("the committed generated module is up to date with skills/", () => {
    const committedPath = fileURLToPath(
      new URL("../src/generated/guides.ts", import.meta.url),
    );
    const committed = readFileSync(committedPath, "utf8");
    expect(committed).toBe(renderModule());
  });
});
