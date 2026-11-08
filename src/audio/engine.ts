/**
 * The show's soundtrack and sound effects, composed in code with the Web Audio API.
 *
 * Everything here is original: a small "studio" of synth instruments (pads, brass stabs,
 * plucks, drums, risers and bells) run through a compressor and a generated reverb.
 * Background music ("beds") is scheduled with a look-ahead clock so it stays in time.
 *
 * Want real recordings instead? Drop files into `public/audio/` and list them in
 * `public/audio/manifest.json` – any sound or bed listed there replaces the synth version.
 */

export type SoundName =
  | 'intro'
  | 'start'
  | 'reveal'
  | 'select'
  | 'lock'
  | 'correct'
  | 'wrong'
  | 'safe'
  | 'win'
  | 'walk'
  | 'tick'
  | 'lifeline'
  | 'fifty'
  | 'keypad'
  | 'ring'
  | 'click';

export type BedName = 'none' | 'menu' | 'tier1' | 'tier2' | 'tier3' | 'suspense' | 'phone';

interface Bed {
  bpm: number;
  /** Called for every 16th note. `step` counts from 0 since the bed started. */
  onStep(step: number, time: number): void;
}

const midi = (note: number) => 440 * Math.pow(2, (note - 69) / 12);

// Chords as MIDI notes (A minor world, with a darker turn for the big money).
const AM = [57, 60, 64];
const F = [53, 57, 60];
const DM = [50, 53, 57];
const E = [52, 56, 59];
const G = [55, 59, 62];
const C = [48, 52, 55];
const BB = [58, 62, 65];
const A_MAJ = [57, 61, 64];

const PROGRESSION_CALM = [AM, F, C, G];
const PROGRESSION_TENSE = [AM, F, DM, E];
const PROGRESSION_DARK = [AM, BB, AM, E];

interface VoiceOptions {
  type?: OscillatorType;
  gain?: number;
  attack?: number;
  release?: number;
  detune?: number;
  slideTo?: number;
  filter?: { type?: BiquadFilterType; freq: number; to?: number; q?: number };
  /** 0–1 how much goes to the reverb. */
  wet?: number;
  bus?: 'music' | 'sfx';
}

export class ShowAudio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private music!: GainNode;
  private sfx!: GainNode;
  private reverb!: ConvolverNode;
  private noise!: AudioBuffer;

  private bed: { name: BedName; gain: GainNode; def: Bed; step: number; next: number } | null =
    null;
  private scheduler = 0;
  private overrides = new Map<string, string>();
  private buffers = new Map<string, AudioBuffer>();
  private bedSource: AudioBufferSourceNode | null = null;

  muted: boolean;
  musicOn: boolean;
  private volume = 0.8;

  constructor({ muted = false, music = true }: { muted?: boolean; music?: boolean } = {}) {
    this.muted = muted;
    this.musicOn = music;
  }

  // ── Setup ────────────────────────────────────────────────────────────────

  /** Audio may only start after a user gesture; call this from any click handler. */
  unlock(): void {
    this.ensure();
  }

  private ensure(): AudioContext | null {
    try {
      if (!this.ctx) {
        const Ctor =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return null;
        const ctx = new Ctor();
        this.ctx = ctx;

        const compressor = ctx.createDynamicsCompressor();
        compressor.threshold.value = -16;
        compressor.ratio.value = 4;
        this.master = ctx.createGain();
        this.master.gain.value = this.muted ? 0 : this.volume;
        this.master.connect(compressor).connect(ctx.destination);

        this.music = ctx.createGain();
        this.music.gain.value = this.musicOn ? 0.55 : 0;
        this.music.connect(this.master);
        this.sfx = ctx.createGain();
        this.sfx.gain.value = 0.9;
        this.sfx.connect(this.master);

        this.reverb = ctx.createConvolver();
        this.reverb.buffer = this.impulse(2.8, 2.2);
        const wet = ctx.createGain();
        wet.gain.value = 0.9;
        this.reverb.connect(wet).connect(this.master);

        this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
        const data = this.noise.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return this.ctx;
    } catch {
      return null;
    }
  }

  /** A synthetic "studio hall" impulse response: decaying stereo noise. */
  private impulse(seconds: number, decay: number): AudioBuffer {
    const ctx = this.ctx!;
    const length = Math.floor(ctx.sampleRate * seconds);
    const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buffer.getChannelData(ch);
      for (let i = 0; i < length; i++)
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
    }
    return buffer;
  }

  /** Loads optional recorded replacements listed in `<base>audio/manifest.json`. */
  async loadOverrides(baseUrl: string): Promise<void> {
    try {
      const res = await fetch(`${baseUrl}audio/manifest.json`);
      if (!res.ok) return;
      const manifest = (await res.json()) as Record<string, unknown>;
      for (const [name, file] of Object.entries(manifest)) {
        if (typeof file === 'string' && file && !name.startsWith('$'))
          this.overrides.set(name, `${baseUrl}audio/${file}`);
      }
    } catch {
      /* no overrides – synth only */
    }
  }

  private async buffer(name: string): Promise<AudioBuffer | null> {
    const url = this.overrides.get(name);
    if (!url || !this.ctx) return null;
    const cached = this.buffers.get(name);
    if (cached) return cached;
    try {
      const data = await (await fetch(url)).arrayBuffer();
      const decoded = await this.ctx.decodeAudioData(data);
      this.buffers.set(name, decoded);
      return decoded;
    } catch {
      this.overrides.delete(name);
      return null;
    }
  }

  // ── Settings ─────────────────────────────────────────────────────────────

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.ctx)
      this.master.gain.setTargetAtTime(muted ? 0 : this.volume, this.ctx.currentTime, 0.05);
    else if (!muted) this.ensure();
  }

  setMusic(on: boolean): void {
    this.musicOn = on;
    if (this.ctx) this.music.gain.setTargetAtTime(on ? 0.55 : 0, this.ctx.currentTime, 0.1);
  }

  setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume));
    if (this.ctx && !this.muted)
      this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.05);
  }

  get currentVolume(): number {
    return this.volume;
  }

  /** Lowers the music while the host talks. */
  duck(on: boolean): void {
    if (!this.ctx || !this.musicOn) return;
    this.music.gain.setTargetAtTime(on ? 0.25 : 0.55, this.ctx.currentTime, 0.15);
  }

  // ── Instruments ──────────────────────────────────────────────────────────

  private dest(opts: VoiceOptions): { dry: AudioNode; wet: number } {
    return { dry: opts.bus === 'music' ? this.music : this.sfx, wet: opts.wet ?? 0.2 };
  }

  /** One oscillator note with envelope, optional filter sweep and reverb send. */
  private note(freq: number, t0: number, dur: number, opts: VoiceOptions = {}): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const {
      type = 'triangle',
      gain = 0.2,
      attack = 0.01,
      release = 0.2,
      detune = 0,
      slideTo,
      filter,
    } = opts;

    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    osc.detune.value = detune;
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(gain, t0 + attack);
    env.gain.setValueAtTime(gain, t0 + Math.max(attack, dur - release));
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur + release);

    let node: AudioNode = osc;
    if (filter) {
      const f = ctx.createBiquadFilter();
      f.type = filter.type ?? 'lowpass';
      f.Q.value = filter.q ?? 0.8;
      f.frequency.setValueAtTime(filter.freq, t0);
      if (filter.to) f.frequency.exponentialRampToValueAtTime(filter.to, t0 + dur);
      osc.connect(f);
      node = f;
    }
    node.connect(env);

    const { dry, wet } = this.dest(opts);
    env.connect(dry);
    if (wet > 0) {
      const send = ctx.createGain();
      send.gain.value = wet;
      env.connect(send).connect(this.reverb);
    }
    osc.start(t0);
    osc.stop(t0 + dur + release + 0.05);
  }

  private noiseBurst(
    t0: number,
    dur: number,
    opts: VoiceOptions & { from?: number; to?: number } = {},
  ): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = opts.filter?.type ?? 'bandpass';
    f.Q.value = opts.filter?.q ?? 1;
    f.frequency.setValueAtTime(opts.from ?? 1000, t0);
    if (opts.to) f.frequency.exponentialRampToValueAtTime(opts.to, t0 + dur);
    const env = ctx.createGain();
    const gain = opts.gain ?? 0.2;
    const attack = opts.attack ?? 0.005;
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(gain, t0 + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(env);
    const { dry, wet } = this.dest(opts);
    env.connect(dry);
    if (wet > 0) {
      const send = ctx.createGain();
      send.gain.value = wet;
      env.connect(send).connect(this.reverb);
    }
    src.start(t0, Math.random());
    src.stop(t0 + dur + 0.05);
  }

  private pad(
    notes: number[],
    t0: number,
    dur: number,
    gain = 0.06,
    bright = 900,
    bus: 'music' | 'sfx' = 'music',
  ): void {
    for (const n of notes) {
      for (const detune of [-8, 8]) {
        this.note(midi(n), t0, dur, {
          type: 'sawtooth',
          gain,
          attack: 0.5,
          release: 1.2,
          detune,
          filter: { freq: bright },
          wet: 0.55,
          bus,
        });
      }
    }
    this.note(midi(notes[0]! - 12), t0, dur, {
      type: 'triangle',
      gain: gain * 1.4,
      attack: 0.4,
      release: 1,
      wet: 0.3,
      bus,
    });
  }

  private brass(
    notes: number[],
    t0: number,
    dur: number,
    gain = 0.09,
    bus: 'music' | 'sfx' = 'sfx',
  ): void {
    for (const n of notes) {
      for (const detune of [-6, 0, 6]) {
        this.note(midi(n), t0, dur, {
          type: 'sawtooth',
          gain,
          attack: 0.03,
          release: 0.5,
          detune,
          filter: { freq: 3200, to: 900, q: 1.5 },
          wet: 0.45,
          bus,
        });
      }
    }
  }

  private pluck(note: number, t0: number, gain = 0.12, bus: 'music' | 'sfx' = 'music'): void {
    this.note(midi(note), t0, 0.18, {
      type: 'triangle',
      gain,
      attack: 0.004,
      release: 0.25,
      wet: 0.35,
      bus,
    });
    this.note(midi(note + 12), t0, 0.1, {
      type: 'sine',
      gain: gain * 0.4,
      attack: 0.004,
      release: 0.2,
      wet: 0.35,
      bus,
    });
  }

  private bell(note: number, t0: number, gain = 0.08, bus: 'music' | 'sfx' = 'sfx'): void {
    const f = midi(note);
    [1, 2.76, 5.4].forEach((ratio, i) =>
      this.note(f * ratio, t0, 0.05, {
        type: 'sine',
        gain: gain / (i + 1),
        attack: 0.002,
        release: 1.6 / (i + 1),
        wet: 0.6,
        bus,
      }),
    );
  }

  private kick(t0: number, gain = 0.7, bus: 'music' | 'sfx' = 'music'): void {
    this.note(150, t0, 0.12, {
      type: 'sine',
      gain,
      attack: 0.002,
      release: 0.25,
      slideTo: 42,
      wet: 0.05,
      bus,
    });
  }

  private hat(t0: number, gain = 0.05, bus: 'music' | 'sfx' = 'music'): void {
    this.noiseBurst(t0, 0.05, {
      gain,
      from: 8000,
      filter: { type: 'highpass', freq: 8000 },
      wet: 0.1,
      bus,
    });
  }

  private boom(t0: number, gain = 0.9): void {
    this.note(110, t0, 0.5, {
      type: 'sine',
      gain,
      attack: 0.003,
      release: 1.8,
      slideTo: 32,
      wet: 0.5,
    });
    this.noiseBurst(t0, 1.8, {
      gain: gain * 0.35,
      from: 400,
      to: 60,
      filter: { type: 'lowpass', freq: 400 },
      wet: 0.8,
    });
  }

  private riser(t0: number, dur: number, gain = 0.12): void {
    this.noiseBurst(t0, dur, {
      gain,
      attack: dur * 0.9,
      from: 300,
      to: 7000,
      filter: { type: 'bandpass', freq: 300, q: 2 },
      wet: 0.5,
    });
  }

  private timpaniRoll(t0: number, dur: number, note = 45): void {
    const hits = Math.floor(dur / 0.06);
    for (let i = 0; i < hits; i++) {
      const g = 0.05 + (i / hits) * 0.25;
      this.note(midi(note), t0 + i * 0.06, 0.08, {
        type: 'sine',
        gain: g,
        attack: 0.003,
        release: 0.3,
        slideTo: midi(note) * 0.85,
        wet: 0.4,
      });
    }
  }

  // ── Sound effects & stingers ─────────────────────────────────────────────

  play(name: SoundName): void {
    if (!this.ensure() || this.muted) return;
    if (this.overrides.has(name)) {
      void this.buffer(name).then((buf) => buf && this.playBuffer(buf));
      return;
    }
    const t = this.ctx!.currentTime + 0.02;

    switch (name) {
      case 'click':
        this.pluck(81, t, 0.06, 'sfx');
        break;
      case 'select':
        this.pluck(76, t, 0.12, 'sfx');
        this.pluck(83, t + 0.06, 0.08, 'sfx');
        break;
      case 'reveal':
        this.noiseBurst(t, 0.18, { gain: 0.05, from: 2000, to: 6000, wet: 0.3 });
        this.bell(84, t, 0.04);
        break;
      case 'intro': {
        // An original fanfare: riser → boom → brass hits → melody → bells.
        this.riser(t, 1.2, 0.1);
        this.timpaniRoll(t + 0.2, 1.0);
        this.boom(t + 1.2);
        const beat = 0.42;
        const hits: Array<[number[], number]> = [
          [AM, 0],
          [F, 2],
          [G, 3],
          [A_MAJ, 4],
        ];
        hits.forEach(([chord, b]) =>
          this.brass(
            chord.map((n) => n + 12),
            t + 1.2 + b * beat,
            b === 4 ? 1.8 : 0.35,
            0.05,
          ),
        );
        [69, 76, 74, 72, 76, 81].forEach((n, i) =>
          this.pluck(n + 12, t + 1.2 + i * (beat / 1.5), 0.1, 'sfx'),
        );
        this.bell(93, t + 1.2 + 4 * beat, 0.08);
        this.bell(88, t + 1.3 + 4 * beat, 0.06);
        break;
      }
      case 'start':
        this.boom(t, 0.6);
        this.brass(
          AM.map((n) => n + 12),
          t,
          0.3,
          0.04,
        );
        this.noiseBurst(t, 0.6, { gain: 0.06, from: 6000, to: 400, wet: 0.5 });
        break;
      case 'lock':
        this.noiseBurst(t, 0.5, { gain: 0.08, from: 5000, to: 200, wet: 0.5 });
        this.note(midi(33), t + 0.1, 0.4, { type: 'sine', gain: 0.5, release: 1.2, wet: 0.4 });
        break;
      case 'correct':
        this.brass(
          A_MAJ.map((n) => n + 12),
          t,
          0.5,
          0.06,
        );
        [69, 73, 76, 81, 85].forEach((n, i) => this.bell(n + 12, t + 0.05 + i * 0.07, 0.07));
        this.kick(t, 0.5, 'sfx');
        break;
      case 'wrong':
        this.brass([45, 52], t, 0.35, 0.08);
        this.brass([44, 51], t + 0.4, 1.2, 0.08);
        this.boom(t + 0.4, 0.7);
        break;
      case 'safe':
        this.timpaniRoll(t, 0.9);
        [72, 76, 79, 84].forEach((n, i) => this.pluck(n, t + 0.2 + i * 0.12, 0.12, 'sfx'));
        this.brass([60, 64, 67, 72], t + 0.8, 1.8, 0.05);
        this.bell(84, t + 0.8, 0.09);
        this.bell(91, t + 0.95, 0.07);
        this.boom(t + 0.8, 0.5);
        break;
      case 'win': {
        this.riser(t, 1.6, 0.14);
        this.timpaniRoll(t + 0.3, 1.3);
        const start = t + 1.6;
        this.boom(start);
        const fanfare: Array<[number[], number, number]> = [
          [[62, 66, 69], 0, 0.3],
          [[64, 68, 71], 0.45, 0.3],
          [[69, 73, 76], 0.9, 2.6],
        ];
        fanfare.forEach(([chord, at, len]) =>
          this.brass(
            chord.map((n) => n + 12),
            start + at,
            len,
            0.06,
          ),
        );
        for (let i = 0; i < 12; i++) this.bell(81 + ((i * 5) % 12), start + 0.9 + i * 0.09, 0.06);
        this.pad([69, 73, 76], start + 0.9, 3, 0.05, 2400, 'sfx');
        break;
      }
      case 'walk':
        this.pad([60, 64, 67], t, 1.6, 0.05, 1800, 'sfx');
        [79, 84, 88].forEach((n, i) => this.bell(n, t + i * 0.12, 0.07));
        break;
      case 'tick':
        this.note(1800, t, 0.02, { type: 'sine', gain: 0.12, release: 0.05, wet: 0 });
        this.note(900, t, 0.02, {
          type: 'square',
          gain: 0.03,
          release: 0.04,
          wet: 0,
          filter: { freq: 2000 },
        });
        break;
      case 'lifeline':
        this.noiseBurst(t, 0.6, { gain: 0.07, from: 400, to: 6000, wet: 0.5 });
        [76, 81, 88].forEach((n, i) => this.bell(n, t + 0.25 + i * 0.06, 0.06));
        break;
      case 'fifty':
        [0, 0.35].forEach((d) =>
          this.note(1600, t + d, 0.25, {
            type: 'sawtooth',
            gain: 0.05,
            slideTo: 120,
            filter: { freq: 3000 },
            wet: 0.3,
          }),
        );
        break;
      case 'keypad':
        for (let i = 0; i < 40; i++) {
          const at = t + Math.random() * 2.6;
          this.note(1200 + Math.floor(Math.random() * 4) * 200, at, 0.03, {
            type: 'square',
            gain: 0.02,
            release: 0.03,
            wet: 0.2,
            filter: { freq: 3500 },
          });
        }
        break;
      case 'ring':
        // A classic two-burst phone ringer.
        for (const burst of [0, 0.6]) {
          for (let i = 0; i < 8; i++) {
            const f = i % 2 === 0 ? 1350 : 1650;
            this.note(f, t + burst + i * 0.05, 0.045, {
              type: 'sine',
              gain: 0.07,
              attack: 0.003,
              release: 0.02,
              wet: 0.15,
            });
          }
        }
        break;
    }
  }

  private playBuffer(
    buffer: AudioBuffer,
    loop = false,
    dest?: AudioNode,
  ): AudioBufferSourceNode | null {
    if (!this.ctx) return null;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = loop;
    src.connect(dest ?? this.sfx);
    src.start();
    return src;
  }

  // ── Background music ─────────────────────────────────────────────────────

  private beds: Record<Exclude<BedName, 'none'>, Bed> = {
    menu: {
      bpm: 84,
      onStep: (step, time) => {
        const bar = Math.floor(step / 16);
        const chord = PROGRESSION_CALM[bar % 4]!;
        if (step % 16 === 0) this.pad(chord, time, (60 / 84) * 4, 0.035, 1100);
        if (step % 4 === 0) this.pluck(chord[(step / 4) % 3]! + 12, time, 0.05);
        if (step % 32 === 0) this.bell(chord[0]! + 24, time, 0.03, 'music');
      },
    },
    tier1: {
      bpm: 96,
      onStep: (step, time) => {
        const chord = PROGRESSION_TENSE[Math.floor(step / 16) % 4]!;
        if (step % 16 === 0) this.pad(chord, time, (60 / 96) * 4, 0.04, 900);
        if (step % 2 === 0)
          this.note(midi(chord[0]! - 24), time, 0.12, {
            type: 'sawtooth',
            gain: 0.07,
            release: 0.08,
            filter: { freq: 380 },
            wet: 0.05,
            bus: 'music',
          });
        if (step % 32 === 0) this.bell(chord[2]! + 24, time, 0.025, 'music');
      },
    },
    tier2: {
      bpm: 108,
      onStep: (step, time) => {
        const chord = PROGRESSION_TENSE[Math.floor(step / 16) % 4]!;
        if (step % 16 === 0) this.pad(chord, time, (60 / 108) * 4, 0.045, 1400);
        if (step % 2 === 0)
          this.note(midi(chord[0]! - 24), time, 0.12, {
            type: 'sawtooth',
            gain: 0.09,
            release: 0.08,
            filter: { freq: 500 },
            wet: 0.05,
            bus: 'music',
          });
        if (step % 2 === 0) this.hat(time, step % 4 === 2 ? 0.035 : 0.02);
        if (step % 2 === 1) this.pluck(chord[(step >> 1) % 3]! + 12, time, 0.045);
      },
    },
    tier3: {
      bpm: 120,
      onStep: (step, time) => {
        const chord = PROGRESSION_DARK[Math.floor(step / 16) % 4]!;
        if (step % 16 === 0) {
          this.pad(chord, time, (60 / 120) * 4, 0.05, 1800);
          this.pad([chord[2]! + 12], time, (60 / 120) * 4, 0.02, 3000);
        }
        this.note(midi(chord[0]! - 24), time, 0.08, {
          type: 'sawtooth',
          gain: step % 2 === 0 ? 0.1 : 0.05,
          release: 0.06,
          filter: { freq: 600 },
          wet: 0.05,
          bus: 'music',
        });
        this.hat(time, step % 4 === 2 ? 0.04 : 0.018);
        if (step % 8 === 0) this.kick(time, 0.35);
        this.pluck(chord[step % 3]! + 12 + (step % 8 >= 4 ? 12 : 0), time, 0.035);
      },
    },
    suspense: {
      bpm: 76,
      onStep: (step, time) => {
        if (step % 16 === 0) {
          this.pad([45, 52], time, (60 / 76) * 4, 0.05, 500);
          this.pad([76], time, (60 / 76) * 4, 0.012, 2600);
        }
        // heartbeat: lub-dub on every beat pair
        if (step % 8 === 0) this.kick(time, 0.55);
        if (step % 8 === 2) this.kick(time, 0.35);
      },
    },
    phone: {
      bpm: 60,
      onStep: (step, time) => {
        if (step % 4 === 0)
          this.note(step % 8 === 0 ? 1600 : 1300, time, 0.02, {
            type: 'sine',
            gain: 0.05,
            release: 0.04,
            wet: 0.1,
            bus: 'music',
          });
        if (step % 16 === 0) this.pad([45, 52, 57], time, 4, 0.025, 700);
      },
    },
  };

  /** Crossfades to a new background loop (or silence). */
  setBed(name: BedName): void {
    if (this.bed?.name === name) return;
    const ctx = this.ensure();
    if (!ctx) return;

    if (this.bed) {
      const old = this.bed.gain;
      old.gain.setTargetAtTime(0, ctx.currentTime, 0.25);
      setTimeout(() => old.disconnect(), 1500);
    }
    this.bedSource?.stop();
    this.bedSource = null;
    this.bed = null;
    if (name === 'none') return;

    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.gain.setTargetAtTime(1, ctx.currentTime, 0.4);
    gain.connect(this.music);

    if (this.overrides.has(`bed:${name}`)) {
      void this.buffer(`bed:${name}`).then((buf) => {
        if (buf && this.bed?.gain === gain) this.bedSource = this.playBuffer(buf, true, gain);
      });
      this.bed = { name, gain, def: { bpm: 60, onStep: () => {} }, step: 0, next: ctx.currentTime };
      return;
    }

    this.bed = { name, gain, def: this.beds[name], step: 0, next: ctx.currentTime + 0.05 };
    if (!this.scheduler) this.scheduler = window.setInterval(() => this.schedule(), 25);
  }

  get currentBed(): BedName {
    return this.bed?.name ?? 'none';
  }

  private schedule(): void {
    const ctx = this.ctx;
    const bed = this.bed;
    if (!ctx || !bed) {
      clearInterval(this.scheduler);
      this.scheduler = 0;
      return;
    }
    if (!this.musicOn || this.muted) {
      bed.next = ctx.currentTime + 0.05; // stay in sync but stay silent
      return;
    }
    const sixteenth = 60 / bed.def.bpm / 4;
    // Route this bed's notes through its own fader by temporarily pointing the music bus there.
    const musicBus = this.music;
    this.music = bed.gain;
    while (bed.next < ctx.currentTime + 0.12) {
      bed.def.onStep(bed.step, bed.next);
      bed.step++;
      bed.next += sixteenth;
    }
    this.music = musicBus;
  }
}
