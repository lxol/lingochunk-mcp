---
name: lingochunk-annotate
description: Find the genuinely useful expressions in one of the user's own LingoChunk episodes (idioms, phrasal verbs, collocations, discourse markers, culture-bound references) and attach a short markdown creator note to each exact span. Owners see the note as a tint + bottom sheet on the Listen tab; followers get it as a forward-only note card. Use when the user asks to find or annotate useful expressions in an episode, highlight idioms or phrases, or add creator notes to a lesson.
---

# LingoChunk expression annotator

Read one of the creator's own episodes and mark the expressions a learner
genuinely cannot decode word by word, attaching a short markdown note to each.
LingoChunk keeps the transcript, timings and word analysis; the only work here is
judgement (which spans are worth a note) and writing (a tight explanation for the
creator's students). The app renders every note natively: the owner sees an
iris tint on the span plus the note in a bottom sheet, and followers of the
collection get the note as a forward-only card. No new audio, no UI to build.

This skill uses the `lingochunk` MCP tools. If they are not available, tell the
user to add the LingoChunk MCP server (see the plugin README) and stop.

## When to use

- "Find the useful expressions in this episode and annotate them."
- "Highlight the idioms and phrasal verbs in episode X."
- "Add creator notes to my lesson so my students get the phrasing, not just the
  words."
- "Go through this recording and explain the fixed phrases."

## Who and what this is for

- **Owner + creator tier only.** Every annotation endpoint is owner-scoped; an
  episode the user does not own is a 404. Creating notes needs the
  `annotations:write` scope (edit-transcripts feature); reading needs
  `content:read`. The user's data never goes to any other service.
- **Write for the students, not the creator.** These notes become follower
  cards and the owner's own study sheet. Pitch them as if teaching a learner who
  is a level below the episode's audience, not as notes-to-self.

## What counts as a useful expression (annotate these)

Annotate a span only when a learner who knows the individual words would still
miss the meaning:

- **Idioms and figurative phrases** ("den Ball flach halten", "hit the nail on
  the head").
- **Phrasal verbs whose meaning is not the sum of the parts** ("give up",
  "auf jemanden zugehen").
- **Strong collocations and fixed phrases** the learner should learn as a unit
  ("make a decision" not "do a decision"; "eine Entscheidung treffen").
- **Discourse markers and fillers doing real conversational work** ("doch",
  "na ja", "I mean", "you know") - the ones that steer the turn, not literal
  content.
- **Culture-bound references** a learner cannot look up word by word (a TV show,
  an institution, a local custom named in passing).

## What does NOT count (skip these)

- **Ordinary single words.** The vocabulary deck already covers them; a note per
  hard word is clutter. Annotate a word only when it is part of a larger
  non-transparent expression.
- **Proper names** (people, places, brands) with no idiomatic twist.
- **Anything transparent** - a phrase whose meaning is exactly its words. If the
  student can decode it from the words plus the sentence translation, leave it.

## Density: quality over coverage

- **Typically 15 to 40 notes per episode.** That is enough to catch the phrasing
  a learner would trip on without burying the transcript in tint.
- **Check the budget first.** `list_annotations` returns `count` and
  `max_annotations` (the per-episode cap). Never carpet-bomb toward the cap;
  a note on every other line is noise, and once you are near the cap the creator
  cannot add their own.
- **Do not re-annotate.** Read the existing notes first (`list_annotations`) and
  skip expressions that already have one.
- **Annotate a recurring expression once.** If the same idiom appears several
  times, annotate the clearest instance and say "appears several times in this
  episode" in the note, rather than tinting every occurrence.

## Workflow

1. **See what exists and your budget.** `list_annotations(submission_id)`. Note
   `count` vs `max_annotations`, and read the existing notes' `selected_text` so
   you do not duplicate them. A note with `stale: true` was left dangling by a
   later transcript edit - offer to replace or `delete_annotation` it.
2. **Pull the transcript.** `get_transcript(submission_id, ...)` (slice by
   sentence or time range for a long episode). Only `transcript_state: "ready"`
   is usable. Each sentence carries a stable `sentence_id` and its `display`
   string - both are what you anchor to.
3. **Select the expressions** worth a note using the rules above. Prefer depth
   over breadth: the twenty phrases a learner would actually stumble on beat
   forty obvious ones.
4. **Anchor each one.** For every expression, compute the **code-point offsets**
   of the EXACT span inside that sentence's `display`:
   - Offsets are Unicode code points (Python string semantics), NOT UTF-16
     units. In JavaScript, `[...display].slice(start, end).join("")` counts code
     points correctly; `display.slice(start, end)` / `indexOf` do NOT beyond the
     BMP (an emoji or some rare CJK counts as 1 code point but 2 UTF-16 units).
   - Prefer the **tightest span** that covers the expression (just "den Ball
     flach", not the whole clause). Use a **whole-sentence note** (omit
     `char_start`/`char_end`) only when the entire line IS the expression.
5. **Create it.** `create_annotation(submission_id, sentence_id, char_start,
   char_end, note)`. Leave `start_time`/`end_time` unset: the server derives
   the span's audio times from the transcript's word timings, so the note
   sheet's Play button and the deck-card clip work without them.
6. **Verify the span.** The response echoes `selected_text` =
   `display[char_start:char_end]`. Check it equals the expression you meant. On a
   mismatch your offsets were off (usually a UTF-16 vs code-point miscount):
   `delete_annotation` that note and create it again with corrected offsets. Do
   not leave a note on the wrong span.
7. **Deliver.** Tell the user how many notes you added and what they cover, and
   remind them the notes are live for the owner (tint + sheet on Listen) and for
   followers (forward-only note cards).

To reword a note without moving it, use `update_annotation` (note only). To
move a span, `delete_annotation` and create it again.

## Note format

The note is markdown (up to 5000 chars, but keep it to **~4 short lines** - it
renders in a bottom sheet, not an essay). Use this shape:

```
**<the expression>** - <register tag, e.g. informal, British, formal>
<one plain-language line: what it means>
Here: <how it is used in THIS sentence>
Example: <one fresh sentence using the expression naturally>
```

Optionally add a fifth line on close variants ("also heard as ...") when it
helps. Keep each line short. Write the meaning line so a learner a level below
the episode's audience understands it - no jargon, no re-using the hard word to
explain itself.

Example (a German B1 episode):

```
**den Ball flach halten** - informal
to keep things calm; not take a risk or make a fuss
Here: he is telling the team not to overreact to the news.
Example: Bleib ruhig und halt den Ball flach, bis wir mehr wissen.
```

## Language

- **Default to the episode's own language**, in a simpler register - roughly one
  CEFR level below the lesson's audience. A B1 episode gets notes a strong A2
  learner can read. This keeps the student inside the target language.
- **Override to the learner's native language** only when the user asks for it
  (e.g. "explain them in English for my beginners"). Then write the whole note
  in that language.

## Hard rules

- **Ground, do not invent.** Annotate expressions that actually occur in the
  transcript the tools return; take the meaning from the sentence and its
  translation. Never attribute phrasing the recording does not contain.
- **Tightest real span.** Anchor the expression itself, not the surrounding
  clause; whole-sentence notes are for lines that are entirely the expression.
- **Verify every span.** Always check the returned `selected_text`; fix a
  mismatch with delete + recreate before moving on.
- **Budget, do not flood.** Stay in the 15 to 40 range, well under
  `max_annotations`; skip words the vocabulary deck already carries.
- **Only the user's own episodes.** Owner-scoped; a foreign submission is a 404.
- **No audio handling.** The note anchors to text; the server derives the
  audio span from the transcript, so never send times yourself.
