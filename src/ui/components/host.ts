import type { ShowAudio } from '../../audio/engine.ts';
import type { Voice } from '../../audio/voice.ts';
import { HOST } from '../../show/script.ts';
import { h, prefersReducedMotion, s, wait } from '../dom.ts';

export type HostMood = 'neutral' | 'happy' | 'sad' | 'tense';

export interface HostView {
  el: HTMLElement;
  /** Shows a line in the speech bubble and reads it aloud. Resolves when finished (or skipped). */
  say(text: string, opts?: { mood?: HostMood; pitch?: number; speaker?: string }): Promise<void>;
  /** Finishes the current line immediately. */
  skip(): void;
  setMood(mood: HostMood): void;
  stop(): void;
}

const MOUTHS: Record<HostMood, string> = {
  neutral: 'M52 65 Q60 70 68 65',
  happy: 'M50 63 Q60 75 70 63',
  sad: 'M52 69 Q60 63 68 69',
  tense: 'M53 67 L67 67',
};

/** The host's portrait: an original illustrated presenter in a navy suit with a gold bow tie. */
function avatar(): { svg: SVGSVGElement; mouth: SVGPathElement } {
  const mouth = s('path', {
    class: 'host__mouth',
    d: MOUTHS.happy,
    fill: 'none',
    stroke: '#7a2e2e',
    'stroke-width': 2.6,
    'stroke-linecap': 'round',
  });
  const svg = s(
    'svg',
    { viewBox: '0 0 120 120', class: 'host__avatar', 'aria-hidden': 'true' },
    s(
      'defs',
      null,
      s(
        'radialGradient',
        { id: 'host-spot', cx: '0.5', cy: '0.35', r: '0.7' },
        s('stop', { offset: '0', 'stop-color': '#3a4cb0' }),
        s('stop', { offset: '1', 'stop-color': '#0d1433' }),
      ),
    ),
    s('circle', {
      cx: 60,
      cy: 60,
      r: 59,
      fill: 'url(#host-spot)',
      stroke: '#f5c542',
      'stroke-width': 2,
    }),
    s('path', { d: 'M16 120 C20 93 38 84 60 84 C82 84 100 93 104 120 Z', fill: '#16205a' }),
    s('path', { d: 'M49 84 L60 104 L71 84 Z', fill: '#f4f6ff' }),
    s('path', {
      d: 'M49 84 L60 104 L45 120 M71 84 L60 104 L75 120',
      fill: 'none',
      stroke: '#f5c542',
      'stroke-width': 2,
    }),
    s('rect', { x: 53, y: 70, width: 14, height: 16, rx: 5, fill: '#d99b74' }),
    s('path', { d: 'M51 88 L60 92 L51 97 Z M69 88 L60 92 L69 97 Z', fill: '#f5c542' }),
    s('circle', { cx: 60, cy: 92, r: 2.2, fill: '#c8961e' }),
    s('circle', { cx: 38, cy: 54, r: 5, fill: '#eab48f' }),
    s('circle', { cx: 82, cy: 54, r: 5, fill: '#eab48f' }),
    s('ellipse', { cx: 60, cy: 52, rx: 22, ry: 25, fill: '#f1c09c' }),
    s('path', {
      d: 'M37 50 C34 30 48 21 62 22 C78 22 88 32 83 50 C81 41 74 34 66 34 C58 37 46 36 40 41 C38 44 37 47 37 50 Z',
      fill: '#2b1d16',
    }),
    s('path', {
      d: 'M46 45 Q51 42 56 45 M64 45 Q69 42 74 45',
      fill: 'none',
      stroke: '#2b1d16',
      'stroke-width': 2,
      'stroke-linecap': 'round',
    }),
    s(
      'g',
      { class: 'host__eyes' },
      s('ellipse', { cx: 51, cy: 52, rx: 2.6, ry: 3, fill: '#1a1a2e' }),
      s('ellipse', { cx: 69, cy: 52, rx: 2.6, ry: 3, fill: '#1a1a2e' }),
    ),
    s('path', {
      d: 'M60 54 Q58 60 61 61',
      fill: 'none',
      stroke: '#c98e6a',
      'stroke-width': 1.8,
      'stroke-linecap': 'round',
    }),
    mouth,
    // handheld microphone
    s('rect', {
      x: 86,
      y: 92,
      width: 7,
      height: 24,
      rx: 3,
      fill: '#2c2f45',
      transform: 'rotate(-18 89 104)',
    }),
    s('circle', { cx: 86, cy: 89, r: 6, fill: '#9aa3c7' }),
  );
  return { svg, mouth };
}

export function createHost(voice: Voice, audio: ShowAudio): HostView {
  const { svg, mouth } = avatar();
  const speaker = h('span', { class: 'host__name' }, HOST.name);
  const text = h('p', { class: 'host__text' });
  const bubble = h(
    'div',
    { class: 'host__bubble', title: 'Кликни, за да продължиш' },
    speaker,
    text,
  );
  const el = h(
    'div',
    { class: 'host', role: 'log', 'aria-live': 'polite', 'aria-label': 'Водещият' },
    h('div', { class: 'host__portrait' }, svg),
    bubble,
  );

  let skipCurrent: (() => void) | null = null;
  let token = 0;

  const setMood = (mood: HostMood) => {
    mouth.setAttribute('d', MOUTHS[mood]);
    el.dataset.mood = mood;
  };

  async function say(
    line: string,
    {
      mood = 'neutral',
      pitch,
      speaker: who,
    }: { mood?: HostMood; pitch?: number; speaker?: string } = {},
  ) {
    const my = ++token;
    skipCurrent?.();
    setMood(mood);
    speaker.textContent = who ?? HOST.name;
    el.classList.toggle('is-guest', Boolean(who));
    el.classList.add('is-talking');
    text.textContent = '';
    bubble.classList.remove('is-pop');
    void bubble.offsetWidth;
    bubble.classList.add('is-pop');
    audio.duck(true);

    let skipped = false;
    const skipPromise = new Promise<void>((resolve) => {
      skipCurrent = () => {
        skipped = true;
        resolve();
      };
    });

    const typing = (async () => {
      if (prefersReducedMotion()) {
        text.textContent = line;
        return;
      }
      for (let i = 1; i <= line.length && !skipped && my === token; i++) {
        text.textContent = line.slice(0, i);
        await wait(line[i - 1] === ' ' ? 18 : 24);
      }
    })();

    // Without a voice, leave enough time to read the line.
    const speaking =
      voice.enabled && voice.available
        ? voice.speak(line, pitch ? { pitch } : {})
        : wait(Math.min(3200, 700 + line.length * 28));

    await Promise.race([Promise.all([typing, speaking]), skipPromise]);
    if (skipped) voice.stop();
    if (my === token) {
      text.textContent = line;
      el.classList.remove('is-talking');
      audio.duck(false);
      skipCurrent = null;
    }
  }

  bubble.addEventListener('click', () => skipCurrent?.());

  setMood('happy');
  return {
    el,
    say,
    skip: () => skipCurrent?.(),
    setMood,
    stop() {
      token++;
      skipCurrent?.();
      voice.stop();
      el.classList.remove('is-talking');
      audio.duck(false);
    },
  };
}
