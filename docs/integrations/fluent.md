# Integration recipe: fluent

[fluent](https://github.com/m98/fluent) (and forks such as
[srsatt/fluent](https://github.com/srsatt/fluent)) is a Claude Code / Codex
**plugin** that turns a coding agent into a personal language tutor: a set of
skill prompts plus small local scripts plus its own MCP server. It has no HTTP
client and no API-key surface, so its only extension mechanism is "more MCP
tools in the same agent runtime". That is exactly what this plugin provides.

The point of integration: fluent's tutor otherwise invents vocabulary "from thin
air" (an LLM picks "high-frequency words"), and its listening pipeline makes the
user configure a local whisper.cpp. LingoChunk replaces both with the user's
real, FSRS-graded listening history. **No fluent code changes are required, only
prompt additions.**

## Setup

1. Create a LingoChunk personal access token (Settings -> API tokens) with the
   `vocab:read` and `content:read` scopes.
2. Add the LingoChunk MCP server alongside fluent's own, in the same agent
   runtime (see this repo's README - either the plugin or a standalone
   `claude mcp add`). Both servers' tools are then visible to the tutor.

## Prompt additions

Add these paragraphs to the relevant fluent skill files (or to the user's
`CLAUDE.md`). They only steer the agent; they change no fluent code.

### Word selection (e.g. `/fluent-vocab`)

> Before choosing words to study, call the LingoChunk MCP tools
> `get_vocabulary(status=known)` and `get_vocabulary(status=learning)` for the
> target language. Draw new study words from the user's actual listening backlog
> (their `learning` and `new` words) rather than inventing "high-frequency"
> words. NEVER introduce a word LingoChunk marks `known` (mastered). When you
> need a word's meaning, gender or CEFR, call `lookup_word` instead of guessing.

### Listening practice (e.g. `/fluent-rss`)

> Instead of transcribing RSS media with a local whisper.cpp, use the user's
> LingoChunk episodes: call `list_library`, then `get_transcript` (sliced to a
> sentence or time range) and `get_audio_clip` for short native-audio snippets.
> Build gist / detail / gap-fill exercises from these real transcripts and clips.

### Session end

> Do not mirror LingoChunk's scheduling into fluent's own SM-2 queue.
> **LingoChunk is the system of record for word knowledge.** Skip words it marks
> mature, and skip fluent's own Anki export for lemmas LingoChunk already covers
> with native-audio cards. Pushing session-discovered words back into LingoChunk
> via an `add_card` tool is coming in v1.1; until then, note the new words for the
> user rather than writing them anywhere.

## Why this works

fluent's skills already check for "an existing transcript path" before
transcribing, and its session payloads carry `transcript_refs[]`, so there are
natural seams to plug LingoChunk in at the prompt level. The MCP tools, not a
raw REST API, are the deliverable precisely because this consumer class extends
only through tools in the shared agent runtime.
