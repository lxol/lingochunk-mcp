# LingoChunk MCP

A [Model Context Protocol](https://modelcontextprotocol.io) server (and Claude
Code plugin) that turns a coding agent into a language tutor grounded in **your
own LingoChunk listening history**: your FSRS-graded vocabulary, native-audio
transcripts and clips, and your library.

It is a thin client over the LingoChunk public API (`/api/v1`): read-only tools
for your vocabulary, transcripts and audio, plus write tools to add review cards,
export Anki decks and save lessons. The app stays closed source; this repo is
the client, the committed API spec, and the skills - and the skills are open to
contributions (see [CONTRIBUTING.md](CONTRIBUTING.md)).

> Install: `/plugin marketplace add lingochunk/lingochunk-mcp` in Claude Code (server
> plus lesson skills), or `npx -y @lingochunk/mcp` as a standalone MCP server.

## What it gives an agent

Twenty-two tools, each wrapping one public endpoint. Ten read from your account;
twelve write to it.

| Tool | Scope | What it does |
|---|---|---|
| `get_vocabulary` | `vocab:read` | Your vocabulary, aggregated per word with FSRS maturity (known/learning/new/due). Filterable; incremental sync via `since` + `cursor` (additive-only, so full-resync periodically). |
| `lookup_word` | `vocab:read` | One word: your own context plus a shared-lexicon gender/CEFR fallback. Grounds an LLM's guesses. |
| `list_library` | `content:read` | Your ready-to-study episodes (own + followed collections), cursor-paginated. |
| `get_transcript` | `content:read` | A submission's timestamped sentences + translations, sliceable by sentence or time range. |
| `get_audio_url` | `content:read` | A short-lived presigned URL to the full native audio (Range-capable). |
| `search_examples` | `content:read` | Example sentences across your library, by word (`lemma`) or text (`q`). A capped sample, not exhaustive. |
| `get_audio_clip` | `content:read` | Cuts a short native-audio snippet, **saves it to a local file**, and returns `{path, media_type, size_bytes}` for embedding in lessons. |
| `list_decks` | `cards:write` or `decks:export` | Your study decks with card counts, for picking a `deck_id` to add to or export. |
| `add_card` | `cards:write` | Adds a card to your review queue (FSRS, starts new). Preferred: the `card.v1` kinds (`word`, `phrase`, `collocation`, `idiom`, `chunk`, `grammar`, `cloze`, `contrast`, `qa`, `production`) anchored to a verbatim transcript sentence - the server derives the highlight/blur painting and native-audio clip, so the card matches the app's own. Legacy: `kind=vocab` from your vocabulary, or `kind=custom` front/back. Omit `deck_id` to use the deck for the card's own submission. |
| `export_anki_deck` | `decks:export` | Exports a deck to Anki `.apkg` (no LLM), polling internally; returns a download URL when ready. A deck with no linked episode can't be exported. |
| `save_lesson` | `lessons:write` | Saves a lesson to your private library (100 max). Preferred: a structured `lesson.v1` document the app renders natively (Lessons tab on the episode, real audio, live word state, Ask AI); returns metadata + an `app_url`. Legacy: a self-contained HTML file (10 MB cap) opened via a short-lived view URL. |
| `delete_lesson` | `lessons:write` | Permanently deletes one saved lesson by id (destructive; owner-scoped server-side). Mainly for iterating: re-saving creates a new lesson, so superseded drafts count against the 100-lesson cap. |
| `list_languages` | `content:read` | An episode's target languages and how to add more: the fan-out group so far (each with its own submission id + status), `available_targets` (ordinary Groq targets), `simplify_targets` (leveled same-language codes like `de-a2`) and in-progress drafts. |
| `get_translation_source` | `content:read` | Pages the primary's sentences to translate yourself: source text, the pivot-language gloss per sentence and per token (which fixes each word's sense). Feeds the draft flow. |
| `add_language` | `translations:write` | Fans an episode out into 1-10 extra **ordinary** target languages server-side (Groq, no tokens of yours); returns a job per language. Leveled same-language codes are rejected here - use the draft flow. |
| `put_language_translations` | `translations:write` | Uploads a batch (1-100) of agent-written draft sentences (whole-sentence translation + one meaning per token) for a target or leveled language; returns per-sentence rejections to repair. |
| `commit_language` | `translations:write` | Validates a complete draft and applies it, minting the sibling deck; polls the job and returns the new submission id when ready. |
| `discard_language_draft` | `translations:write` | Deletes the in-progress draft rows for a language (destructive; never a committed sibling). |
| `list_annotations` | `content:read` | An episode's creator annotations (each a markdown note on a transcript sentence span), plus `count` and `max_annotations` so you can budget and avoid duplicates. |
| `create_annotation` | `annotations:write` | Attaches a markdown creator note to a sentence span (Unicode code-point offsets into the sentence's `display`, or a whole-sentence note); the response echoes `selected_text` to verify the span. |
| `update_annotation` | `annotations:write` | Replaces one annotation's note in place (the anchor stays put). |
| `delete_annotation` | `annotations:write` | Deletes one annotation (destructive); also how you fix a mis-anchored span before re-creating it. |

Plus five skills:

- **`lingochunk-lesson`** - composes a coursebook-style `lesson.v1` document
  (listen, text, vocabulary, one grammar point, graded exercises, review)
  from the tools above, filtering out words you already know; the app
  renders it natively and can export an offline HTML worksheet.
- **`lingochunk-cards`** - builds native-grade flashcards with the `card.v1`
  kinds: verbatim transcript anchors, per-kind guidance (grammar =
  production cloze of the morpheme with a hint), and a quality rubric
  distilled from the known failure modes of AI-generated cards.
- **`lingochunk-discuss`** - a lighter, conversational "talk me through this
  episode" workflow.
- **`lingochunk-add-language`** - adds another language to one of your episodes
  as a new sibling deck: either the server-side Groq fan-out for an ordinary
  target, or an agent-supplied translation you write sentence by sentence and
  commit - the only way to build a leveled same-language deck (e.g.
  "German (A2)", German audio glossed in simpler A2 German).
- **`lingochunk-annotate`** - finds the genuinely useful expressions in one of
  your episodes (idioms, phrasal verbs, collocations, discourse markers,
  culture-bound references) and attaches a short markdown creator note to each
  exact span: an iris tint + note sheet for you, a forward-only note card for
  your followers.

## Prerequisites

- Node.js >= 18.
- A LingoChunk **personal access token**: in LingoChunk, open Settings -> API
  access, create a token, and grant the scopes you need (`vocab:read` +
  `content:read` cover the read tools; add `cards:write`, `decks:export`,
  `lessons:write`, `translations:write` and `annotations:write` for the write
  tools). The token is shown once and starts with `lcp_`. The 403 errors from
  the tools name the exact scope you are missing.

## Use it

### Option A - Claude Code plugin (the server plus the lesson skills)

This repo is its own plugin marketplace. In Claude Code:

```
/plugin marketplace add lingochunk/lingochunk-mcp
/plugin install lingochunk@lingochunk-mcp
```

The plugin's `.mcp.json` runs the published server via npx, pinned to the
exact version the plugin was released with (no build step needed), and reads
your token from the environment, so export it in the shell you start Claude
Code from:

```bash
export LINGOCHUNK_TOKEN=lcp_your_token_here
```

The `skills/` (lesson builder and episode discussion) are picked up
automatically with the plugin.

### Option B - standalone MCP server (tools only, no skills)

```bash
claude mcp add --scope user lingochunk --env LINGOCHUNK_TOKEN=lcp_... -- npx -y @lingochunk/mcp
```

For development against a local checkout, run the built server directly:

```bash
npm install     # installs deps and builds dist/ via the prepare script
claude mcp add lingochunk --env LINGOCHUNK_TOKEN=lcp_... -- node /absolute/path/to/lingochunk-mcp/dist/index.js
```

## Use with other agents

Nothing in the server is Claude-specific: it is a standard stdio MCP server,
so any MCP-capable agent can run it. The recipe is always the same - run
`npx -y @lingochunk/mcp` with `LINGOCHUNK_TOKEN` in its environment - and
most clients express it as JSON like this:

```json
{
  "mcpServers": {
    "lingochunk": {
      "command": "npx",
      "args": ["-y", "@lingochunk/mcp"],
      "env": { "LINGOCHUNK_TOKEN": "lcp_your_token_here" }
    }
  }
}
```

Where that config lives per client (differences noted):

| Client | Where |
|---|---|
| Claude Desktop | Settings -> Developer -> Edit Config (`claude_desktop_config.json`) |
| Cursor | `~/.cursor/mcp.json`, or `.cursor/mcp.json` per project |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` |
| VS Code (Copilot agent mode) | `.vscode/mcp.json`, with top-level key `servers` instead of `mcpServers` |
| Gemini CLI | `~/.gemini/settings.json` |
| Codex CLI | `~/.codex/config.toml`, as `[mcp_servers.lingochunk]` with the same command/args/env in TOML |

Where your client supports it, prefer referencing an environment variable
over pasting the token into the config file (VS Code can prompt for it via
`inputs`; CLI clients usually inherit your shell environment).

The skills are not Claude-specific either: each one is a plain-markdown
playbook (`skills/<name>/SKILL.md`). Claude Code auto-loads them through the
plugin; with any other agent, point it at the file (or paste it as context)
and ask for a lesson. Every hard guarantee - the schema, verbatim transcript
quoting, sentence positions - is enforced server-side on save, so the
quality contract holds no matter which agent is driving.

## Updating and checking versions

Two artefacts ship from this repo and version separately:

| Artefact | Carries | Check the version with |
|---|---|---|
| Claude Code plugin `lingochunk` | the skills + the server launcher | `claude plugin list`, or `/plugin` -> Installed |
| npm package `@lingochunk/mcp` | the MCP server (the tools) | `npx -y @lingochunk/mcp --version` |

### Update the plugin (Claude Code)

```
/plugin marketplace update lingochunk-mcp
/reload-plugins
```

The first refreshes the marketplace; the second activates updated skills in
the RUNNING session (new sessions load them automatically). To compare the
installed version against what the marketplace offers:

```bash
claude plugin list --json --available
```

Set-and-forget alternative: `/plugin` -> Marketplaces -> select
`lingochunk-mcp` -> **Enable auto-update** (third-party marketplaces have it
disabled by default; official ones are on). With it enabled, Claude Code
refreshes at startup and prompts `/reload-plugins` when something changed.

An update only appears when the plugin's `version` was bumped - Claude Code
uses it as the cache key, which is why our release rule (CONTRIBUTING.md)
bumps it on every user-visible change.

### Update the MCP server

The plugin pins the exact server version in its `.mcp.json`, so **updating
the plugin updates the server too** - no separate step. A running session
keeps its old server process; `/reload-plugins` (or a new session)
reconnects to the new one.

**Standalone installs** (`claude mcp add ... npx -y @lingochunk/mcp`, or the
other-agents configs above) are exposed to an npx trap: npx caches packages
in `~/.npm/_npx` and does NOT re-check the registry once cached, so an
unpinned `@lingochunk/mcp` can run a stale server indefinitely. To check and
fix:

```bash
npx -y @lingochunk/mcp --version      # what npx actually runs
npm view @lingochunk/mcp version      # latest published
rm -rf ~/.npm/_npx                    # blunt fix: clear the npx cache, relaunch
```

Or make your config always-fresh by using `@lingochunk/mcp@latest` (checks
the registry on every launch: ~1-3 s extra startup and a registry
dependency), or pin `@lingochunk/mcp@<version>` and move the pin yourself
when you want the update.

## Configuration

| Variable | Required | Default | Meaning |
|---|---|---|---|
| `LINGOCHUNK_TOKEN` | yes | - | Your personal access token (`lcp_...`). |
| `LINGOCHUNK_BASE_URL` | no | `https://lingochunk.com` | API origin override (for self-host/testing). |
| `LINGOCHUNK_CLIP_DIR` | no | `~/.cache/lingochunk-mcp` | Where `get_audio_clip` writes clip files (a private per-user dir, created mode 0700). |

The token is only ever sent as an `Authorization: Bearer` header to the
configured origin; it is never written to disk or logged.

## Building a lesson

Ask your agent something like "build me a lesson from yesterday's German episode"
or "quiz me on the words I'm learning". The `lingochunk-lesson` skill drives the
workflow: pick the source, pull a transcript slice, gather and **filter** your
vocabulary (never quizzing you on mastered words), then compose a structured
`lesson.v1` document that the app renders natively - real episode audio, live
word state, crosslinks, Ask AI - with an offline HTML export available in-app.
A submission can hold many lessons, so different skills (or repeated runs) add
lessons side by side under the episode's Lessons tab. See
`skills/lingochunk-lesson/`.

## Repository layout

```
src/                                    the MCP server (TypeScript, stdio)
skills/lingochunk-lesson/               the coursebook lesson skill
skills/lingochunk-cards/                the flashcard (card.v1) skill
skills/lingochunk-discuss/              the "discuss an episode" skill
skills/lingochunk-add-language/         the add-language / draft-translation skill
skills/lingochunk-annotate/             the useful-expression annotation skill
skills/*/examples/                      example lesson.v1 documents (CI-validated)
docs/skill-authoring.md                 how to write a new skill
docs/skill-template.md                  SKILL.md starting point
docs/integrations/fluent.md             how to plug this into the fluent tutor plugin
spec/openapi-public-v1.json             the committed public API spec (the contract)
scripts/validate-lesson.ts              validate a lesson.v1 document against the spec
scripts/smoke.ts                        live smoke test (run by hand, never in CI)
test/                                   vitest unit tests (mocked fetch) + example validation
.claude-plugin/plugin.json              Claude Code plugin manifest
.mcp.json                               MCP server definition for the plugin
```

## Contributing a skill

Skills are markdown pedagogy, not code: a `SKILL.md` playbook plus an example
`lesson.v1` document that CI validates against the committed spec. Anyone can
contribute one - a dictation drill, an exam rehearsal, a due-words review
session - and AI-drafted skills are explicitly welcome. Start with
[CONTRIBUTING.md](CONTRIBUTING.md) and
[docs/skill-authoring.md](docs/skill-authoring.md).

## Development

```bash
npm install        # deps + build (prepare)
npm run build      # compile src/ -> dist/
npm run typecheck  # type-check without emitting
npm test           # vitest unit tests (mocked fetch; no network) + skill example validation
npm run validate:lesson -- <doc.json>   # validate a lesson.v1 document (Node 22.6+)
```

`spec/openapi-public-v1.json` is the source contract; it is exported from the
LingoChunk repo (`make generate-openapi-public`) and refreshed here on each API
release. This copy was taken from LingoChunk commit `0db02377`.

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
