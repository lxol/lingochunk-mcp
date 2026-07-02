# LingoChunk MCP

A [Model Context Protocol](https://modelcontextprotocol.io) server (and Claude
Code plugin) that turns a coding agent into a language tutor grounded in **your
own LingoChunk listening history**: your FSRS-graded vocabulary, native-audio
transcripts and clips, and your library.

It is a thin, read-only client over the LingoChunk public API (`/api/v1`). The
app stays closed source; this repo is just the client, the committed API spec,
and two lesson skills.

> Status: local/preview. Not yet published to npm and not yet a public repo.

## What it gives an agent

Seven tools, each wrapping one public endpoint:

| Tool | Scope | What it does |
|---|---|---|
| `get_vocabulary` | `vocab:read` | Your vocabulary, aggregated per word with FSRS maturity (known/learning/new/due). Filterable; incremental sync via `since` + `cursor` (additive-only, so full-resync periodically). |
| `lookup_word` | `vocab:read` | One word: your own context plus a shared-lexicon gender/CEFR fallback. Grounds an LLM's guesses. |
| `list_library` | `content:read` | Your ready-to-study episodes (own + followed collections), cursor-paginated. |
| `get_transcript` | `content:read` | A submission's timestamped sentences + translations, sliceable by sentence or time range. |
| `get_audio_url` | `content:read` | A short-lived presigned URL to the full native audio (Range-capable). |
| `search_examples` | `content:read` | Example sentences across your library, by word (`lemma`) or text (`q`). A capped sample, not exhaustive. |
| `get_audio_clip` | `content:read` | Cuts a short native-audio snippet, **saves it to a local file**, and returns `{path, media_type, size_bytes}` for embedding in lessons. |

Plus two skills:

- **`lingochunk-lesson`** - builds a single self-contained HTML lesson (data-URI
  audio; gap-fill, multiple-choice, listening and blur-reveal exercises) from the
  tools above, filtering out words you already know.
- **`lingochunk-discuss`** - a lighter, conversational "talk me through this
  episode" workflow.

## Prerequisites

- Node.js >= 18.
- A LingoChunk **personal access token**: in LingoChunk, open Settings -> API
  access, create a token, and grant the scopes you need (`vocab:read` and
  `content:read` cover everything here). The token is shown once and starts with
  `lcp_`. The 403 errors from the tools name the exact scope you are missing.

## Use it

### Option A - Claude Code plugin (bundles the server + the skills)

Build once, then point Claude Code at this directory as a plugin. The bundled
`.mcp.json` runs the server from `dist/` via `${CLAUDE_PLUGIN_ROOT}`, and the
`skills/` are auto-discovered.

```bash
npm install     # installs deps and builds dist/ (via the prepare script)
export LINGOCHUNK_TOKEN=lcp_your_token_here
```

Then add the plugin from its local path in Claude Code (plugin install from a
local directory), or copy the MCP block from `.mcp.json` into your Claude Code
MCP config, replacing `${CLAUDE_PLUGIN_ROOT}` with the absolute path to this repo.

### Option B - standalone MCP server

Once published to npm this will be a one-liner:

```bash
claude mcp add lingochunk --env LINGOCHUNK_TOKEN=lcp_... -- npx -y @lingochunk/mcp
```

Until then, build locally and run it directly:

```bash
npm install
claude mcp add lingochunk --env LINGOCHUNK_TOKEN=lcp_... -- node /absolute/path/to/lingochunk-mcp/dist/index.js
```

## Configuration

| Variable | Required | Default | Meaning |
|---|---|---|---|
| `LINGOCHUNK_TOKEN` | yes | - | Your personal access token (`lcp_...`). |
| `LINGOCHUNK_BASE_URL` | no | `https://lingochunk.com` | API origin override (for self-host/testing). |
| `LINGOCHUNK_CLIP_DIR` | no | OS temp dir `/lingochunk-mcp` | Where `get_audio_clip` writes clip files. |

The token is only ever sent as an `Authorization: Bearer` header to the
configured origin; it is never written to disk or logged.

## Building a lesson

Ask your agent something like "build me a lesson from yesterday's German episode"
or "quiz me on the words I'm learning". The `lingochunk-lesson` skill drives the
workflow: pick the source, pull a transcript slice, gather and **filter** your
vocabulary (never quizzing you on mastered words), fetch short audio clips, and
render one shareable HTML file. See `skills/lingochunk-lesson/`.

## Repository layout

```
src/                                    the MCP server (TypeScript, stdio)
skills/lingochunk-lesson/               the lesson skill
skills/lingochunk-lesson/assets/lesson-template.html   self-contained HTML template
skills/lingochunk-discuss/              the "discuss an episode" skill
docs/integrations/fluent.md             how to plug this into the fluent tutor plugin
spec/openapi-public-v1.json             the committed public API spec (the contract)
scripts/smoke.ts                        live smoke test (run by hand, never in CI)
test/                                   vitest unit tests (mocked fetch)
.claude-plugin/plugin.json              Claude Code plugin manifest
.mcp.json                               MCP server definition for the plugin
```

## Development

```bash
npm install        # deps + build (prepare)
npm run build      # compile src/ -> dist/
npm run typecheck  # type-check without emitting
npm test           # vitest unit tests (mocked fetch; no network)
```

`spec/openapi-public-v1.json` is the source contract; it is exported from the
LingoChunk repo (`make generate-openapi-public`) and refreshed here on each API
release. This copy was taken from LingoChunk commit `d9f466df`.

### Live smoke test

`scripts/smoke.ts` exercises a **real** API and is not part of `npm test`. Build
first, then run it by hand with a real token:

```bash
npm run build
LINGOCHUNK_TOKEN=lcp_... [LINGOCHUNK_BASE_URL=http://localhost:8000] \
  node --experimental-strip-types scripts/smoke.ts
```

## License

MIT.
