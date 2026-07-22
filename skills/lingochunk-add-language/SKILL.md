---
name: lingochunk-add-language
description: Add another language to one of the user's own LingoChunk episodes so it becomes a new sibling deck, and translate the episode's lessons and guided path into that language as EDITIONS. Deck side has two paths: trigger the server-side fan-out for an ordinary target language (Groq, spends no tokens), or translate the episode yourself sentence by sentence and commit it - the only way to build a leveled same-language deck (e.g. "German (A2)"). Lesson/guided side: the edition tools serve the meta-language strings as units you translate or adapt on your own tokens while target text stays byte-identical. Use when the user asks to add a language or translation to an episode, publish lessons or a guided path in another language, or make a simplified same-language (A1-B2) version of an episode.
---

# LingoChunk add-language builder

Add a target language to one of the learner's own episodes. LingoChunk keeps a
submission's audio, timestamps and word analysis and reuses them across
languages; the ONLY per-language work is the translation surface (the
whole-sentence translation plus one meaning per word). This skill drives that
work two ways:

- **Ordinary target language, on the house.** `add_language` triggers the
  server's Groq fan-out. No tokens of yours, no per-word work - you hand it
  language codes and poll for the new siblings.
- **Agent-supplied translation, on your tokens.** You page through the
  episode's sentences, translate them yourself, draft them in batches and
  commit. This is the only path that produces a **leveled same-language
  deck** (`en-a2`, `de-b1`, ...): the audio stays the source language and the
  "translation" is a SIMPLER register of that same language, for levelling up
  within a language you already read.

The division of labour is the point: LingoChunk supplies the source material
and mints the sibling; you supply the translation on the user's own tokens.
Nothing here spends server LLM budget on the draft path.

This skill uses the `lingochunk` MCP tools. If they are not available, tell the
user to add the LingoChunk MCP server (see the plugin README) and stop.

## When to use

- "Add French and Ukrainian to this episode."
- "Translate my German episode into Polish."
- "Make a simplified German (A2) version of this episode so I can level up."
- "Add an English-glossed-in-simple-English deck to this recording."

## Pick the path first (ask only what the user left open)

1. **Which submission.** A named episode, or `list_library` to find one. Only
   the READY primary of a group is a valid source; a derived sibling is not.
2. **Which language(s).** Run `list_languages(submission_id)` and read:
   - `available_targets` - ordinary languages you may fan out with
     `add_language`.
   - `simplify_targets` - leveled same-language codes (only those whose base
     equals the source language; `de-a2` appears on a German episode, not on a
     French one). These go through the DRAFT path only.
   - `languages` - what already exists (skip these); `drafts` - work in
     progress you can resume.
3. **Which path.**
   - Ordinary target and the user is happy with the built-in translation ->
     **fan-out path** (`add_language`). Fastest, no tokens.
   - A leveled code, OR an ordinary target the user wants YOU to translate ->
     **draft path** (translate + commit). Leveled codes are rejected by
     `add_language`, so they always take the draft path.
4. **For a leveled code, which level.** The code carries it (`de-a1` .. `de-b2`).
   If the user says "simple German" without a level, default to `a2` and say so.

## Fan-out path (ordinary targets, server-side)

1. `add_language(submission_id, languages)` with 1-10 codes from
   `available_targets`. It returns a `job` per accepted language and a
   `skipped` list (source language, an existing sibling, or a leveled code with
   reason `agent_only_target`).
2. Poll `list_languages` until each new sibling's `status` is `ready`. Report
   the ready siblings; a `skipped` leveled code means "use the draft path".

## Draft path (you translate; ordinary target OR leveled same-language)

1. **Page the source.** `get_translation_source(submission_id, from_position,
   limit)`. Each sentence gives `text`, `pivot_translation` (the whole sentence
   in the pivot language) and `tokens` - `surface`, `lemma`, `pos` and a
   `pivot_meaning` that FIXES each word's sense (which homonym, which reading).
   Follow `next_from_position` until it is null. Note `pivot_language` and
   `source_language` from the response.
2. **Translate in batches of 25-50 sentences.** Produce, per sentence:
   - `meanings`: one entry per token, **same order, exact same length as
     `tokens`** (count them). Rules below.
   - `translation`: the whole-sentence line (rules below), or `null`.
   Trust the `pivot_meaning` for each word's sense - it came from a strong
   model with the full context. Do not re-interpret the word.
3. **Upload.** `put_language_translations(submission_id, language, generator,
   sentences)` (1-100 per call). Set `generator` to your model id. The server
   validates each sentence against the real transcript and returns a `rejected`
   list while ACCEPTING the rest - common reasons: `meanings_length_mismatch`
   (it names `expected`/`got`; you miscounted the tokens), an unknown
   `position`, an oversize string. Fix only the rejected sentences and PUT them
   again. Keep a **local tally of every position you have covered**.
4. **Commit.** `commit_language(submission_id, language)` when the tally covers
   every sentence. A 409 means the draft is incomplete - it lists the missing
   count and the first missing positions; PUT those, then commit again. The
   tool starts the apply job and polls it: `status:'completed'` returns the new
   sibling's `submission_id`; `status:'processing'` means call `list_languages`
   shortly to see it appear.
5. **Deliver.** Tell the user the sibling is ready and how it is labelled
   (e.g. "German (A2)"). To abandon a half-finished draft, use
   `discard_language_draft` (it removes only the draft rows, never a committed
   sibling).

## Ordinary-target translation rules

For a real other-language deck (source -> target, e.g. German -> Polish):

- **`meanings`**: the target-language dictionary base form of each word in the
  sense the `pivot_meaning` fixes (NOUN singular, VERB infinitive, ADJ/ADV
  base). One per token, same order, exact length.
- **PUNCT and INTJ/filler tokens -> `""`.** Never omit the final full stop's
  entry and never add extra entries - that is an off-by-one on every sentence.
- **Proper nouns -> the name itself.**
- **Never copy the pivot or source word verbatim** as its meaning; render it in
  the target language.
- **`translation`**: a fluent, natural whole-sentence translation of the source
  sentence into the target language.

## Leveled same-language rules (`en-a2`, `de-b1`, ...)

Ported from LingoChunk's validated simplification prompt. Here the audio and the
output are the SAME language; you are writing a monolingual learner-dictionary
gloss in a simpler register. The code's level sets the bar: `a1` = the ~500 most
basic everyday words; `a2` = basic everyday vocabulary; `b1` = intermediate;
`b2` = upper-intermediate. When unsure, go simpler.

**`meanings` - per word, decide first: does a learner AT THE TARGET LEVEL know
this word?** Everyday words (family, food, home, school, common actions,
function words) - yes at every level. Formal, administrative, legal, literary,
academic, technical and news-register words - no, even when they are frequent in
newspapers.

- **Word at or below the target level -> gloss it as its own dictionary base
  form.** An easy word is its own meaning. Never expand an easy word into a
  definition ("dog" stays "dog", never "animal that barks"). At `b1`/`b2` this
  means most words pass through unchanged, and you only simplify the genuinely
  harder ones; at `a1`/`a2` far fewer words survive as themselves.
- **Word above the target level -> write something DIFFERENT and EASIER**: an
  everyday same-language synonym, or a short plain 2-4 word phrase with the same
  meaning in this sentence. Examples: "committee" -> "group", "endeavoured" ->
  "tried", "obtain" -> "get", "inquire" -> "ask".
  - **Anti-echo (the main failure mode):** repeating the word, or its base
    form, is a WRONG answer for a hard word. "obtain" -> "obtain" is wrong.
  - **Formal-synonym trap:** a replacement that is just as rare or formal is
    also WRONG - pick the word a beginner would actually know. Every word inside
    your meaning must itself be an everyday word.
  - **Administrative, legal and institutional vocabulary** (courts, ministries,
    regulations, committees, contracts, official procedures) is NEVER beginner
    vocabulary, in any language - always give it an everyday replacement, even
    when it is common in the news.
  - If you are unsure whether a word is known at the level, treat it as unknown
    and simplify it.
- Keep the sense fixed by the `pivot_meaning` (the water sense of a word, not
  the electricity sense). Everything you write is in the SOURCE language; never
  let a pivot-language word into the output. PUNCT/INTJ -> `""`; proper nouns ->
  the name.
- Before finalising a sentence, re-check: any meaning identical to its input
  word must really be everyday vocabulary at the level; if it is formal,
  official or literary, replace it with an easier one.

**`translation` - a simplified rewrite of the whole sentence in the same
language**, ONLY where a genuinely simpler phrasing exists:

- Everyday spoken vocabulary, short main clauses, active voice, the most basic
  tenses that keep the meaning. Replace formal/administrative/literary words
  with everyday ones. Keep ALL the information; it may be longer or split into
  two sentences. A learner at the level must understand it.
- **Idioms and figurative phrases -> rewrite by MEANING** (the `pivot_meaning`
  shows the real meaning). Do not reuse the figurative phrase or its images: if
  it says someone "hit the nail on the head", write that they said exactly the
  right thing - no nail, no head.
- **Hide-on-fail:** if the sentence is already simple and literal at the level,
  or you cannot simplify it without risking a grammar mistake or drifting from
  the meaning, send `translation: null`. A missing line is invisible; a wrong or
  un-simplified line is not. Correctness beats simplicity - never ship an
  ungrammatical or meaning-changed rewrite just to fill the field.

## Optional enrichment

Cultural references, extended usage notes and full idiom explanations do not fit
the card fields (meanings are short; the sentence line is a single rewrite). If
the user wants that depth, offer to build a companion lesson with the
`lingochunk-lesson` skill / `save_lesson` on the same episode - it renders
natively alongside the deck.

## Hard rules

- **Ground, do not invent.** Translate the sentences the tools return; take each
  word's sense from its `pivot_meaning`. Never invent words the sentence does
  not contain or attribute content to the recording.
- **One meaning per token, same order, exact length.** A length mismatch is
  rejected per sentence - count the tokens (including the ones that map to
  `""`).
- **Leveled output stays monolingual.** For `en-a2`, `de-b1`, ... every meaning
  and every sentence line is in the source language; never leak the pivot
  language onto a card. Empty leveled sentence -> `null`, never the source or
  pivot sentence.
- **Leveled codes are draft-only.** `add_language` rejects them
  (`agent_only_target`); build them with the draft path.
- **Only the user's own episodes.** Every endpoint is owner-scoped; a submission
  you do not own is a 404. The user's data never goes to any other service.
- **No audio handling.** The sibling reuses the primary's audio and timings
  untouched; you only supply text.

## Lesson and guided editions (translate lessons, not just decks)

A sibling submission starts with NO lessons and no guided path. The edition
tools derive them from the master's, on your tokens, with the target-language
content and every anchor byte-identical by construction: you only ever
receive the meta-language strings ("units") and can only send text per unit
path, so dialogue lines, answers, word banks and positions are physically out
of reach.

Flow for one lesson:

1. `get_lesson` for full context (always read the whole document first).
2. `get_lesson_translation_source(lesson_id, language)` - the units, the
   sibling state and the `version` token.
3. Translate the units (rules below), then
   `put_lesson_translation(lesson_id, language, base_version=version, units)`.
4. On 400, EVERY problem is listed (coverage or per-unit); fix them all and
   retry once. On 409 `stale_document`, the master changed: re-fetch the
   source and re-translate what moved.

Flow for a guided path: `get_guided_translation_source` first; PUT the plan
units (no `section_index`), then translate each section's
`master_lesson_id` through steps 1-3 above but submit with
`put_guided_translation(..., section_index=N, base_version=<that lesson's
version>)`. Sections go in any order; a section already translated is
improved via `update_lesson`, never re-submitted.

### Translation rules (the render/adapt contract)

- **`kind: "render"`** - translate faithfully: instructions, sentence and
  item translations, vocab meanings, titles, objectives, can-do lines.
- **`kind: "adapt"`** - LOCALISE for the new learner language, do not
  translate word-for-word: grammar explanations, Merke/Achtung watch-outs,
  authorial notes, literal glosses, translate-exercise cues. Re-derive the
  contrast for the new pair (a cases explanation aimed at English speakers is
  wrong-footed for Russian speakers), swap false-friend warnings for ones
  that exist in the new pair, keep literal glosses word-for-word in the new
  language's terms, keep a meaning-to-target cue phrased so the FIXED target
  answer stays its natural answer.
- **UNIVERSAL: target-language text passes through unchanged.** B1+ lessons
  write instructions - B2+ everything - in the target language by design.
  If a unit's text is already in the lesson's `language`, return it
  UNCHANGED, whatever its kind. `passthrough_if_target` marks where this is
  structural (MCQ prompt/options can quote target text at any level).
- Respect each unit's `max_length` (translations that run long are rejected,
  all at once). Keep `**bold**`/`*italic*`/backtick marks intact. Keep MCQ
  options and match answers DISTINCT (`unit_collapsed` rejects two options
  that share one translation - an exercise must stay answerable).
- The sibling must exist and be ready first (`add_language` or the draft
  path above); `sibling_transcript_drift` means the primary's transcript was
  edited after the sibling was minted - re-create the language before
  translating lessons onto it.

Editions keep their lineage (`parent_lesson_id`), so re-running a
translation REPLACES an unedited machine edition in place (progress
survives); a hand-edited edition is protected (`translated_copy_edited`) -
improve it with `update_lesson` instead.
