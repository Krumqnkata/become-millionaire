/**
 * Records the host's voice with Azure neural text-to-speech (bg-BG-BorislavNeural).
 *
 *   npm run voice:plan              # what would be recorded – no Azure account needed
 *   npm run voice                   # record everything that is new or changed
 *   npm run voice -- --only=lines   # just the host's lines (≈ 2 minutes)
 *   npm run voice -- --limit=5      # try a handful of requests first
 *   npm run voice -- --fast         # no throttling (paid S0 resources only)
 *   npm run voice -- --retrim       # re-cut the recorded files into phrases (no Azure needed)
 *
 * Credentials come from AZURE_SPEECH_KEY and AZURE_SPEECH_REGION, either as environment
 * variables or in a `.env.local` file (git-ignored). The free F0 tier allows 20 requests a
 * minute, so the full run takes about half an hour. It is resumable: stop it any time and run
 * it again – finished sprites are skipped.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as sdk from 'microsoft-cognitiveservices-speech-sdk';
import { MPEGDecoder } from 'mpg123-decoder';
import { toSpeech } from '../src/audio/speech-text.ts';
import type { VoiceIndex } from '../src/audio/voice-pack.ts';
import { loadQuestionBank } from '../src/game/questions.ts';
import { expectedSeconds, pad, segment, speechRegions } from './voice-segment.ts';
import {
  buildPlan,
  buildSsml,
  planStats,
  resolveSpans,
  spriteHash,
  VOICES,
  type Sprite,
} from './voice-plan.ts';

const ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const OUT = resolve(ROOT, 'public/voice');
const INDEX_FILE = resolve(OUT, 'index.json');

const args = new Map(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? 'true'] as const;
  }),
);
const DRY_RUN = args.has('dry-run');
const FAST = args.has('fast');
const LIMIT = Number(args.get('limit') ?? Infinity);
const ONLY = args.get('only'); // "lines" | "questions"
/** Re-cut the already recorded files (no Azure needed). */
const RETRIM = args.has('retrim');

/** F0 allows 20 requests per 60 s; keep a little margin. */
const MIN_INTERVAL_MS = FAST ? 0 : 3300;

// ─── Credentials ─────────────────────────────────────────────────────────────

function loadEnvFile(): void {
  const file = resolve(ROOT, '.env.local');
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (match && !process.env[match[1]!])
      process.env[match[1]!] = match[2]!.replace(/^["']|["']$/g, '');
  }
}

// ─── Index ───────────────────────────────────────────────────────────────────

function readIndex(): VoiceIndex {
  if (existsSync(INDEX_FILE)) {
    const data = JSON.parse(readFileSync(INDEX_FILE, 'utf8')) as VoiceIndex;
    if (data.version === 1) return data;
  }
  return {
    version: 1,
    voice: VOICES.host,
    generated: '',
    sprites: {},
    clips: {},
    questions: {},
    hashes: {},
  };
}

function writeIndex(index: VoiceIndex): void {
  index.generated = new Date().toISOString().slice(0, 10);
  const tmp = `${INDEX_FILE}.tmp`;
  writeFileSync(tmp, JSON.stringify(index));
  renameSync(tmp, INDEX_FILE);
}

/** Drops sprites that are no longer in the plan, with their files and clips. */
function prune(index: VoiceIndex, plan: Sprite[]): number {
  const wanted = new Set(plan.map((s) => s.id));
  let removed = 0;
  for (const [id, file] of Object.entries(index.sprites)) {
    if (wanted.has(id)) continue;
    rmSync(resolve(OUT, file), { force: true });
    delete index.sprites[id];
    delete index.hashes[id];
    removed++;
  }
  // Also drop phrases that are no longer in the plan (e.g. a line that was reworded).
  const wantedClips = new Set(
    plan.filter((s) => !s.question).flatMap((s) => s.items.map((i) => i.mark)),
  );
  for (const [key, ref] of Object.entries(index.clips))
    if (!index.sprites[ref[0]] || !wantedClips.has(key)) {
      delete index.clips[key];
      removed++;
    }
  for (const [id, q] of Object.entries(index.questions))
    if (!index.sprites[q.sprite]) delete index.questions[id];
  return removed;
}

// ─── Cutting the sprite into phrases ─────────────────────────────────────────

let decoder: MPEGDecoder | null = null;

async function decodeMp3(data: Uint8Array): Promise<{ samples: Float32Array; sampleRate: number }> {
  if (!decoder) {
    decoder = new MPEGDecoder();
    await decoder.ready;
  } else {
    await decoder.reset();
  }
  const { channelData, sampleRate } = decoder.decode(data);
  return { samples: channelData[0] ?? new Float32Array(), sampleRate };
}

/**
 * Where each phrase is, found in the audio itself (see voice-segment.ts).
 * `hints` are rough start times (bookmarks). Returns null if the audio cannot be fitted.
 */
async function spansFromAudio(
  sprite: Sprite,
  audio: Uint8Array,
  hints: ReadonlyMap<string, number>,
): Promise<Map<string, [number, number]> | null> {
  const { samples, sampleRate } = await decodeMp3(audio);
  if (samples.length === 0) return null;
  const duration = samples.length / sampleRate;
  const items = [
    ...sprite.items.map((item) => ({
      hint: hints.get(item.mark),
      expected: expectedSeconds(toSpeech(item.text)),
    })),
    { expected: 0.6 }, // the closing word ("Край."), cut off afterwards
  ];
  const raw = segment(speechRegions(samples, sampleRate), items);
  if (!raw) return null;
  const spans = pad(raw, duration).slice(0, -1);
  if (spans.some(([s, e]) => e - s < 0.25)) return null;
  return new Map(sprite.items.map((item, i) => [item.mark, spans[i]!]));
}

function record(index: VoiceIndex, sprite: Sprite, spans: Map<string, [number, number]>): void {
  const items = sprite.items;
  const span = (mark: string) => spans.get(mark)!;

  if (sprite.question) {
    index.questions[sprite.question.id] = {
      sprite: sprite.id,
      hash: sprite.question.hash,
      question: span('q'),
      answers: items.filter((i) => i.mark.startsWith('a')).map((i) => span(i.mark)),
    };
  } else {
    for (const item of items) index.clips[item.mark] = [sprite.id, ...span(item.mark)];
  }
  index.sprites[sprite.id] = sprite.file;
  index.hashes[sprite.id] = spriteHash(sprite);
}

// ─── Azure ───────────────────────────────────────────────────────────────────

interface Synthesis {
  audio: Buffer;
  marks: Map<string, number>;
  duration: number;
}

function synthesize(ssml: string, key: string, region: string): Promise<Synthesis> {
  const config = sdk.SpeechConfig.fromSubscription(key, region);
  config.speechSynthesisOutputFormat = sdk.SpeechSynthesisOutputFormat.Audio24Khz48KBitRateMonoMp3;
  // null audio config: keep the audio in memory instead of playing it.
  const synthesizer = new sdk.SpeechSynthesizer(config, null);
  const marks = new Map<string, number>();
  synthesizer.bookmarkReached = (_s, e) => marks.set(e.text, e.audioOffset / 10_000_000);

  return new Promise((resolvePromise, reject) => {
    synthesizer.speakSsmlAsync(
      ssml,
      (result) => {
        synthesizer.close();
        if (result.reason === sdk.ResultReason.SynthesizingAudioCompleted) {
          resolvePromise({
            audio: Buffer.from(result.audioData),
            marks,
            duration: result.audioDuration / 10_000_000,
          });
        } else {
          const details = sdk.CancellationDetails.fromResult(result);
          reject(
            new Error(
              `${details.ErrorCode ?? ''} ${details.errorDetails ?? 'synthesis failed'}`.trim(),
            ),
          );
        }
      },
      (error) => {
        synthesizer.close();
        reject(new Error(String(error)));
      },
    );
  });
}

/**
 * Checks the key and region with one cheap REST call before recording anything:
 * the SDK only reports a bad key as a dropped connection.
 */
async function checkCredentials(key: string, region: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/voices/list`, {
      headers: { 'Ocp-Apim-Subscription-Key': key },
    });
  } catch {
    throw new Error(
      `не мога да се свържа с региона „${region}“. Провери AZURE_SPEECH_REGION (напр. westeurope).`,
    );
  }
  if (res.status === 401 || res.status === 403)
    throw new Error(
      'Azure отказа ключа. Провери AZURE_SPEECH_KEY и дали ресурсът е в същия регион.',
    );
  if (!res.ok) throw new Error(`Azure върна HTTP ${res.status}.`);
  const voices = (await res.json()) as { ShortName: string }[];
  for (const voice of new Set(Object.values(VOICES)))
    if (!voices.some((v) => v.ShortName === voice))
      throw new Error(`гласът ${voice} не е наличен в региона „${region}“.`);
}

const isAuthError = (e: Error) =>
  /401|403|authenticat|subscription key|AuthenticationFailure|Forbidden/i.test(e.message);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function withRetries<T>(fn: () => Promise<T>, label: string): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const err = error as Error;
      if (isAuthError(err) || attempt >= 6) throw err;
      const wait = 5000 * 2 ** (attempt - 1);
      console.log(`  ⚠ ${label}: ${err.message} – retrying in ${wait / 1000} s`);
      await sleep(wait);
    }
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

/** Re-cuts every recorded sprite from its audio file. Uses the old start times as hints. */
async function retrim(plan: Sprite[], index: VoiceIndex): Promise<void> {
  let ok = 0;
  const failed: string[] = [];
  for (const sprite of plan) {
    const file = resolve(OUT, sprite.file);
    if (index.hashes[sprite.id] !== spriteHash(sprite) || !existsSync(file)) continue;
    const hints = new Map<string, number>();
    for (const item of sprite.items) {
      const old = sprite.question
        ? item.mark === 'q'
          ? index.questions[sprite.question.id]?.question
          : index.questions[sprite.question.id]?.answers[Number(item.mark.slice(1))]
        : index.clips[item.mark]?.slice(1);
      if (old) hints.set(item.mark, Number(old[0]) + 0.03);
    }
    const spans = await spansFromAudio(sprite, new Uint8Array(readFileSync(file)), hints);
    if (spans) {
      record(index, sprite, spans);
      ok++;
    } else {
      failed.push(sprite.id);
    }
  }
  const stale = prune(index, plan);
  writeIndex(index);
  if (stale) console.log(`🧹 Премахнати остарели записи: ${stale}`);
  console.log(
    `✂️  Нарязани наново: ${ok}. Неуспешни: ${failed.length}${failed.length ? ` (${failed.join(', ')})` : ''}`,
  );
}

async function main(): Promise<void> {
  const questionsDir = resolve(ROOT, 'public/questions');
  const bank = await loadQuestionBank('/', async (url) =>
    JSON.parse(readFileSync(resolve(questionsDir, url.slice(1)), 'utf8')),
  );

  let plan = buildPlan(bank.questions);
  const stats = planStats(plan);
  if (ONLY === 'lines') plan = plan.filter((s) => !s.question);
  if (ONLY === 'questions') plan = plan.filter((s) => s.question);

  const index = readIndex();
  const todo = plan.filter(
    (s) => index.hashes[s.id] !== spriteHash(s) || !existsSync(resolve(OUT, s.file)),
  );
  const batch = todo.slice(0, LIMIT);
  const minutes = Math.ceil((batch.length * Math.max(MIN_INTERVAL_MS, 2500)) / 60_000);

  console.log('🎙️  Гласът на водещия: Azure ' + VOICES.host);
  console.log(
    `   Фрази: ${stats.phrases} · въпроси: ${stats.questions} · знаци: ${stats.characters.toLocaleString('bg-BG')}`,
  );
  console.log(
    `   Заявки общо: ${stats.requests} · за записване сега: ${batch.length} (≈ ${minutes} мин.)\n`,
  );

  if (DRY_RUN) {
    const example = plan.find((s) => s.question) ?? plan[0];
    if (example) console.log(`Пример (${example.id}):\n${buildSsml(example)}\n`);
    return;
  }

  if (RETRIM) return retrim(plan, index);

  loadEnvFile();
  const key = process.env.AZURE_SPEECH_KEY;
  const region = process.env.AZURE_SPEECH_REGION;
  if (!key || !region) {
    console.error('❌ Липсват AZURE_SPEECH_KEY и AZURE_SPEECH_REGION.');
    console.error(
      '   Създай файл .env.local с тях или ги задай като променливи на средата. Виж README.',
    );
    process.exit(1);
  }

  try {
    await checkCredentials(key, region);
  } catch (error) {
    console.error(`❌ ${(error as Error).message}`);
    process.exit(1);
  }
  console.log('🔑 Ключът е наред.\n');

  mkdirSync(resolve(OUT, 'q'), { recursive: true });
  if (!ONLY && !Number.isFinite(LIMIT)) {
    const removed = prune(index, buildPlan(bank.questions));
    if (removed) console.log(`🧹 Премахнати остарели записи: ${removed}`);
  }

  let done = 0;
  let lastStart = 0;
  for (const sprite of batch) {
    const waitFor = lastStart + MIN_INTERVAL_MS - Date.now();
    if (waitFor > 0) await sleep(waitFor);
    lastStart = Date.now();

    try {
      const result = await withRetries(() => synthesize(buildSsml(sprite), key, region), sprite.id);
      // Cut by the audio itself; Azure's bookmarks are only a fallback (they drift after numbers).
      const hints = new Map(
        sprite.items.map((i) => [i.mark, result.marks.get(`${i.mark}|s`)] as const),
      );
      const spans =
        (await spansFromAudio(
          sprite,
          new Uint8Array(result.audio),
          hints as Map<string, number>,
        )) ?? resolveSpans(sprite, result.marks, result.duration);
      const file = resolve(OUT, sprite.file);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, result.audio);
      record(index, sprite, spans);
      writeIndex(index);
      done++;
      const left = batch.length - done;
      const eta = Math.ceil((left * Math.max(MIN_INTERVAL_MS, 2500)) / 60_000);
      console.log(
        `  ✓ [${done}/${batch.length}] ${sprite.id} (${(result.audio.length / 1024).toFixed(0)} KB)${left ? ` · остават ≈ ${eta} мин.` : ''}`,
      );
    } catch (error) {
      const err = error as Error;
      if (isAuthError(err)) {
        console.error(`\n❌ Azure отказа ключа: ${err.message}`);
        console.error('   Провери AZURE_SPEECH_KEY и AZURE_SPEECH_REGION (напр. westeurope).');
        process.exit(1);
      }
      console.error(`  ✖ ${sprite.id}: ${err.message} – пропускам, пусни скрипта пак по-късно.`);
    }
  }

  writeIndex(index);
  const total = Object.keys(index.clips).length + Object.keys(index.questions).length;
  console.log(`\n✅ Готово: ${done} нови записа. В пакета има ${total} фрази и въпроси.`);
  if (done < batch.length)
    console.log('   Някои заявки не минаха. Пусни `npm run voice` отново, за да ги довършиш.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
