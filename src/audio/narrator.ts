import { ANSWER_LETTERS } from '../game/lifelines.ts';
import type { AnswerIndex, CategorizedQuestion } from '../game/types.ts';
import type { Line } from '../show/script.ts';
import type { ShowAudio } from './engine.ts';
import type { Voice } from './voice.ts';
import type { ClipRef, VoicePack, VoiceRole } from './voice-pack.ts';

interface Segment {
  sprite: string;
  start: number;
  end: number;
}

export interface SayOptions {
  role?: VoiceRole;
  pitch?: number;
  /** For lines that mention the answer ("Верният отговор е В, „Волга“"). */
  question?: CategorizedQuestion;
  answer?: AnswerIndex;
}

/** Decoded sprites kept in memory. Each is ≈ 40 s of audio, ≈ 8 MB once decoded. */
const DECODED_CACHE_SIZE = 6;

const toSegment = ([sprite, start, end]: ClipRef): Segment => ({ sprite, start, end });

/**
 * Speaks for the host. Uses the recorded voice pack when a phrase is in it,
 * and falls back to the browser's speech synthesis for anything else
 * (or when there is no pack at all).
 */
export class Narrator {
  /** Player setting: use the recorded voice when available. */
  recorded: boolean;
  private token = 0;
  private playing: { stop(): void } | null = null;
  private compressed = new Map<string, Promise<ArrayBuffer | null>>();
  private decoded = new Map<string, Promise<AudioBuffer | null>>();

  constructor(
    readonly voice: Voice,
    private readonly audio: ShowAudio,
    readonly pack: VoicePack,
    recorded = true,
  ) {
    this.recorded = recorded;
  }

  /** The host's voice is switched on (and sound is not muted). */
  get enabled(): boolean {
    return this.voice.enabled;
  }

  get usingRecordings(): boolean {
    return this.recorded && this.pack.ready;
  }

  /** There is some voice to hear: recordings or a Bulgarian browser voice. */
  get canSpeak(): boolean {
    return this.enabled && (this.usingRecordings || this.voice.available);
  }

  // ── Speaking ───────────────────────────────────────────────────────────────

  async say(line: Line | string, opts: SayOptions = {}): Promise<void> {
    if (!this.enabled) return;
    const my = this.begin();
    const segments = this.usingRecordings ? this.segmentsFor(line, opts) : null;
    if (segments) return this.play(segments, my);
    const text = typeof line === 'string' ? line : line.text;
    await this.voice.speak(text, {
      ...(opts.role ? { role: opts.role } : {}),
      ...(opts.pitch ? { pitch: opts.pitch } : {}),
    });
  }

  async readQuestion(q: CategorizedQuestion): Promise<void> {
    if (!this.enabled) return;
    const my = this.begin();
    const clips = this.usingRecordings ? this.pack.question(q) : null;
    if (clips)
      return this.play(
        [{ sprite: clips.sprite, start: clips.question[0], end: clips.question[1] }],
        my,
      );
    await this.voice.speak(q.question);
  }

  async readAnswer(q: CategorizedQuestion, index: AnswerIndex): Promise<void> {
    if (!this.enabled) return;
    const my = this.begin();
    const clips = this.usingRecordings ? this.pack.question(q) : null;
    const span = clips?.answers[index];
    if (clips && span)
      return this.play([{ sprite: clips.sprite, start: span[0], end: span[1] }], my);
    await this.voice.speak(`${ANSWER_LETTERS[index]}: ${q.answers[index]}`);
  }

  stop(): void {
    this.token++;
    this.playing?.stop();
    this.playing = null;
    this.voice.stop();
  }

  /** True when the question has a recording (its answers are then shown in recorded order). */
  hasQuestion(q: CategorizedQuestion): boolean {
    return this.usingRecordings && this.pack.question(q) !== null;
  }

  // ── Loading ────────────────────────────────────────────────────────────────

  /** Starts downloading sprites in the background, e.g. "common-" or "level-4-". */
  prefetch(prefix: string): void {
    if (!this.usingRecordings) return;
    for (const id of this.pack.sprites(prefix)) void this.fetch(id);
  }

  prefetchQuestion(q: CategorizedQuestion): void {
    const clips = this.usingRecordings ? this.pack.question(q) : null;
    if (clips) void this.fetch(clips.sprite);
  }

  private fetch(sprite: string): Promise<ArrayBuffer | null> {
    let pending = this.compressed.get(sprite);
    if (!pending) {
      const url = this.pack.url(sprite);
      pending = url
        ? fetch(url)
            .then((r) => (r.ok ? r.arrayBuffer() : null))
            .catch(() => null)
        : Promise.resolve(null);
      this.compressed.set(sprite, pending);
    }
    return pending;
  }

  /** Decodes on demand and keeps only the most recently used sprites decoded. */
  private buffer(sprite: string): Promise<AudioBuffer | null> {
    let pending = this.decoded.get(sprite);
    if (pending) {
      this.decoded.delete(sprite); // re-insert to mark as most recently used
    } else {
      pending = this.fetch(sprite).then((data) => (data ? this.audio.decode(data) : null));
    }
    this.decoded.set(sprite, pending);
    while (this.decoded.size > DECODED_CACHE_SIZE) {
      const oldest = this.decoded.keys().next().value;
      if (oldest === undefined) break;
      this.decoded.delete(oldest);
    }
    return pending;
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private begin(): number {
    this.stop();
    return this.token;
  }

  private segmentsFor(line: Line | string, opts: SayOptions): Segment[] | null {
    if (typeof line === 'string') {
      const clip = this.pack.clip(line, opts.role ?? 'host');
      return clip ? [toSegment(clip)] : null;
    }
    const segments: Segment[] = [];
    for (const part of line.voice) {
      if (typeof part === 'string') {
        const clip = this.pack.clip(part, 'host');
        if (!clip) return null;
        segments.push(toSegment(clip));
      } else {
        const clips = opts.question ? this.pack.question(opts.question) : null;
        const span = opts.answer !== undefined ? clips?.answers[opts.answer] : undefined;
        if (!clips || !span) return null;
        segments.push({ sprite: clips.sprite, start: span[0], end: span[1] });
      }
    }
    return segments.length > 0 ? segments : null;
  }

  private async play(segments: Segment[], my: number): Promise<void> {
    // Start every download at once; play in order.
    const buffers = segments.map((s) => this.buffer(s.sprite));
    for (const [i, segment] of segments.entries()) {
      const buffer = await buffers[i];
      if (my !== this.token) return;
      if (!buffer) continue;
      const playback = this.audio.playVoice(buffer, segment.start, segment.end);
      this.playing = playback;
      await playback.done;
      if (my !== this.token) return;
    }
    this.playing = null;
  }
}
