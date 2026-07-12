# LingoChunk for creators

*Turn the audio you already make into an interactive course your audience can
study - with your notes on the phrases that matter, coursebook-style lessons,
flashcards with your real voice, and translations in the languages your
subscribers actually speak. An AI agent does the heavy lifting; you direct it
in plain English.*

This guide is for podcasters, YouTubers and teachers who publish audio in the
language they teach. It assumes no programming. Everything below is done by
typing requests to an AI assistant (Claude, ChatGPT, Le Chat, ...) connected
to your LingoChunk account.

---

## 1. The idea in one minute

You already own the hard part: the audio, the voice your audience trusts, and
the editorial judgement about what is worth teaching. What your listeners are
missing is a way to *study* your episodes rather than just play them.

LingoChunk is that study layer. Upload an episode once and it becomes an
interactive workspace: a transcript synced to the audio word by word,
tap-to-study vocabulary, native-audio flashcards with spaced repetition, and a
record-and-compare shadowing practice built around *your* voice - not a robot
voice.

On top of that sits the part this guide is really about. LingoChunk speaks
[MCP](https://modelcontextprotocol.io), the standard that lets AI assistants
use tools. Connect your AI assistant to your LingoChunk account and you can
say things like:

> "Go through episode 12, find the idioms and fixed phrases my students
> can't decode word by word, and attach a short note to each."

> "Build a B1 lesson from the first five minutes of episode 12 and publish
> it to my channel."

> "Break this episode into a four-lesson course that ramps from A2 to B1."

> "Add Polish, Turkish and Ukrainian versions so my subscribers can study
> with translations in their own language."

The agent does the reading, selecting, composing and formatting. LingoChunk
checks every claim against your real transcript (an agent cannot misquote
you - the server rejects anything that is not verbatim from your episode) and
renders the result natively in the app, with your real audio.

Two things this is *not*:

- **It is not text-to-speech.** Every play button, flashcard clip and
  shadowing line plays your original recording.
- **It is not a content free-for-all.** Everything is scoped to episodes you
  own. Publishing is explicit and per item; nothing becomes visible to your
  audience unless you say so.

## 2. What your audience gets

Your channel lives at `https://lingochunk.com/c/<your-slug>` - a branded
landing page (logo, header, tagline, link back to your site) listing your
published episodes. For each episode, a visitor gets four tabs:

| Tab | What it is |
|---|---|
| **Listen** | The transcript synced to your audio: tap a sentence to hear it, loop it, slow it down, record themselves and compare against you. Your creator notes appear here as highlighted phrases with an explanation sheet. |
| **Words** | Every word from the episode with meanings, gender and CEFR level, ready to study. |
| **Cards** | A spaced-repetition deck cut from your audio: real sentences, native-audio clips, highlight/blur cards. Downloadable as an Anki deck. |
| **Lessons** | The lessons you published for that episode (built with this guide): audio exercises, dictation, shadowing, grammar boxes, an AI tutor on tap. |

Access is up to you, per collection:

- **Public**: anyone with the link can study it - no account needed.
- **Unlisted**: same, but only people you give the link to.
- **Private**: members only. You share self-serve invite links
  (`lingochunk.com/join/<token>`), which is how you gate content to
  subscribers, Patreon supporters, or a class.

## 3. Set up once (about 15 minutes)

### 3.1 Get a creator account

Any LingoChunk account can process its own audio privately. The creator
powers - a public channel and creator annotations - are enabled per account.
If you don't have them yet, get in touch and we will switch your account on.

### 3.2 Upload and publish your episodes

In the app: add your audio (upload a file or record), let it process
(transcription, word analysis and translations happen once, at upload), then
add the episode to your collection. Processing is the only step that takes
real time; everything after it is instant.

### 3.3 Connect your AI assistant

The MCP server is hosted at **`https://lingochunk.com/mcp`**. Nothing to
install; you add it to your assistant and sign in.

| Your assistant | How to connect |
|---|---|
| **claude.ai** (web, desktop, mobile - including the free plan) | Settings → Connectors → *Add custom connector* → URL `https://lingochunk.com/mcp`. A LingoChunk sign-in screen opens; approve and you are connected. |
| **Claude Code** (terminal or web) | `claude mcp add --transport http lingochunk https://lingochunk.com/mcp` and sign in on first use. Or install the plugin (`/plugin marketplace add lingochunk/lingochunk-mcp`, then `/plugin install lingochunk@lingochunk-mcp`), which also bundles the authoring skills. |
| **ChatGPT** (paid plans) | Settings → enable *Developer mode* → Apps → "+" → the URL above. |
| **Mistral Le Chat** | *+ Add Connector* → Custom MCP Connector → the URL above. |
| **Anything else that speaks MCP** | Add a custom connector/server by URL; sign in via OAuth or paste a personal access token (Settings → API tokens in LingoChunk). |

When you sign in, LingoChunk shows a consent screen listing exactly what the
assistant may do (read your content, save lessons, write annotations, ...).
The grant appears in **Settings → API tokens** and you can revoke it there at
any time, like any other token.

Scopes, if you use a token instead of the sign-in flow:

| You want to | Grant |
|---|---|
| Read episodes, transcripts, vocabulary | `content:read`, `vocab:read` |
| Build and publish lessons and courses | `lessons:write` |
| Add creator notes | `annotations:write` |
| Add languages / translations | `translations:write` |
| Make flashcards, export Anki decks | `cards:write`, `decks:export` |

### 3.4 Say hello

Type this to your assistant:

> "List my LingoChunk library."

If it answers with your episodes, you are ready. Everything below is a
conversation from here on.

---

## 4. The creator workflows

Five workflows, from lightest to most ambitious. Each one ends with something
your audience can use.

### 4.1 Annotate the phrases that matter

**What it is.** You know which expressions in your episode a learner cannot
decode word by word: idioms, phrasal verbs, strong collocations, discourse
markers, cultural references. Creator annotations attach your short note to
the exact phrase in the transcript. Your audience sees the phrase highlighted
on the Listen tab; tapping it opens the note, with a play button for that
exact span of your audio. Followers also get each note as a study card.

**Say this:**

> "Go through 'Episode 12 - Der Umzug' and annotate the genuinely useful
> expressions: idioms, phrasal verbs, fixed phrases, discourse markers and
> cultural references my students couldn't work out word by word. Write the
> notes in simple German, one level below the episode. Stay around 25 notes."

**What the agent does.** It reads the transcript, picks the spans worth a
note (it is instructed to skip ordinary hard words - the vocabulary deck
already covers those), anchors each note to the exact characters of the
phrase, and writes a four-line note per expression:

```
**den Ball flach halten** - informal
to keep things calm; not take a risk or make a fuss
Here: he is telling the team not to overreact to the news.
Example: Bleib ruhig und halt den Ball flach, bis wir mehr wissen.
```

The audio timing for each note is derived server-side from your transcript's
word timings, so the note's play button just works.

**Best practices**

- **15 to 40 notes per episode.** Enough to catch what learners trip on,
  without burying the transcript in highlights. The cap is 200 per episode;
  do not aim for it.
- **Notes in the target language, one level down.** A B1 episode gets notes
  a strong A2 learner can read. Ask for the learners' native language only
  if your audience is at beginner level.
- **Annotate a recurring expression once**, at its clearest occurrence.
- **Review in the app afterwards.** Open the episode's Listen tab, tap
  through the highlights, and ask the agent to reword or delete any note you
  would phrase differently. It can update a note in place.

### 4.2 Build a lesson from an episode

**What it is.** A coursebook-style lesson built from a slice of your episode:
Listen → Text → Vocabulary → Grammar → Exercises → Review. The app renders it
natively: play buttons on every exercise, tap-to-reveal dialogue translations,
gap-fills that check themselves, dictation that plays your audio and diffs
the learner's typing, shadowing that records the learner and plays them back
against you, and an AI tutor mounted on the grammar box and glossary. There
is also a printable offline worksheet download.

**Say this:**

> "Build a B1 lesson from the first five minutes of 'Episode 12 - Der
> Umzug'. Pick one grammar point the audio actually demonstrates. Include a
> dictation and end with shadowing practice."

**What the agent does.** It pulls the transcript slice with sentence timings,
picks one grammar point evidenced in the audio, selects exercise types suited
to the point and the level (the exercise menu has fourteen archetypes, from
minimal-pair listening questions to backward build-up drills borrowed from
FSI courses), composes the lesson document, validates it against your real
transcript, saves it and gives you a link to open it in the app.

Every quoted line is your transcript verbatim; the server rejects the lesson
otherwise. Every exercise anchors to real sentences, so play buttons play the
actual moment in your episode.

**Best practices**

- **3 to 8 minutes of audio per lesson.** A whole 45-minute episode makes a
  bad lesson; a coherent scene makes a great one. Name the time range or the
  scene in your request.
- **One grammar point per lesson.** Depth beats coverage. A second point is
  a second lesson.
- **Name the level** (A1 to C2). It drives the exercise mix, the instruction
  language and the glossary depth.
- **Ask for variety across lessons** ("use different exercise types from
  last time") so consecutive lessons don't feel identical. Dictation and
  shadowing are the crowd-pleasers; they only exist because the audio is
  yours and real.
- **Work through the lesson yourself once** before publishing, exactly as a
  student would. It is the fastest quality check there is.

### 4.3 Publish lessons to your audience

**What it is.** Lessons are private to you by default. Published lessons
appear in the episode's Lessons tab for everyone who can view it: followers
of your collection, invite-link members for a private one, or anyone at all
for a public one (no account required).

**Say this** (as part of any lesson request, or afterwards):

> "Publish that lesson to my channel."

The agent saves the lesson with public visibility. Publishing only works on
episodes you own, and only for native lessons (never raw HTML), so nothing
can smuggle content into your channel.

**Best practices**

- **Draft privately, publish deliberately.** Iterate with the agent until
  the lesson is right, then publish the final version. A published lesson
  can be replaced: ask the agent to read it back, revise, publish the new
  one and delete the old.
- **Tell your audience where to look.** A published lesson lives at the
  episode's Lessons tab; the agent gives you the exact link. Put it in your
  show notes or video description.

### 4.4 Turn an episode or a season into a course

**What it is.** A course is a named, ordered series of lessons. One rich
20-minute episode honestly supports 3 to 5 lessons; a season of episodes
supports a real curriculum. Each lesson gets a different grammar point and
the difficulty ramps across the series.

**Say this:**

> "Turn 'Episode 12 - Der Umzug' (18 minutes) into a four-lesson course.
> Start at A2 and finish at B1, a different grammar point per lesson, and
> vary the exercise types. Create the course, build the lessons in order,
> and publish them all to my channel."

**What the agent does.** It inventories the episode for natural seams (scene
changes, speaker turns, runs of sentences sharing a grammar pattern), plans
the arc, creates the course, then builds and files each lesson in sequence.
You get the course as an ordered list of links.

**Best practices**

- **Let the material set the length.** The agent defaults to what the audio
  honestly supports. Fifteen thin lessons from one episode is worse than
  four substantial ones.
- **State the ramp** ("A2 for lessons 1-2, B1 for 3-4") or let the agent
  propose one and say which it picked.
- **Courses are regroupable.** Deleting a course never deletes its lessons;
  they just become standalone again.

### 4.5 Speak your audience's languages

**What it is.** Your episode's study materials (sentence translations and
per-word meanings, which drive the decks and tap-to-translate) can exist in
many languages at once. Each added language becomes a sibling version of the
episode, so a Polish-speaking and a Turkish-speaking subscriber both study
your German audio with support in their own language.

Two ways to add languages:

**The built-in way** (fastest, costs you nothing):

> "Add Polish, Turkish and Ukrainian to 'Episode 12 - Der Umzug'."

LingoChunk translates server-side and the agent polls until the new versions
are ready. One request handles up to ten languages.

**The hand-crafted way** (the agent translates, sentence by sentence):

> "Translate 'Episode 12' into Polish yourself, then commit it."

Here your AI assistant writes every sentence translation and every word
meaning, guided by LingoChunk's per-word sense data (so it never picks the
wrong homonym), uploads them in batches, and commits. Use it when you want
editorial control over the translation register, or for the one thing the
built-in path cannot do:

**Simplified same-language versions.** A leveled code like `de-a2` produces
a version of your *German* episode glossed in *simpler German*: every hard
word explained with an everyday synonym, every complex sentence rewritten
plainly, and your original audio untouched. It is a graded reader built from
your own show:

> "Make a simplified German (A2) version of 'Episode 12' so my lower-level
> listeners can study it without leaving German."

**Best practices**

- **Start with your audience's top two or three languages.** Ask your
  subscribers; you can add more any time.
- **Prefer the built-in path for ordinary languages.** It is validated,
  fast and free. Reserve the hand-crafted path for leveled versions and for
  languages where you want a specific register.
- **A half-finished draft is resumable.** The agent can list in-progress
  drafts and continue where it left off, or discard one cleanly.

### 4.6 Flashcards and Anki decks

**What it is.** Every processed episode already has a deck. Beyond that, the
agent can craft specific cards: an idiom with your audio clip, a grammar card
that blurs exactly the morpheme being tested, a contrast card for
confusables. Cards look exactly like the app's own: real sentence, highlight
or blur, native audio, forward and reverse pairs. Any deck exports to Anki
as `.apkg`, and followers can download a published episode's deck
themselves.

**Say this:**

> "Make flashcards for the ten expressions you annotated in episode 12, and
> a grammar card for each Perfekt-with-sein example. Then export the deck to
> Anki and give me the download link."

**Best practices**

- **One card, one thing.** The agent follows a strict quality rubric
  (unambiguous front, one target per card, no wall-of-text backs) distilled
  from the known failure modes of AI-generated cards. If a card idea has no
  clean verbatim sentence in your episode, the agent skips it and says so;
  that is correct behaviour, not laziness.
- **Cards pair well with annotations.** Annotate first, then ask for cards
  from those expressions: your students see the note in context and drill
  the same phrasing in their deck.

---

## 5. A worked afternoon

Here is a realistic session that takes one 18-minute episode to a published,
multi-language mini-course. Total hands-on time: roughly an hour of
conversational back-and-forth, most of it reviewing.

1. > "List my library. I want to work on 'Episode 12 - Der Umzug'."

2. > "Annotate its useful expressions - notes in simple German, about 25 of
   > them."

   *Review pass:* open the Listen tab, tap through the highlights, tweak two
   notes ("reword the note on 'na ja', it's too academic").

3. > "Now turn the episode into a four-lesson course, A2 ramping to B1, a
   > different grammar point per lesson. Build them but keep them private
   > for now."

   *Review pass:* work through lesson 1 in the app as a student. Ask for
   changes ("the dictation sentences in lesson 2 are too long, pick shorter
   ones").

4. > "Lessons look good. Publish all four to my channel."

5. > "Add Polish and Turkish versions of the episode."

6. > "Export the episode deck to Anki and give me the link for my show
   > notes."

7. Put the links in your show notes: the episode on your channel, the
   course, the Anki deck. Done.

Your subscribers now have, from one episode: a synced interactive transcript
with your 25 notes, a four-lesson course with dictation and shadowing in
your voice, study support in three languages, and a downloadable Anki deck.

---

## 6. The craft: best practices that make the difference

The agent already follows LingoChunk's authoring guides (they are built into
the connection). These are the practices *you* control, and they separate a
good channel from a great one.

**Trust the grounding, spend your time on judgement.** You never need to
check whether a quote is real: the server rejects misquotes, invented
positions and out-of-range audio. What the machine cannot judge is *taste*:
which scene makes the best lesson, which note is worth a learner's
attention, whether an exercise is fun. Spend your review time there.

**Give the agent editorial direction, not formatting instructions.** "Make
lesson 2 more playful", "my audience is commuters, keep exercises tappable",
"never quiz on swearing" all work. The formatting is fixed by the lesson
schema; the pedagogy is steerable.

**Pitch one level below your content.** Notes, instructions and simplified
versions land best when a learner slightly below your episode's level can
follow them comfortably.

**Iterate in drafts.** Lessons are immutable once saved; revising means
saving a new one and deleting the old, and the agent handles that loop for
you. Keep drafts private, publish winners, and ask the agent to clean up
abandoned attempts (there is a 100-lesson cap per account, so hygiene
matters).

**Re-run, don't restart.** An episode can hold many lessons side by side,
and each lesson records which skill built it. Adding a new lesson type to an
old episode is one sentence: "add a dictation-only micro-lesson to episode
3."

**Mind the pace limits.** Lesson saves are capped at 60 per hour and the
whole API at 1000 calls per hour per connection: irrelevant for normal use,
noticeable only if you ask for a 30-lesson bulk build in one go. Batch big
jobs episode by episode.

## 7. Who pays for what

Worth being clear about, because the answer is unusually good for creators:

- **LingoChunk does the expensive processing once, at upload**:
  transcription, word analysis, base translations. Your audience studying
  the results costs you nothing more.
- **The built-in language fan-out runs on LingoChunk**, not on your AI
  subscription.
- **Everything the agent composes** (annotations, lessons, courses, cards,
  hand-crafted translations) runs on your AI assistant's subscription, which
  you already have. LingoChunk validates and renders it without any
  additional AI spend.

## 8. Your content, your control

The trust model, in plain words:

- **Owner-scoped everywhere.** The agent can only annotate, teach from and
  translate episodes *you own*. Someone else's account cannot touch your
  content, and your connection cannot touch theirs.
- **Publishing is explicit.** Lessons default to private. An episode is only
  visible where you published it. Private collections are member-gated with
  invite links you can revoke.
- **Every connection is revocable.** Settings → API tokens lists every
  grant; revoke one and that assistant is out, immediately.
- **Your data stays in the loop.** The authoring guides forbid the agent to
  send your content to any service other than LingoChunk, and the server
  never shares it. Attribution flows to you: the channel is branded, links
  back to your site, and is the canonical home of your interactive content.

## 9. Common bumps

| Symptom | What it means | Fix |
|---|---|---|
| The agent says a scope is missing (403) | The connection was granted narrow permissions | Reconnect and approve the scope, or mint a token with it (Settings → API tokens) |
| "publish_not_submission_owner" | Publishing was attempted on an episode you don't own | Publish only your own episodes |
| A lesson save is rejected with `dialogue_mismatch` or `unknown_positions` | The agent misquoted or mis-referenced the transcript | Nothing for you to do: it re-fetches and fixes; this is the grounding working |
| "lesson_cap" (409) | You have 100 saved lessons | Ask the agent to list lessons and delete stale drafts |
| A language commit reports missing sentences (409) | The hand-crafted draft is incomplete | The agent uploads the listed positions and commits again |
| An annotation shows as *stale* | You edited the transcript under it | Ask the agent to re-anchor: delete and recreate the note |
| Nothing works and you use the token URL form | The token may be revoked or short-scoped | Prefer OAuth sign-in; if you must embed a token in the URL, treat that URL as a password |

## 10. Going further

- **Invent your own lesson format.** The authoring skills are open source
  and plain markdown: a dictation-first drill, an exam rehearsal, a
  listening-comprehension pass with no reading. If you can describe the
  pedagogy, you (or your agent) can write the skill. See
  [CONTRIBUTING.md](../CONTRIBUTING.md) and
  [skill-authoring.md](skill-authoring.md); community skills are welcomed by
  PR, and lessons display which skill built them.
- **For developers**: everything here is an open, documented HTTP API. The
  machine-readable spec lives at `https://lingochunk.com/api/v1/openapi.json`
  and a committed copy with this repo
  ([spec/openapi-public-v1.json](../spec/openapi-public-v1.json)).
- **Using an assistant we didn't list?** Any MCP-capable agent works, and it
  can pull the same authoring guidance itself (the `get_authoring_guide`
  tool serves it). The quality contract is enforced server-side, so the
  results hold no matter which agent is driving.

---

*Questions, creator-account requests, or an episode you would like us to
build out as a demo of your channel: get in touch.*
