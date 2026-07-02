// Live smoke test against a REAL LingoChunk API. It makes real authenticated
// requests, so it is NOT part of the automated test suite and must never run in
// CI. Use it by hand to confirm the request/response shapes against a running
// server.
//
// Usage:
//   npm run build
//   LINGOCHUNK_TOKEN=lcp_... [LINGOCHUNK_BASE_URL=http://localhost:8000] \
//     node --experimental-strip-types scripts/smoke.ts
//
// It imports the built client from dist/, so build first. One line per step:
// list_library -> first submission -> transcript slice -> audio-url ->
// vocab page -> lookup of a returned lemma -> search -> a 2-second clip.
import { LingoChunkClient } from "../dist/client.js";
import { loadConfig } from "../dist/config.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const client = new LingoChunkClient(config);
  console.log(`base: ${config.baseUrl}`);

  const library = (await client.listLibrary({ limit: 5 })) as {
    items?: { id?: string; learning_language?: string }[];
  };
  console.log(`list_library: ${library.items?.length ?? 0} items`);
  const submission = library.items?.[0];
  if (!submission?.id) {
    console.log("stop: no submissions in the library");
    return;
  }
  const submissionId = submission.id;
  const language = submission.learning_language ?? "de";
  console.log(`using submission ${submissionId} (${language})`);

  const transcript = (await client.getTranscript(submissionId, {
    to_sentence: 3,
  })) as { transcript_state?: string; sentences?: unknown[] };
  console.log(
    `get_transcript: state=${transcript.transcript_state} sentences=${transcript.sentences?.length ?? 0}`,
  );

  const audio = (await client.getAudioUrl(submissionId)) as { url?: string };
  console.log(`get_audio_url: ${audio.url ? "ok" : "no url"}`);

  const vocab = (await client.getVocabulary({ language, limit: 5 })) as {
    items?: { lemma?: string; language?: string }[];
  };
  console.log(`get_vocabulary: ${vocab.items?.length ?? 0} items`);

  const word = vocab.items?.[0];
  if (word?.lemma) {
    const lookup = await client.lookupWord({
      lemma: word.lemma,
      language: word.language ?? language,
    });
    console.log(`lookup_word(${word.lemma}): ${JSON.stringify(lookup).slice(0, 120)}`);
    const search = (await client.searchExamples({
      lemma: word.lemma,
      limit: 3,
    })) as { hits?: unknown[] };
    console.log(`search_examples(${word.lemma}): ${search.hits?.length ?? 0} hits`);
  } else {
    console.log("lookup_word/search_examples: no vocab lemma to use");
  }

  const clip = await client.getAudioClip(submissionId, 0, 2);
  console.log(`get_audio_clip: ${clip.data.byteLength} bytes ${clip.contentType}`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
