import type { Question } from '../game/types.ts';
import { toSpeech } from './speech-text.ts';

/**
 * A pre-recorded voice pack (see `scripts/generate-voice.ts`).
 *
 * Phrases are recorded in batches into "sprites" – one mp3 with many phrases and a pause
 * between them – and `public/voice/index.json` says where each phrase starts and ends.
 * Every question has its own sprite: the question, then answers А–Г.
 */

export type VoiceRole = 'host' | 'male' | 'female';

/** [sprite id, start seconds, end seconds] */
export type ClipRef = [string, number, number];

export interface QuestionClips {
  sprite: string;
  /** Hash of the question text and answers, so an edited question never plays a stale recording. */
  hash: string;
  question: [number, number];
  answers: [number, number][];
}

export interface VoiceIndex {
  version: 1;
  voice: string;
  generated: string;
  /** sprite id → file, relative to `public/voice/` */
  sprites: Record<string, string>;
  /** clip key → where it is */
  clips: Record<string, ClipRef>;
  questions: Record<string, QuestionClips>;
  /** sprite id → hash of the SSML it was made from (lets the generator skip unchanged sprites) */
  hashes: Record<string, string>;
}

/** FNV-1a 32-bit, as a short base-36 string. Stable across Node and browsers. */
export function hash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

const normalize = (text: string) =>
  toSpeech(text).toLocaleLowerCase('bg').replace(/\s+/g, ' ').trim();

/** The lookup key for a recorded phrase. Case, spacing and quote style don't matter. */
export function clipKey(text: string, role: VoiceRole = 'host'): string {
  return `${role}:${hash(normalize(text))}`;
}

export function questionHash(q: Pick<Question, 'question' | 'answers'>): string {
  return hash(normalize([q.question, ...q.answers].join(' | ')));
}

export class VoicePack {
  private index: VoiceIndex | null = null;
  private base = '';

  get ready(): boolean {
    return this.index !== null && Object.keys(this.index.clips).length > 0;
  }

  /** Loads `<base>voice/index.json`. A missing pack is fine – the browser voice takes over. */
  async load(baseUrl: string): Promise<void> {
    try {
      const res = await fetch(`${baseUrl}voice/index.json`, { cache: 'no-cache' });
      if (!res.ok) return;
      const data = (await res.json()) as VoiceIndex;
      if (data.version !== 1 || typeof data.clips !== 'object') return;
      this.index = data;
      this.base = `${baseUrl}voice/`;
    } catch {
      /* no voice pack */
    }
  }

  url(sprite: string): string | null {
    const file = this.index?.sprites[sprite];
    return file ? this.base + file : null;
  }

  clip(text: string, role: VoiceRole = 'host'): ClipRef | null {
    return this.index?.clips[clipKey(text, role)] ?? null;
  }

  /** Clips for a question, or null if it was never recorded or has changed since. */
  question(q: Question & { id: string }): QuestionClips | null {
    const clips = this.index?.questions[q.id];
    return clips && clips.hash === questionHash(q) ? clips : null;
  }

  /** Sprite ids whose name starts with `prefix`, e.g. "level-3-" or "common-". */
  sprites(prefix: string): string[] {
    return Object.keys(this.index?.sprites ?? {}).filter((id) => id.startsWith(prefix));
  }
}
