// DEV ONLY — seeds realistic Impromptu and 3-2-1 sessions into Supabase
// (rows + silent recordings) and round-trips them, logging each step. Lets us
// verify the schema/RLS/Storage plumbing AND see the full History → review flow
// on the simulator without a mic. Delete once History is device-verified.

import { File, Paths } from 'expo-file-system';
import {
  saveImpromptuSession,
  saveTtoSession,
  listSessions,
  getSession,
  type ImpromptuSessionData,
  type TtoSessionData,
  type TtoRoundData,
} from './sessions';
import { supabase } from './supabase';
import { computeMetrics, serializeMetrics } from './metrics';
import type { DeepgramWord } from './deepgram';
import type { Shape } from './tto-framework-prompt';
import type { TTOFeedback } from './tto-feedback';

// A tiny but valid 16 kHz mono 16-bit WAV (0.1s of silence) so the audio
// upload + signed-URL path gets exercised, not just the row insert.
function makeSilentWav(): Uint8Array {
  const sampleRate = 16000;
  const numSamples = 1600; // 0.1s
  const dataSize = numSamples * 2;
  const buf = new ArrayBuffer(44 + dataSize);
  const dv = new DataView(buf);
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) dv.setUint8(off + i, s.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  dv.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true); // PCM
  dv.setUint16(22, 1, true); // mono
  dv.setUint32(24, sampleRate, true);
  dv.setUint32(28, sampleRate * 2, true); // byteRate
  dv.setUint16(32, 2, true); // blockAlign
  dv.setUint16(34, 16, true); // bitsPerSample
  writeStr(36, 'data');
  dv.setUint32(40, dataSize, true);
  return new Uint8Array(buf);
}

// Turn a sentence into timed DeepgramWords (with one injected pause) so
// computeMetrics returns a full, not-too-short result.
function makeWordsFrom(sentence: string): DeepgramWord[] {
  const tokens = sentence.split(' ');
  const words: DeepgramWord[] = [];
  let t = 0.5;
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    const dur = 0.3 + (tok.length > 5 ? 0.15 : 0);
    words.push({
      word: tok.toLowerCase(),
      punctuated_word: tok,
      start: Math.round(t * 100) / 100,
      end: Math.round((t + dur) * 100) / 100,
      confidence: 0.95,
    });
    t += dur + 0.06;
    if (i === 7) t += 1.3; // a deliberate pause to exercise pause detection
  }
  return words;
}

// Write a fresh silent WAV to cache and return its uri.
function writeSilentWav(name: string): string {
  const file = new File(Paths.cache, name);
  if (file.exists) file.delete();
  file.create();
  file.write(makeSilentWav());
  return file.uri;
}

const IMPROMPTU_ANSWER =
  'So um the one habit that really changed my mornings was making my bed first thing you know it sounds small but like it sets the tone for the entire day';

async function seedImpromptu(): Promise<string> {
  const audioUri = writeSilentWav('dev-test-impromptu.wav');
  const words = makeWordsFrom(IMPROMPTU_ANSWER);
  const durationSec = Math.ceil(words[words.length - 1].end + 0.5);

  const data: ImpromptuSessionData = {
    transcript: words.map((w) => w.punctuated_word ?? w.word).join(' '),
    words,
    durationSec,
    impromptuPrompt: "What's a small habit that improved your day?",
    impromptuTopic: 'everyday',
    impromptuType: 'story',
    aiFeedback:
      'Good pick — you stayed on one habit instead of listing five, which keeps it easy to follow. Watch the "um" and "like"; trimming those would make you sound more sure. Nice close on the last line.',
    aiFeedbackError: false,
    aiScore: 7,
    metrics: serializeMetrics(computeMetrics(words, null, durationSec)),
  };

  return saveImpromptuSession({ data, audioUri });
}

const TTO_FIXTURE: {
  shape: Shape;
  prompt: string;
  answer: string;
  score: number;
  feedback: string;
}[] = [
  {
    shape: 'one-thing',
    prompt: 'Tell us about a tool you rely on.',
    answer:
      'The one tool I lean on most is a plain notebook I keep on my desk so um whenever a thought shows up I write it down and get it out of my head and that single habit keeps me from losing the small ideas that matter most',
    score: 7,
    feedback:
      'You stayed on a single tool the whole way, which is exactly what 1 Thing asks for. The "um" early was the only stumble. Focused, easy to follow.',
  },
  {
    shape: 'two-types',
    prompt: 'Describe how people approach learning.',
    answer:
      'There are basically two ways people learn like the first is diving in and breaking things to see what happens and the second is reading everything first before they touch anything and you know most people lean one way but the best mix both',
    score: 6,
    feedback:
      'You named two clear types and gave each its own space. The contrast blurred at the end — tightening the last line into its own beat would land it better.',
  },
  {
    shape: 'three-steps',
    prompt: 'Walk through how you start a project.',
    answer:
      'First I write down the single outcome I want so I know what done looks like then I break it into the smallest first step I can take today and third I block time on the calendar so it actually happens instead of sitting on a list',
    score: 8,
    feedback:
      'Clean first / then / third structure — each step earned its place and the pace stayed steady. Your strongest round.',
  },
];

async function seedTto(): Promise<string> {
  const audioUri = writeSilentWav('dev-test-tto.wav');

  const rounds: TtoRoundData[] = TTO_FIXTURE.map((f) => {
    const words = makeWordsFrom(f.answer);
    const durationSec = Math.ceil(words[words.length - 1].end + 0.5);
    return {
      shape: f.shape,
      prompt: f.prompt,
      transcript: words.map((w) => w.punctuated_word ?? w.word).join(' '),
      words,
      durationSec,
      metrics: serializeMetrics(computeMetrics(words, null, durationSec)),
    };
  });

  const feedback: TTOFeedback = {
    rounds: [
      { score: TTO_FIXTURE[0].score, feedback: TTO_FIXTURE[0].feedback },
      { score: TTO_FIXTURE[1].score, feedback: TTO_FIXTURE[1].feedback },
      { score: TTO_FIXTURE[2].score, feedback: TTO_FIXTURE[2].feedback },
    ],
  };

  const data: TtoSessionData = { rounds, feedback, feedbackError: '' };
  // Reuse the same silent file for all three rounds; saveTtoSession uploads
  // each to its own round-{i}.wav path.
  return saveTtoSession({ data, roundAudioUris: [audioUri, audioUri, audioUri] });
}

// DEV ONLY — seed `count` impromptu sessions spread across the last `spanDays` days,
// inserted DIRECTLY with backdated created_at + local_date (the save helpers hardcode
// today), so the Profile "All time" chart's time-bucketing + adaptive unit can be
// exercised. The BEFORE INSERT trigger auto-populates the pace/fillers/pauses columns
// from `data.metrics`. Score trends 4 → 9 across the span so the line visibly "improves".
// The adaptive unit is chosen from the FULL history span, so to test day (≤42d) / week
// (≤420d) / month, seed ONE span at a time (clear via /history bulk-delete between runs)
// — e.g. devSeedSpanSessions(30) → day, (200) → week, (1100) → month.
export async function devSeedSpanSessions(spanDays = 200, count = 40): Promise<void> {
  const { data: userRes } = await supabase.auth.getUser();
  const userId = userRes.user?.id;
  if (!userId) throw new Error('not signed in');

  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;

  const rows = Array.from({ length: count }, (_, i) => {
    const frac = count <= 1 ? 1 : i / (count - 1); // 0 (oldest) → 1 (newest)
    const when = new Date(now - (1 - frac) * spanDays * dayMs);
    const words = makeWordsFrom(IMPROMPTU_ANSWER);
    const durationSec = Math.ceil(words[words.length - 1].end + 0.5);
    const score = Math.round((4 + frac * 5) * 10) / 10; // 4.0 → 9.0
    const data: ImpromptuSessionData = {
      transcript: words.map((w) => w.punctuated_word ?? w.word).join(' '),
      words,
      durationSec,
      impromptuPrompt: 'Seeded span session',
      impromptuTopic: 'everyday',
      impromptuType: 'story',
      aiFeedback: 'Seeded.',
      aiFeedbackError: false,
      aiScore: score,
      metrics: serializeMetrics(computeMetrics(words, null, durationSec)),
    };
    return {
      user_id: userId,
      mode: 'impromptu',
      score,
      duration_sec: durationSec,
      prompt: data.impromptuPrompt,
      custom_title: null,
      data,
      favorite: false,
      created_at: when.toISOString(),
      local_date: when.toLocaleDateString('en-CA'), // YYYY-MM-DD, device-local (matches deviceLocalDate)
    };
  });

  const { error } = await supabase.from('sessions').insert(rows);
  if (error) throw error;
  console.log(`[dev-seed-span] inserted ${count} sessions over ${spanDays} days`);
}

export async function devTestSessions(): Promise<void> {
  console.log('[dev-test-sessions] seeding…');

  const impromptuId = await seedImpromptu();
  console.log('[dev-test-sessions] saved impromptu id:', impromptuId);

  const ttoId = await seedTto();
  console.log('[dev-test-sessions] saved tto id:', ttoId);

  const list = await listSessions();
  console.log(`[dev-test-sessions] listSessions → ${list.length} rows`);

  // Confirm each re-fetches with a signed audio URL.
  const imp = await getSession(impromptuId);
  const tto = await getSession(ttoId);
  console.log(
    '[dev-test-sessions] getSession →',
    JSON.stringify(
      {
        impromptu: {
          mode: imp?.mode,
          gotAudioUrl: imp?.mode === 'impromptu' ? !!imp.audioUrl : undefined,
        },
        tto: {
          mode: tto?.mode,
          rounds: tto?.mode === 'tto' ? tto.data.rounds.length : undefined,
          gotAudioUrls:
            tto?.mode === 'tto'
              ? tto.roundAudioUrls.filter(Boolean).length
              : undefined,
        },
      },
      null,
      2,
    ),
  );

  console.log('[dev-test-sessions] done ✅ — open the Profile tab to see both.');
}