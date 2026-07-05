# Contributing

The most valuable contribution to this repo is a **new skill**: a markdown
playbook that turns the MCP tools into a new kind of lesson. Server code
fixes and doc improvements are welcome too, but skills are where the
interesting work is - a good skill is pure pedagogy, needs no TypeScript,
and every LingoChunk user who installs the plugin gets it.

## The shape of the system

The LingoChunk app is closed source; this repo is the open half. The public
API (`spec/openapi-public-v1.json`) is the boundary between them:

- **The app** supplies the materials (timestamped transcripts, FSRS-graded
  vocabulary, native audio), validates every saved document, and renders
  lessons natively with real audio, live word state and an AI tutor.
- **A skill** supplies the pedagogy. It runs on the user's own LLM tokens
  and the user's own API token; nothing a skill does costs the server LLM
  spend or trust.

A submission (episode) can hold **many lessons**: every `save_lesson` creates
a new one, and the app's Lessons tab lists them all. Different skills add
different lessons to the same episode side by side.

Anything the API and the `lesson.v1` schema can express is fair game for a
skill. Anything that needs a new block type, field or endpoint is an app
feature request: open an issue instead of a PR (see "What a skill cannot do"
in [docs/skill-authoring.md](docs/skill-authoring.md)).

## Dev setup

```bash
npm install        # deps + build (prepare)
npm test           # vitest: unit tests + validates every skill example
npm run typecheck  # type-check the server source
```

Node 18+ runs the server and tests. The convenience CLIs
(`npm run validate:lesson`, `npm run smoke`) use `--experimental-strip-types`
and need Node 22.6+.

## Contributing a skill

1. **Copy the template.** Create `skills/lingochunk-<yourname>/SKILL.md` from
   [docs/skill-template.md](docs/skill-template.md). The directory name and
   the frontmatter `name` must match.
2. **Read the authoring guide.** [docs/skill-authoring.md](docs/skill-authoring.md)
   covers the tool workflow, the `lesson.v1` block vocabulary, the server's
   validation errors and the hard rules every skill must follow.
3. **Ship an example document.** If your skill saves lessons, add at least one
   representative output at `skills/<yourname>/examples/<name>.lesson.json`.
   CI validates every example against the committed spec:

   ```bash
   npm run validate:lesson -- skills/<yourname>/examples/<name>.lesson.json
   npm test
   ```

   A fictional `source.submission_id` is fine - examples document your
   skill's output shape, they are not saveable as-is (the server checks
   positions and quotes against a real submission).
4. **Test it live** against your own LingoChunk account. The checklist is in
   the authoring guide; the short version: install the plugin from your
   checkout, ask the agent for your lesson type, fix whatever the server's
   400s tell you, then open the returned `app_url` and work through the
   lesson in the app.
5. **Open the PR.** Include: what the skill teaches and how it differs from
   the existing skills, plus the `app_url` of a lesson it produced for you
   (or a screenshot) as evidence of a live run.

### Writing a skill with an AI

Encouraged - the skills in this repo were built that way. A recipe that
works:

1. Give your agent `docs/skill-authoring.md` and one existing skill
   (`skills/lingochunk-lesson/SKILL.md`) as context.
2. Describe the pedagogy you want ("a dictation-first lesson", "an exam-prep
   drill for B2", "a review session built only from my due words").
3. Have it draft the `SKILL.md` and an example document, then run
   `npm run validate:lesson` on the example and iterate until it passes.
4. Run the skill live on your own account and feed the server's error codes
   back to the agent until the lesson saves and plays well.

## What gets a skill PR merged

- **Grounded.** The skill quotes transcripts by position, takes meanings
  from `lookup_word`/`get_vocabulary`, and never invents content or grades.
- **Safe.** It never directs the agent to any service other than the
  configured LingoChunk API, never exfiltrates the user's data, and only
  uses the write tools its job needs.
- **Distinct.** It does one pedagogical job well and says clearly when to
  use it (the frontmatter `description` is what the agent matches on).
- **Proven.** The example document validates in CI and the PR shows evidence
  of a live run.

## Server code changes

`src/` is a thin client over the public API: one tool per endpoint, no local
state, the token only ever sent to the configured origin. Keep it that way.
`spec/openapi-public-v1.json` is exported from the LingoChunk repo and
refreshed here on each API release - do not hand-edit it; if the API is
missing something, open an issue.

## Releases (maintainer-only)

Two artefacts ship from this repo, versioned separately, and **an unbumped
version is an invisible release** - the change sits in git while every
installed copy reports "up to date":

- **The npm package `@lingochunk/mcp`** (the MCP server, `dist/`). Version in
  `package.json`; the server reports it via `--version` and in the MCP
  handshake (read from `package.json` at runtime - never hardcode a copy).
  Bump + `npm publish` whenever `src/` changes behaviour.
- **The Claude Code plugin `lingochunk`** (skills + `.mcp.json` + manifest).
  Version in `.claude-plugin/plugin.json`. Bump it on ANY user-visible
  change: a skill edit, a new skill, a `.mcp.json` change - this is the
  number update checks compare, so skill-only changes still need it.

`.mcp.json` pins the exact server version (`@lingochunk/mcp@X.Y.Z`) so a
plugin update also updates the server (npx would otherwise serve its cache
forever). Release order therefore matters:

1. Bump `package.json`, `plugin.json` and the `.mcp.json` pin together.
2. `npm publish` (maintainer 2FA) - the pin must be fetchable BEFORE users
   can see it.
3. Only then push to GitHub (pushing first would hand plugin users a pin
   that npx cannot resolve, and their server would fail to start).

Keep the versions in lockstep when both artefacts change. Docs-only changes
(README, CONTRIBUTING, docs/) need no bump.
