/**
 * The host's voice: a thin wrapper over the browser's speech synthesis.
 * Prefers a Bulgarian voice; when there is none, the host only "speaks" in bubbles.
 */

const PREFERRED = [/borislav/i, /ivan/i, /bg-bg/i];

export interface SpeakOptions {
  /** 0.1–2, default 1. Friends on the phone get a different pitch. */
  pitch?: number;
  rate?: number;
}

export class Voice {
  enabled: boolean;
  private voice: SpeechSynthesisVoice | null = null;
  private readonly synth: SpeechSynthesis | null;

  constructor(enabled: boolean) {
    this.enabled = enabled;
    this.synth =
      typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null;
    if (!this.synth) return;
    this.pickVoice();
    this.synth.addEventListener?.('voiceschanged', () => this.pickVoice());
  }

  /** True when the browser has a Bulgarian voice we can use. */
  get available(): boolean {
    return this.voice !== null;
  }

  private pickVoice(): void {
    const voices = this.synth?.getVoices() ?? [];
    const bulgarian = voices.filter((v) => v.lang.toLowerCase().startsWith('bg'));
    this.voice =
      PREFERRED.map((re) => bulgarian.find((v) => re.test(v.name))).find(Boolean) ??
      bulgarian[0] ??
      null;
  }

  /**
   * Speaks `text` and resolves when done. Resolves immediately when the voice is off,
   * and never hangs: a timeout based on the text length is a safety net for flaky engines.
   */
  speak(text: string, { pitch = 1, rate = 1.05 }: SpeakOptions = {}): Promise<void> {
    const synth = this.synth;
    if (!this.enabled || !synth || !this.voice) return Promise.resolve();
    synth.cancel();

    return new Promise((resolve) => {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.voice = this.voice;
      utterance.lang = this.voice?.lang ?? 'bg-BG';
      utterance.pitch = pitch;
      utterance.rate = rate;

      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(safety);
        resolve();
      };
      const safety = setTimeout(finish, 1500 + text.length * 90);
      utterance.onend = finish;
      utterance.onerror = finish;
      synth.speak(utterance);
    });
  }

  stop(): void {
    this.synth?.cancel();
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.stop();
  }
}
