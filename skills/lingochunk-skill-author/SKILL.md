---
name: lingochunk-skill-author
description: Turn a lesson the user has already refined (usually through the app's co-edit loop) into a reusable SKILL - a portable markdown playbook that recreates that lesson's format from any episode, kept private or contributed to the lingochunk-mcp repo. Use when the user asks to "make a skill from this lesson", "save this format as a template", "replicate this lesson for other episodes", or wants to share their lesson format with students or other creators.
---

# LingoChunk skill author (the meta-skill)

Turn one finished lesson into a repeatable FORMAT. The user has typically
refined a lesson by trial - co-edit rounds until the structure is exactly
right - and now wants "this shape again, for any episode". That shape is a
skill: a markdown playbook that any MCP-capable agent (claude.ai, Claude
Code, ChatGPT dev mode, ...) can follow to rebuild the format from fresh
episode content. A skill is ONLY text - the capability lives in the
LingoChunk MCP tools, which are identical on every client, and the server
stays the validator of record - so a skill travels without trust machinery:
a bad one produces validation errors, not bad lessons.

This skill uses the `lingochunk` MCP tools. If they are not available, tell
the user to add the LingoChunk MCP server (see the plugin README) and stop.

## When to use

- "Make a skill out of this lesson so we can do the same for next week's
  episode."
- "Save this lesson format as a template."
- "I want my students' agents to be able to build lessons in this format."
- "Turn the way we structured this into something reusable."

Not for building a lesson (that is `lingochunk-lesson` or a skill you
already made), and not for one-off edits to an existing lesson
(`update_lesson` directly).

## Options to settle first (ask only what the user left open)

1. **Source lesson**: which saved lesson embodies the format
   (`list_lessons` if they don't say; usually the one just co-edited).
2. **How strict a clone**: exact format (same spine, same exercise types,
   same counts) or a genre (the spine and voice fixed, the exercise mix
   allowed to vary by episode/level - say which parts flex).
3. **Where it lives**: private (the user keeps the markdown; default) or
   contributed to the public `lingochunk-mcp` repo for everyone. Never
   assume publication.

## Workflow

1. **Fetch and read the lesson.** `get_lesson` -> `document`. Extract the
   format signature:
   - the spine: the `section` sequence and what sits under each;
   - the exercise mix: which blocks, how many items, where anchors and
     `audio` windows are used;
   - the voice: instruction style and language, `prose` tone, dialogue
     `note` habits, `show_sentence` usage, highlight policy, review-block
     shape;
   - the policies implied: level pitch, which FSRS states get drilled,
     glossary size.

2. **Separate structure from content.** This is the whole craft. The skill
   KEEPS structure and voice; every piece of episode content becomes an
   INSTRUCTION to fetch fresh content:
   - sentences/quotes -> "pick N sentences that <criterion> from
     `get_transcript` and quote them verbatim by `position`";
   - glossary entries -> "take M `learning`/`new` words from
     `get_vocabulary`, ground with `lookup_word`";
   - audio windows -> "build from the chosen sentences' `start`/`end`";
   - titles/objectives -> "derive from the slice's topic".
   NEVER copy episode content (sentences, words, times, titles) into the
   skill: against any other episode it is fabrication, and the server will
   reject the misquotes. If a phrase is part of the format's voice (a
   recurring instruction line, a section subtitle pattern), keep it; if it
   came from the episode, generalise it.

3. **Draft the SKILL.md.** One self-contained markdown document:
   - YAML frontmatter: `name` (see naming below) and a one-line
     `description` that says what it builds and the trigger phrases;
   - body in the house shape: one purpose paragraph, "When to use",
     "Options to settle first", a numbered "Workflow" (pull slice -> gather
     vocabulary -> compose the spine, spelled out block by block ->
     `validate_lesson` -> `save_lesson` stamping
     `generator: {skill: "<name>"}` -> deliver `app_url`), "Hard rules";
   - inherit the platform hard rules verbatim: ground every quote by
     `position`, meanings from the tools, never drill `known` unless
     `due`, no external services, no audio handling, block vocabulary is
     closed;
   - pull the `lesson` guide (`get_authoring_guide` topic `lesson`) while
     drafting and copy in the block shapes and caps your format uses - the
     drafted skill should stand alone without this meta-skill.

4. **Round-trip check (do not skip).** Follow your drafted skill against
   the ORIGIN episode as if you had never seen the lesson: derive the
   document it produces and `validate_lesson` it. Then compare with the
   original: same spine, same block types in the same places, anchors and
   windows present? If you cannot reproduce the origin from the draft, the
   instructions are too vague - name counts and criteria, not vibes
   ("3-5 sentences carrying the grammar pattern", not "some sentences").
   Fix and re-check.

5. **Deliver.** Output the complete SKILL.md as one copyable markdown
   block, then tell the user how to keep and reuse it (below). If they
   chose publication, walk them through the contribution path instead.

## Keeping a private skill (any MCP client)

The skill is portable text; where to put it so the agent finds it again:

- **claude.ai**: a Project - paste the skill into the project instructions
  (or add the file to project knowledge) and build lessons in that project.
- **Claude Code**: save as `~/.claude/skills/<name>/SKILL.md` (or
  `.claude/skills/<name>/SKILL.md` in a repo) - it becomes a first-class
  skill.
- **ChatGPT**: custom GPT instructions, or a saved prompt.
- **Anything else**: paste the skill at the start of the conversation.

Re-running it later needs no special machinery: the user asks in the
skill's trigger words, the agent follows the playbook against a new
episode. Lessons already saved never change when the skill changes.

## Publishing to the lingochunk-mcp repo

If the user wants the format available to everyone (every plugin install,
every remote-MCP client), it goes into the public repo as a normal skill
PR - maintainer review is the trust gate. Requirements (details:
`CONTRIBUTING.md` in the repo):

- directory `skills/lingochunk-<name>/` with the SKILL.md (frontmatter
  `name` matching);
- at least one `examples/<name>.lesson.json` - a representative output
  with a fictional `submission_id` (CI validates it against the spec);
- evidence of a live run (an `app_url` or screenshot) in the PR.

Offer to prepare all three from the origin lesson (its own document,
episode identifiers swapped for fictional ones, makes a good example).

## Naming and stamping

- The `lingochunk-` name prefix is RESERVED for skills merged into the
  repo. Name a private skill after the user or the format:
  `daves-family-phrases`, `weekly-shadowing-drill`.
- The drafted skill must stamp its documents:
  `generator: {skill: "<name>", version: "1.0"}` - lowercase slug, it is
  display provenance only. Bump the version when the user revises the
  format, so lessons record which iteration built them.

## Hard rules

- **Instructions, not content.** The drafted skill carries no episode
  sentences, words, times or titles - only rules for fetching them fresh.
- **Inherit the platform rules.** The drafted skill must state them:
  verbatim quoting by `position`, meanings from the tools, FSRS
  system-of-record, no external services, no audio handling, no markup
  smuggling. A skill that omits them produces agents that break lessons.
- **Stay inside the block vocabulary.** If the format needs something no
  block can express, say so plainly and suggest opening an issue on the
  repo - never instruct workarounds against server validation.
- **Text only.** A skill never ships code, tool definitions, or anything
  executable; if it seems to need them, it is not a skill.
- **Private by default.** Publication (a PR) only on the user's explicit
  choice.
