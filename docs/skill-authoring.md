# Writing a LingoChunk skill

A skill is a markdown playbook at `skills/<name>/SKILL.md` that teaches an
agent how to build one kind of lesson from a learner's own LingoChunk
content. This guide covers the contract a skill works within; the process
for getting one merged is in [../CONTRIBUTING.md](../CONTRIBUTING.md).

## Anatomy

```
skills/lingochunk-<name>/
  SKILL.md          the playbook (YAML frontmatter + instructions)
  examples/         at least one representative lesson.v1 output (CI-validated)
```

The frontmatter has two fields. `name` must equal the directory name.
`description` is what the agent matches against when deciding whether to use
your skill, so it must say what the skill builds AND when to use it
("Use when the user asks to ..."). Start from
[skill-template.md](skill-template.md).

The body is instructions to a capable agent, not code: options to settle
with the user, the tool workflow, composition rules, hard rules. Write it
the way the existing skills are written - imperative, concrete, short.

## The division of labour

**LingoChunk supplies the materials and renders the result; your skill
supplies the pedagogy, on the user's own tokens.** The app plays audio
straight from the original episode, resolves word knowledge (FSRS) live at
render time, links words and sentences back to their Words/Listen tabs, and
mounts an Ask AI tutor on lesson blocks. Your skill never handles audio
bytes, never stores knowledge state, and never renders anything.

The tools (each wraps one public endpoint; full table in the
[README](../README.md)): `list_library`, `get_transcript`, `get_vocabulary`,
`lookup_word`, `search_examples`, `get_audio_url` for reading;
`validate_lesson` (dry-run: every schema + reference error at once),
`save_lesson`, `update_lesson`, `add_card`, `list_decks`,
`export_anki_deck` for writing. Always `validate_lesson` before the first
save - it turns the save -> 400 -> fix loop into one pass.

## The lesson.v1 document

`save_lesson({document})` takes a `lesson.v1` JSON document. The authoritative
schema is `LessonDocumentV1` in [`../spec/openapi-public-v1.json`](../spec/openapi-public-v1.json);
the quick reference lives in the lesson skill
([`../skills/lingochunk-lesson/SKILL.md`](../skills/lingochunk-lesson/SKILL.md)).
The block vocabulary - the complete set of things a lesson can contain:

| Block | What it renders |
|---|---|
| `section` | numbered section header (the renderer assigns numbers) |
| `prose` | instruction line or short passage (plain text only) |
| `audio_slice` | player row for a `[start, end)` window of the original episode audio |
| `dialogue` | transcript lines with speaker, translation and highlight ranges |
| `vocab` | glossary entries with lemma anchors (FSRS flags resolved live) |
| `grammar_box` | one rule: explanation, evidence rows, Merke/Achtung callouts |
| `exercise_mcq` | multiple choice, optionally with an audio window (listening) |
| `exercise_gap_fill` | `{{n}}` gaps with per-gap accepted answers, optional word bank |
| `exercise_match` | match pairs |
| `exercise_order` | reorder scrambled chunks into the anchored sentence (Satzbau) |
| `exercise_dictation` | listen to the anchored sentence and type it; live word diff |
| `exercise_shadow` | listen -> record -> replay loop on anchored sentences |
| `exercise_production` | free writing prompt with a blurred model answer |
| `review` | closing block: can-do statements, add-to-deck word offers |

Caps that matter while composing: 40 blocks per document, 30 dialogue
lines, 20 vocab entries, 5 MCQ options, 10 gap-fill items, 8 match pairs,
5 order items, 5 dictation items, 8 shadow items, 1 MB serialized. Per
account: 100 active lessons, 60 saves/hour.

### What the server checks that a schema cannot

The server is the validator of record. On a 400, the error code tells you
what to fix:

| Code | Meaning |
|---|---|
| `unknown_positions` | a `position` does not exist in the submission's transcript |
| `position_outside_slice` | a `position` falls outside `source.from_time`/`to_time` |
| `dialogue_mismatch` | dialogue `text` is not the stored sentence verbatim (punctuation counts) |

Audio windows must fall inside the episode (and the declared slice). The
save response's `unknown_lemmas` lists glossary lemmas the episode's
vocabulary does not know - they keep working but lose their Words-tab
crosslink, so prefer the lemma form the episode uses and re-save if any
look wrong.

### Stamp your skill

Set `generator: {skill: "<your-skill-name>"}` at the document's top level
(version optional). The app shows the slug in the episode's lessons list, so
learners can tell which skill built which lesson once several accumulate.
It is self-declared display metadata (the slug is schema-locked to a
lowercase ASCII slug, max 80 chars); it grants nothing and must not be
relied on for anything but display.

### Revise in place, create deliberately

Every `save_lesson` creates a NEW lesson - an episode's Lessons tab lists
every lesson saved against it, so your skill's output sits alongside other
skills' lessons for the same episode. To REVISE an existing lesson, use
`update_lesson` (in place: same id, same links, `base_version` from
`get_lesson` guarding against concurrent edits) rather than saving a copy.
While iterating on genuinely new attempts, delete abandoned ones in the app
(Settings -> Lessons) to stay under the 100-lesson cap.

## Hard rules (every skill, non-negotiable)

1. **Ground, do not invent.** Dialogue lines quote the transcript verbatim
   by `position`; meanings, genders and CEFR levels come from
   `lookup_word`/`get_vocabulary`. Never fabricate example sentences and
   attribute them to the recording.
2. **LingoChunk is the system of record for word knowledge.** Do not drill
   `known` words unless they are also `due`; never write review grades back;
   never store knowledge state in the document.
3. **The user's data stays between the agent and LingoChunk.** A skill must
   never direct the agent to fetch from or send anything to another service,
   and must not embed external URLs in lessons.
4. **No audio handling.** Reference `[start, end)` windows of the original
   episode audio; never generate, cut, embed or upload audio.
5. **Stay inside the block vocabulary.** Never instruct the agent to work
   around server validation or to smuggle markup through text fields (all
   text renders as plain text).
6. **Settle options before generating.** Source episode, time range and
   level are the user's call; ask only for what they left open, then say
   what you picked.

## Pedagogy is yours

Everything else is your skill's identity, and existing skills' choices are
not platform rules. `lingochunk-lesson`'s fixed six-part spine and
one-grammar-point rule are ITS pedagogy; your skill can be a dictation
drill, a listening-first comprehension pass, an exam-format rehearsal, a
due-words-only review session, a shadowing script with tight audio loops -
whatever the block vocabulary can express. What varies per skill:

- the spine (which sections, in what order, how many);
- the exercise mix and its grading (recognition vs recall vs production);
- the level policy (how CEFR level changes instructions and content);
- the vocabulary policy (which FSRS states you drill, within rule 2);
- how much audio work the lesson leans on.

## What a skill cannot do

The block vocabulary above is closed: the server rejects unknown block
types and unknown fields (`additionalProperties: false` everywhere), and
the app's renderer only knows these blocks. A skill cannot add a new
interaction type, change styling, or attach arbitrary data.

Want a new block (drag-to-order, pronunciation scoring, images)? That is an
app change (schema + renderer + export), not a skill PR: open an issue
describing the interaction and the pedagogy it unlocks. Once it ships in
the schema, every skill can use it.

## Example documents

Each lesson-saving skill ships at least one `examples/<name>.lesson.json`:
a small but representative document showing the shape your skill produces.
CI validates every example against the committed spec (`npm test`), and

```bash
npm run validate:lesson -- skills/<name>/examples/<name>.lesson.json
```

gives per-error detail while you iterate (Node 22.6+). Use a fictional
`source.submission_id` (e.g. all zeros): examples are documentation, not
saveable fixtures - the server-side reference checks need a real
submission. See
[`../skills/lingochunk-lesson/examples/feierabend-b1.lesson.json`](../skills/lingochunk-lesson/examples/feierabend-b1.lesson.json).

## Testing your skill live

You need a LingoChunk account with at least one processed episode and a
personal access token (Settings -> API access) with `vocab:read`,
`content:read` and `lessons:write` (plus `cards:write` if your skill offers
add-to-deck).

Not on Claude Code? Skills work with any MCP-capable agent: configure the
server (see "Use with other agents" in the README), then point your agent
at your `SKILL.md` file or paste it as context. Only the auto-discovery in
steps 1-2 below is Claude Code specific; the rest of the checklist is
identical.

1. Install the plugin from your checkout so your skill is picked up:
   `/plugin marketplace add /absolute/path/to/your/lingochunk-mcp` then
   `/plugin install lingochunk@lingochunk-mcp` (export `LINGOCHUNK_TOKEN`
   first).
2. Ask the agent for your lesson type using the trigger phrases from your
   `description`, and watch it settle the options you defined.
3. On a 400 from `save_lesson`, read the error code (table above), fix,
   retry - this loop is normal and your SKILL.md should tell the agent how
   to handle it.
4. Open the returned `app_url` and work through the lesson end to end:
   audio rows play the right window, exercises check and score, vocabulary
   flags look right, crosslinks land on the right word/sentence, Ask AI
   opens with the right context.
5. Confirm the episode's Lessons tab lists your lesson (alongside any
   others), and that the in-app Download export reads well.
