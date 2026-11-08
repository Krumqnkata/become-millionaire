/**
 * Plans what the voice generator records and builds the SSML for each request.
 * Pure functions only – no network – so the plan can be tested and previewed with --dry-run.
 */
import { toSpeech } from '../src/audio/speech-text.ts';
import { clipKey, hash, questionHash, type VoiceRole } from '../src/audio/voice-pack.ts';
import { ANSWER_LETTERS, friendMessage } from '../src/game/lifelines.ts';
import type { CategorizedQuestion } from '../src/game/types.ts';
import { allVoicePhrases, type Mood } from '../src/show/script.ts';

/** Azure neural voices. Male friends reuse the host's voice, pitched down. */
export const VOICES: Record<VoiceRole, string> = {
  host: 'bg-BG-BorislavNeural',
  male: 'bg-BG-BorislavNeural',
  female: 'bg-BG-KalinaNeural',
};

const PROSODY: Record<Mood | 'question' | 'friend', { rate: string; pitch: string }> = {
  neutral: { rate: '0%', pitch: '0%' },
  warm: { rate: '-2%', pitch: '+3%' },
  tense: { rate: '-10%', pitch: '-4%' },
  excited: { rate: '+8%', pitch: '+10%' },
  sad: { rate: '-12%', pitch: '-6%' },
  question: { rate: '-4%', pitch: '0%' },
  friend: { rate: '+4%', pitch: '0%' },
};

export interface PlanItem {
  /** Bookmark name; for line sprites also the clip key. */
  mark: string;
  text: string;
  role: VoiceRole;
  style: keyof typeof PROSODY;
  /** Silence after this item. */
  pause: number;
}

export interface Sprite {
  id: string;
  file: string;
  items: PlanItem[];
  /** Set for question sprites. */
  question?: { id: string; hash: string };
}

/** About 40 seconds of audio per file: small to download and to keep decoded in memory. */
const MAX_CHARS_PER_SPRITE = 500;
const MAX_ITEMS_PER_SPRITE = 12;

function chunk(prefix: string, items: PlanItem[]): Sprite[] {
  const sprites: Sprite[] = [];
  let current: PlanItem[] = [];
  let chars = 0;
  const flush = () => {
    if (current.length === 0) return;
    const id = `${prefix}-${sprites.length + 1}`;
    sprites.push({ id, file: `${id}.mp3`, items: current });
    current = [];
    chars = 0;
  };
  for (const item of items) {
    if (chars + item.text.length > MAX_CHARS_PER_SPRITE || current.length >= MAX_ITEMS_PER_SPRITE)
      flush();
    current.push(item);
    chars += item.text.length;
  }
  flush();
  return sprites;
}

/** Everything a friend can say on the phone, for both voices. */
export function friendPhrases(): { text: string; role: VoiceRole }[] {
  const unique = new Map<string, { text: string; role: VoiceRole }>();
  for (const gender of ['male', 'female'] as const)
    for (const letter of ANSWER_LETTERS)
      for (const confidence of [90, 70, 50, 20])
        for (const expert of [false, true]) {
          const text = friendMessage(letter, confidence, expert, gender);
          unique.set(`${gender}|${text}`, { text, role: gender });
        }
  return [...unique.values()];
}

export function questionSprite(q: CategorizedQuestion): Sprite {
  const id = `q-${q.id}`;
  return {
    id,
    file: `q/${q.id}.mp3`,
    question: { id: q.id, hash: questionHash(q) },
    items: [
      { mark: 'q', text: q.question, role: 'host', style: 'question', pause: 800 },
      ...q.answers.map((answer, i): PlanItem => ({
        mark: `a${i}`,
        text: `${ANSWER_LETTERS[i]}: ${answer}`,
        role: 'host',
        style: 'question',
        pause: 450,
      })),
    ],
  };
}

export function buildPlan(questions: readonly CategorizedQuestion[]): Sprite[] {
  const bySection = new Map<string, PlanItem[]>();
  for (const phrase of allVoicePhrases()) {
    const items = bySection.get(phrase.section) ?? [];
    items.push({
      mark: clipKey(phrase.text),
      text: phrase.text,
      role: 'host',
      style: phrase.mood,
      pause: 600,
    });
    bySection.set(phrase.section, items);
  }

  const friends = friendPhrases()
    .sort((a, b) => a.role.localeCompare(b.role))
    .map((f): PlanItem => ({
      mark: clipKey(f.text, f.role),
      text: f.text,
      role: f.role,
      style: 'friend',
      pause: 600,
    }));

  return [
    ...[...bySection.entries()].flatMap(([section, items]) => chunk(section, items)),
    ...chunk('friends', friends),
    ...questions.map(questionSprite),
  ];
}

const escapeXml = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

export const TAIL_WORD = 'Край.';
export const TAIL_MARK = '__tail';

const pitchFor = (item: PlanItem) => (item.role === 'male' ? '-12%' : PROSODY[item.style].pitch);

/** One SSML document per sprite, with a bookmark before and after every item. */
export function buildSsml(sprite: Sprite): string {
  let body = '';
  let openVoice: string | null = null;
  for (const item of sprite.items) {
    const voice = VOICES[item.role];
    if (voice !== openVoice) {
      if (openVoice) body += '</voice>';
      body += `<voice name="${voice}">`;
      openVoice = voice;
    }
    const { rate } = PROSODY[item.style];
    body +=
      `<prosody rate="${rate}" pitch="${pitchFor(item)}">` +
      `<bookmark mark="${escapeXml(item.mark)}|s"/>${escapeXml(toSpeech(item.text))}<bookmark mark="${escapeXml(item.mark)}|e"/>` +
      `</prosody><break time="${item.pause}ms"/>`;
  }
  // Azure drops bookmarks that come after the last spoken word, so the final "|e" bookmark
  // would go missing. A short closing word fixes that; it is never played (clips end earlier).
  if (openVoice) body += `<bookmark mark="${TAIL_MARK}"/>${TAIL_WORD}</voice>`;
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="bg-BG">${body}</speak>`;
}

/** Bookmark offsets are exact, but MP3 decoding adds a few ms of delay – keep a margin. */
const LEAD = 0.03;
const TAIL = 0.12;
/** Gap assumed between phrases when a bookmark is missing (pauses are ≥ 450 ms). */
const GAP = 0.15;
const round = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Turns the bookmark times Azure reported into [start, end] for every item of a sprite.
 * A missing bookmark is inferred from its neighbours (or the end of the file);
 * throws only when an item cannot be placed at all.
 */
export function resolveSpans(
  sprite: Sprite,
  marks: ReadonlyMap<string, number>,
  duration: number,
): Map<string, [number, number]> {
  const items = sprite.items;
  const spans = new Map<string, [number, number]>();
  items.forEach((item, i) => {
    const last = i === items.length - 1;
    const prevEnd = i > 0 ? marks.get(`${items[i - 1]!.mark}|e`) : 0;
    // After the last item comes its pause, then the closing word (bookmarked as TAIL_MARK).
    const tail = marks.get(TAIL_MARK);
    const nextStart = last
      ? tail !== undefined
        ? tail - item.pause / 1000 + GAP
        : undefined
      : marks.get(`${items[i + 1]!.mark}|s`);
    const start =
      marks.get(`${item.mark}|s`) ?? (prevEnd !== undefined ? prevEnd + GAP : undefined);
    const end =
      marks.get(`${item.mark}|e`) ??
      (nextStart !== undefined
        ? nextStart - GAP
        : last && duration > 0
          ? duration - 1.2
          : undefined);
    if (start === undefined || end === undefined || end <= start)
      throw new Error(`missing bookmark "${item.mark}" in ${sprite.id}`);
    spans.set(item.mark, [
      round(Math.max(0, start - LEAD)),
      round(duration > 0 ? Math.min(duration, end + TAIL) : end + TAIL),
    ]);
  });
  return spans;
}

/** Changes whenever the text, voices or prosody of a sprite change. */
export const spriteHash = (sprite: Sprite) => hash(buildSsml(sprite));

export function planStats(sprites: readonly Sprite[]) {
  const characters = sprites.reduce(
    (n, s) => n + s.items.reduce((m, i) => m + i.text.length, 0),
    0,
  );
  return {
    requests: sprites.length,
    characters,
    phrases: sprites.reduce((n, s) => n + s.items.length, 0),
    questions: sprites.filter((s) => s.question).length,
  };
}
