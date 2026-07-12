---
name: lingochunk-lesson
description: Build a coursebook-style lesson from the user's own LingoChunk listening history and save it as a structured lesson.v1 document. Pick an episode (optionally a time range like "the first 5 minutes") and a CEFR level, pull the transcript slice plus vocabulary with FSRS maturity, then compose a lesson on a Listen -> Text -> Vocabulary -> Grammar -> Exercises -> Review scaffold, choosing 2-3 exercise archetypes suited to the grammar point and level so consecutive lessons don't feel identical. The app renders it natively with real audio, live word state, crosslinks and a built-in AI tutor. Use when the user asks to make or build a lesson, worksheet, study sheet, or exercises from their LingoChunk content, or to "quiz me" on an episode or a word.
---

# LingoChunk lesson builder

Build a `lesson.v1` document grounded in the learner's real LingoChunk
content. The division of labour is the point: **LingoChunk supplies the
materials (sentences with positions and translations, vocabulary with FSRS
maturity) and renders the lesson natively in the app; you do the pedagogy on
the user's own tokens.** No server-side LLM spend. The app plays the audio
straight from the original episode (never send or embed audio), resolves
word knowledge live, links every word and sentence back to its Words/Listen
tabs, and mounts an Ask AI tutor on the grammar box and glossary.

This skill uses the `lingochunk` MCP tools. If they are not available, tell
the user to add the LingoChunk MCP server (see the plugin README) and stop.

## When to use

- "Make me a lesson / worksheet / quiz from yesterday's episode."
- "Build a lesson on the subjunctive using examples from my episodes."
- "Create a lesson from the first five minutes of episode X."
- "Quiz me on the words I'm learning in German."

## Options to settle first (ask only what the user left open)

1. **Source**: a named episode (`list_library`), or a topic/grammar point
   gathered across episodes (`search_examples`, `get_vocabulary`) - in v1 a
   lesson has ONE source episode, so for cross-episode topics pick the
   richest single episode.
2. **Time range**: "the first five minutes" maps to `get_transcript`
   `from_time`/`to_time`; a chapter or scene works too. Default: a coherent
   3 to 8 minute slice, not a whole 45-minute episode.
3. **Level**: the CEFR level to pitch at. If the user does not say, infer it
   from the CEFR mix of their `get_vocabulary(status=known)` words and say
   which level you picked. Level drives:
   - instruction language: A1/A2 instructions in the learner's language;
     B1+ in the target language (keep them one short sentence);
   - exercise mix: more recognition (MCQ, matching) at low levels, more
     cued recall and production at high levels;
   - which grammar point qualifies (see below), glossary depth, and which
     archetypes you pick from the menu.

## Workflow

1. **Pull the slice.** `get_transcript` with the chosen range. Only
   `transcript_state: "ready"` is usable. Keep each sentence's `position`,
   `text`, `translation`, `speaker`, and its `start`/`end` seconds - the
   document references sentences BY POSITION and must quote `text` VERBATIM
   (the server rejects misquotes); the `start`/`end` times are what you build
   `audio_slice` windows from.

2. **Gather and filter vocabulary.** Two sets: EXCLUDE and DRILL.
   - Exclusion set: `get_vocabulary(status=known)` (follow `next_cursor`
     with `limit=200` until null, or a known word slips into an exercise).
   - Due words: `get_vocabulary(status=due)` - do NOT exclude; they are
     exactly what is worth practising now (the app flags them live).
   - Drill words: `get_vocabulary(status=learning)` and `status=new`,
     prioritised.
   - Ground meanings/gender/CEFR with `lookup_word`; never invent them.

3. **Pick ONE grammar point** evidenced in the slice, at the lesson's
   level. One per lesson, always. Prefer a pattern that occurs 2+ times in
   the slice so the evidence table has real rows.

4. **Compose the document** (schema below) on the scaffold, choosing
   archetypes from the menu. The scaffold is the default skeleton; the
   archetype menu is what stops every lesson looking the same. See
   "The scaffold and the archetype menu" below.

5. **Validate, then save.** Call `validate_lesson` with `{document}` FIRST:
   it returns EVERY problem at once (schema + reference), so you fix the whole
   document in one pass instead of burning save -> 400 -> fix cycles. Read the
   `errors` codes: `schema_invalid` carries a `loc` (dotted path to the bad
   field); `unknown_positions` / `position_outside_slice` mean a sentence
   reference is wrong; `dialogue_mismatch` means quote the transcript verbatim
   (including punctuation); `order_mismatch` means an `exercise_order` item's
   segments do not reassemble its anchored sentence. Only once it returns
   `valid: true` do you `save_lesson` with `{document}`. Set
   `generator: {skill: "lingochunk-lesson"}` so the app's lessons list shows
   which skill built it (episodes collect lessons from several skills). Both
   calls report `unknown_lemmas` (advisory only - glossary lemmas the episode
   does not know); prefer the lemma form the episode's vocabulary uses and fix
   any that look wrong before saving.

6. **Deliver.** Give the user the `app_url` (the lesson opens in a Lessons
   tab on the episode). If the user asked for a course or a series of lessons,
   file this one under a course: `create_course` once, then pass its id as
   `save_lesson`'s `course_id` with a `sequence` (see the `lingochunk-course`
   guide). If the user is a CREATOR publishing to their audience, pass
   `visibility: "public"` too - the lesson then shows to everyone who can view
   the episode (e.g. followers of their collection). Publishing requires
   owning the episode; the default is private, so never publish unasked. Offer `add_card` for drill words the lesson introduced (a 409 means
   it is already there - skip and carry on; never add `status=known` words).
   Mention the in-app Download button if they want the offline HTML worksheet
   (it has no audio by design). Summarise what the lesson covers and which
   words it drills.

## Anchoring (mandatory)

The renderer's best features - inline play chips, deep links into Listen and
Words, listening exercises - are all opt-in through optional fields. A lesson
that omits them renders flat. These are hard rules, not suggestions:

- **Every `vocab` entry MUST carry `position`.** The anchor is what puts an
  audio play chip on the row and a crosslink to the Words tab. A vocab entry
  with no position is a dead row.
- **Every MCQ that tests LISTENING MUST carry `audio`** (and a `position`
  when it points at one sentence). Without `audio` it is a reading question,
  not a listening one. A pure recognition/gist MCQ before reading is the one
  case that legitimately has no audio.
- **Every gap-fill item SHOULD carry `position` and `translation`.** The
  position anchors it to the real sentence (and lights a play chip where the
  renderer supports it); the translation gives the learner the meaning to
  work from.
- **Dialogue highlights on the grammar pattern are required.** Every
  `dialogue` line that carries an instance of the lesson's grammar point MUST
  mark it with `highlights` (code-point ranges) so the pattern shows as gold
  marks. A dialogue with no highlights wastes the one grammar point.

## The scaffold and the archetype menu

**Scaffold (default skeleton, in order):** Listen -> Text -> Vocabulary ->
Grammar -> Exercises -> Review. Use `section` blocks to head each stage; the
renderer numbers them. This ordering (recognition before reading, one grammar
point, graded practice, can-do close) is the pedagogy and holds for every
lesson.

**Archetype menu (the variety).** The Exercises stage - and the Listen and
Text stages' interactive bits - are NOT a fixed list. Pick **2-3 archetypes**
per lesson, keyed to the grammar point, the level, and what the episode's
audio actually affords, so consecutive lessons on the same episode don't feel
identical. The archetypes (recipes for the starred ones are below):

| Archetype | Block(s) | Best for |
|---|---|---|
| Gist MCQ (no audio) | `exercise_mcq` | opening recognition, every lesson |
| T/F comprehension * | `exercise_mcq`, 2 options | after the listen, low/mid levels |
| Listening-detail MCQ | `exercise_mcq` + `audio` + `position` | any level, checks a specific line |
| Minimal-pair MCQ * | `exercise_mcq` + `audio` | morphology, separable prefixes, case, tense |
| Back-chain ladder * | 3-4 `audio_slice` | one hard/long sentence; prosody; word order |
| Assimil passive wave * | `prose` + `dialogue` | the Text stage, every level |
| Anticipation round * | `prose` + `audio_slice` pairs | cued recall, mid/high levels |
| Grammar gap-fill | `exercise_gap_fill` | the grammar point itself, every lesson |
| Vocabulary gap-fill | `exercise_gap_fill` + `wordbank` | vocabulary consolidation, low/mid |
| Match words -> meanings | `exercise_match` | vocabulary, low/mid levels |
| Sentence reorder * | `exercise_order` | word order / clause structure, every level |
| Dictation * | `exercise_dictation` | native-audio dictation, listening precision |
| Shadowing * | `exercise_shadow` | pronunciation & prosody, the differentiator |
| Production | `exercise_production` | active use, mid/high levels |

**Which archetypes for which lesson** (grammar-point type x level -> pick from):

| Grammar point | A1-A2 | B1-B2 | C1+ |
|---|---|---|---|
| Verb morphology (Perfekt, tense) | minimal-pair MCQ, grammar gap-fill | back-chain ladder, grammar gap-fill | anticipation round, production |
| Word order / clause structure | sentence reorder, T/F comprehension | sentence reorder, back-chain ladder | anticipation round, production |
| Cases & endings | minimal-pair MCQ, match | grammar gap-fill, minimal-pair MCQ | production, anticipation round |
| Separable / prefix verbs | minimal-pair MCQ, listening-detail MCQ | minimal-pair MCQ, grammar gap-fill | anticipation round, production |
| Connectors / subordination | T/F comprehension, vocabulary gap-fill | grammar gap-fill, production | production, anticipation round |
| Vocabulary field / functional | match, vocabulary gap-fill | listening-detail MCQ, production | anticipation round, production |

Always keep one grammar gap-fill (or minimal-pair MCQ) that drills the actual
grammar point, plus one vocabulary archetype; the third slot is where you
vary. Distractors in any MCQ or word bank come from the user's own
vocabulary, same part of speech, so wrong answers are plausible.

## Recipes

### Back-chain ladder (FSI backward build-up)

For the slice's hardest sentence - the longest, or the one carrying the
grammar pattern - build 3-4 `audio_slice` blocks that all END at the same
point and grow leftward, shortest first, so the learner chorus-repeats the
tail then extends it: "…gemacht." -> "…heute gemacht." -> the whole sentence.

Computing the windows from the sentence's transcript `start` S and `end` E
(there are no per-word times, so estimate):

- per-word duration `d = (E - S) / word_count`;
- slice covering the last `w` words: `start = E - w*d`, `end = E`;
- use growing `w` (e.g. last 2 words -> last 5 -> full sentence at `start=S`);
- the END anchor `E` is exact; the estimated starts can land mid-word, so
  subtract ~0.3 s from each computed `start` (floor at S) to avoid clipping
  the first syllable.

Label each block with the words it contains, e.g. `"Just the ending:
gemacht."` then `"…heute gemacht."` then the full sentence. The schema needs
`end > start` and `start >= 0`, and every window must sit inside the source
slice.

### Assimil passive wave

Before the `dialogue` block in the Text stage, put an instruction `prose`
that runs the passive wave: listen once without reading, then read while
listening, then reveal translations line by line. The dialogue block already
blur-reveals each line's translation, so the instruction is what makes it a
technique rather than a wall of text. Example prose:

> "Listen to the scene once with the audio above, without reading. Play it
> again and read along. Then tap each line to reveal its translation and
> check you understood."

### Anticipation round (Pimsleur-style)

Cued recall in pairs. For 3-5 target phrases from the slice, emit a `prose`
(the L1 prompt + a one-line hint on how to say it) immediately followed by an
`audio_slice` that plays the phrase from the real audio as the answer.
Instruct the learner to cover the answer, say the German aloud, THEN play to
check. Keep the answer slice's `label` NEUTRAL ("Play the answer") - printing
the German would spoil the anticipation. Build the answer window from the
target sentence's `start`/`end` (a back-chain-style tail slice works if you
want just the phrase). Order the pairs from easiest to hardest.

### Minimal-pair / discrimination MCQ

An `exercise_mcq` with a tight `audio` window over the contrasting word or
phrase, and options that differ in exactly ONE morpheme - perfect for German
separable prefixes (`steht auf` vs `versteht`), case endings (`dem` vs
`den`), or tense/participle (`gefahren` vs `fahren`). `correct` indexes the
form actually spoken; the distractors are real minimal variants, not
nonsense. Add `position` so the row deep-links to the sentence.

### T/F comprehension

An `exercise_mcq` with exactly TWO options - `["Richtig", "Falsch"]` (or the
learner's language at A1/A2) - and a `prompt` that states something about the
passage. Place 2-3 of them after the Listen section. Add `audio` + `position`
to make it a listening check rather than a reading one.

### Sentence reorder (Satzbau)

An `exercise_order` with 1-5 `items`, each a sentence broken into `segments`
(3-12 chunks) IN CORRECT ORDER - the renderer scrambles them; the learner
reassembles. This is the right tool whenever the grammar point is word order
or clause structure (verb-second, verb-final in subordinate clauses,
separable-prefix placement): it supersedes an ad-hoc gap-fill where a real
scramble fits. Anchor each item to its sentence with `position` and the server
checks the segments reassemble the stored sentence (whitespace-insensitive),
rejecting a drifted scramble with `order_mismatch`; so quote the real chunks,
do not paraphrase. Split at meaningful units (a chunk can be a word or a short
phrase like "am Wochenende"), and add `translation` so the learner has the
meaning to aim for.

### Dictation (Diktat)

An `exercise_dictation` with 1-5 `items`, each anchoring a stored sentence by
`position` (REQUIRED). The app plays that sentence's native audio and diffs the
learner's typing against the LIVE transcript word by word - nothing is copied
into the document, so the answer stays truthful as the transcript is edited.
Pick 2-4 SHORT, clearly-articulated sentences (dictation of a long or mumbled
line just frustrates); optionally set a wider `audio` window to include a beat
of lead-in, keeping it COVERING the sentence. Add `translation` for the meaning.

### Shadowing (the differentiator)

An `exercise_shadow` with 1-8 `items`, each a stored sentence by `position`
(REQUIRED) - the app plays the native line, records the learner, and replays
their take (in-memory only, no upload, no score - self-assessed). This is the
product's core practice move inline in a lesson; use it to make a lesson end in
real speaking. Pick 3-8 of the dialogue's best lines - the ones worth being
able to say fluently - in the order they occur. Add `translation` per line.

## The lesson.v1 document (quick reference)

Top level: `{format:"lesson.v1", title, subtitle?, language,
translation_language, level?, source:{submission_id, from_time?, to_time?,
episode_title?}, generator?:{skill, version?}, objectives?[<=5],
estimated_minutes?, blocks[<=40]}`.

Blocks (`type` field): `section {title, subtitle?}` · `prose {text,
style:"instruction"|"body"}` · `audio_slice {audio:{start,end}, label?}` ·
`dialogue {lines:[{position, speaker?, text, translation?,
highlights?:[[start,end],...]}]}` · `vocab {entries:[{lemma, pos?, display?,
forms?, meaning, cefr?, position?}]}` · `grammar_box {title, explanation,
evidence:[{position?, text, note}], merke?, achtung?}` · `exercise_mcq
{title?, instruction?, prompt?, audio?, position?, options[2..5],
correct:0-based index}` · `exercise_gap_fill {title?, instruction?, wordbank?,
items:[{position?, text, answers:[[alternatives],...], translation?}]}`
(gaps are `{{1}}`, `{{2}}`, ... in `text`; `answers[n-1]` lists accepted
alternatives for gap n) · `exercise_match {title?, instruction?,
pairs:[{left,right}][2..8]}` · `exercise_order {title?, instruction?,
items:[{position?, segments[3..12] in correct order, translation?}][1..5]}`
(segments must reassemble the anchored sentence) · `exercise_dictation
{title?, instruction?, items:[{position (REQUIRED), audio?:{start,end},
translation?}][1..5]}` · `exercise_shadow {title?, instruction?,
items:[{position (REQUIRED), translation?}][1..8]}` · `exercise_production
{title?, instruction?, prompt, model_answer}` · `review {can_do?[<=5],
new_lemmas?[<=12]}`.

`position?` in the reference is the SCHEMA shape (optional); the Anchoring
section is where authoring policy makes some of these anchors mandatory.

Caps: 40 blocks, 30 dialogue lines, 20 vocab entries, 5 MCQ options, 10
gap-fill items, 8 match pairs, 5 order items (3-12 segments each), 5 dictation
items, 8 shadow items, 8 highlight spans per line, 1 MB serialized.

The server is the validator of record (strict: unknown fields and block
types are rejected). Audio is `[start,end)` seconds into the ORIGINAL
episode audio - never generate, clip or embed audio files.

## Hard rules

- **Ground, do not invent.** Every dialogue line quotes the transcript
  verbatim by `position`; meanings, genders and CEFR come from
  `lookup_word`/`get_vocabulary`. The server enforces the quoting.
- **Anchor everything (see Anchoring above).** Vocab entries carry
  `position`; listening MCQs carry `audio`; gap-fill items carry `position`
  and `translation`; grammar-pattern dialogue lines carry `highlights`. An
  unanchored lesson renders flat and is a bug.
- **LingoChunk is the system of record for word knowledge.** Do not drill a
  `known` word unless it is also `due`. Never write review grades back.
- **One grammar point per lesson.** Depth beats coverage; a second point is
  a second lesson.
- **Vary the archetypes.** Pick 2-3 from the menu keyed to the grammar point
  and level; do not emit the same fixed exercise list every time.
- **Respect the source.** Only use content the tools return; put the
  episode title in `source.episode_title`.
- **No audio handling.** The app plays ranges of the original audio;
  `get_audio_clip` is NOT part of this workflow. `audio_slice` windows are
  built from transcript sentence `start`/`end` times.
