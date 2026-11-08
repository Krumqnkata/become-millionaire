import { splitForSpeech, toSpeech } from './speech-text.ts';

/**
 * The host's voice: speech synthesis built into the browser, tuned for Bulgarian.
 *
 * - Picks the best Bulgarian voice available, preferring neural ("Natural") voices,
 *   e.g. "Microsoft Borislav Online (Natural)" in Edge, then any local Bulgarian voice.
 * - The player can choose a different voice in the settings.
 * - Friends on the phone get a voice of their own gender when the browser has one.
 * - Text is normalized first ("1 000 000 €" → "1000000 евро") and spoken sentence by sentence.
 * When there is no Bulgarian voice at all, the host only "speaks" in speech bubbles.
 */

export type VoiceRole = 'host' | 'male' | 'female';

export interface SpeakOptions {
  /** 0.1–2. Used to tell friends apart when only one voice is available. */
  pitch?: number;
  role?: VoiceRole;
}

export interface VoiceInfo {
  name: string;
  label: string;
  natural: boolean;
}

const NATURAL = /natural|online|neural|premium|enhanced/i;
const MALE = /borislav|ivan|male\b/i;
const FEMALE = /kalina|dar(i)?ya|female/i;

/** "Microsoft Borislav Online (Natural) - Bulgarian (Bulgaria)" → "Borislav Online (Natural)" */
function label(voice: SpeechSynthesisVoice): string {
  return voice.name
    .replace(/^(Microsoft|Google|Apple)\s+/i, '')
    .replace(/\s*[-–]\s*(Bulgarian|български).*$/i, '')
    .trim();
}

function score(voice: SpeechSynthesisVoice, role: VoiceRole): number {
  let s = NATURAL.test(voice.name) ? 100 : 0;
  if (role !== 'female' && MALE.test(voice.name)) s += 30;
  if (role === 'female' && FEMALE.test(voice.name)) s += 30;
  if (role === 'female' && MALE.test(voice.name)) s -= 40;
  if (role === 'male' && FEMALE.test(voice.name)) s -= 40;
  return s;
}

export class Voice {
  enabled: boolean;
  /** Resolves once the browser has listed its voices (or after a short timeout). */
  readonly ready: Promise<void>;
  private readonly synth: SpeechSynthesis | null;
  private bulgarian: SpeechSynthesisVoice[] = [];
  private preferred: string;
  private listeners = new Set<() => void>();
  private token = 0;

  constructor(enabled: boolean, preferredVoice = '') {
    this.enabled = enabled;
    this.preferred = preferredVoice;
    this.synth =
      typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null;

    this.ready = new Promise((resolve) => {
      if (!this.synth) return resolve();
      const refresh = () => {
        this.bulgarian = this.synth!.getVoices().filter((v) =>
          v.lang.toLowerCase().startsWith('bg'),
        );
        this.listeners.forEach((fn) => fn());
        if (this.bulgarian.length > 0) resolve();
      };
      refresh();
      this.synth.addEventListener?.('voiceschanged', refresh);
      setTimeout(resolve, 1500);
    });
  }

  /** True when the browser has a Bulgarian voice. */
  get available(): boolean {
    return this.bulgarian.length > 0;
  }

  /** Bulgarian voices, best first. */
  get voices(): VoiceInfo[] {
    return [...this.bulgarian]
      .sort((a, b) => score(b, 'host') - score(a, 'host'))
      .map((v) => ({ name: v.name, label: label(v), natural: NATURAL.test(v.name) }));
  }

  /** The voice the host currently uses. */
  get current(): VoiceInfo | null {
    const v = this.pick('host');
    return v ? { name: v.name, label: label(v), natural: NATURAL.test(v.name) } : null;
  }

  /** Called whenever the list of voices changes (they load asynchronously). */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  setPreferred(name: string): void {
    this.preferred = name;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.stop();
  }

  private pick(role: VoiceRole): SpeechSynthesisVoice | null {
    if (this.bulgarian.length === 0) return null;
    if (role === 'host') {
      const chosen = this.bulgarian.find((v) => v.name === this.preferred);
      if (chosen) return chosen;
    }
    return [...this.bulgarian].sort((a, b) => score(b, role) - score(a, role))[0] ?? null;
  }

  /**
   * Speaks `text` and resolves when done (or when interrupted by `stop()` or another `speak()`).
   * Never hangs: each sentence has a safety timeout based on its length.
   */
  async speak(text: string, { pitch, role = 'host' }: SpeakOptions = {}): Promise<void> {
    const synth = this.synth;
    const voice = this.pick(role);
    if (!this.enabled || !synth || !voice) return;
    synth.cancel();
    const my = ++this.token;

    // A dedicated voice for the role sounds better than a pitch-shifted host.
    const ownVoice = role !== 'host' && voice !== this.pick('host');
    const natural = NATURAL.test(voice.name);

    for (const chunk of splitForSpeech(toSpeech(text))) {
      if (my !== this.token) return;
      await new Promise<void>((resolve) => {
        const utterance = new SpeechSynthesisUtterance(chunk);
        utterance.voice = voice;
        utterance.lang = voice.lang;
        utterance.rate = natural ? 1 : 1.05;
        utterance.pitch = ownVoice ? 1 : (pitch ?? 1);

        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          clearTimeout(safety);
          resolve();
        };
        const safety = setTimeout(finish, 2000 + chunk.length * 95);
        utterance.onend = finish;
        utterance.onerror = finish;
        synth.speak(utterance);
      });
    }
  }

  stop(): void {
    this.token++;
    this.synth?.cancel();
  }
}
