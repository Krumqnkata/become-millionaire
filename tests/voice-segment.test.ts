import { describe, expect, it } from 'vitest';
import { expectedSeconds, pad, segment, speechRegions } from '../scripts/voice-segment.ts';

const SR = 8000;

/** Builds a fake recording: tone bursts ("speech") separated by silences. */
function audio(parts: Array<['speech' | 'silence', number]>): Float32Array {
  const total = parts.reduce((n, [, s]) => n + s, 0);
  const out = new Float32Array(Math.round(total * SR));
  let at = 0;
  for (const [kind, seconds] of parts) {
    const len = Math.round(seconds * SR);
    if (kind === 'speech')
      for (let i = 0; i < len; i++) out[at + i] = 0.3 * Math.sin((2 * Math.PI * 220 * i) / SR);
    at += len;
  }
  return out;
}

describe('speechRegions', () => {
  it('finds speech and ignores very short gaps inside words', () => {
    const regions = speechRegions(
      audio([
        ['silence', 0.2],
        ['speech', 0.5],
        ['silence', 0.05],
        ['speech', 0.3],
        ['silence', 0.6],
        ['speech', 0.4],
        ['silence', 0.2],
      ]),
      SR,
    );
    expect(regions).toHaveLength(2);
    expect(regions[0]!.start).toBeCloseTo(0.2, 1);
    expect(regions[0]!.end).toBeCloseTo(1.05, 1);
    expect(regions[1]!.start).toBeCloseTo(1.65, 1);
  });
});

describe('segment', () => {
  // A question sprite: question, then "А: 1389"-style answers with a short pause after the letter.
  const sprite = audio([
    ['silence', 0.15],
    ['speech', 2.6], // question
    ['silence', 1.6],
    ['speech', 0.35],
    ['silence', 0.42],
    ['speech', 1.7], // А: …
    ['silence', 0.65],
    ['speech', 0.3],
    ['silence', 0.42],
    ['speech', 2.0], // Б: …
    ['silence', 0.65],
    ['speech', 0.3],
    ['silence', 0.42],
    ['speech', 1.9], // В: …
    ['silence', 0.65],
    ['speech', 0.3],
    ['silence', 0.42],
    ['speech', 2.1], // Г: …
    ['silence', 0.45],
    ['speech', 0.5], // closing word
    ['silence', 0.3],
  ]);
  const items = [
    { expected: 2.6 },
    { expected: 2.4 },
    { expected: 2.6 },
    { expected: 2.6 },
    { expected: 2.8 },
    { expected: 0.5 },
  ];

  it('puts boundaries into the real pauses, not the short pause after the letter', () => {
    const spans = segment(speechRegions(sprite, SR), items)!;
    expect(spans).toHaveLength(6);
    expect(spans[0]![1]).toBeCloseTo(2.75, 1); // question ends
    expect(spans[1]![0]).toBeCloseTo(4.35, 1); // "А" starts
    expect(spans[1]![1]).toBeCloseTo(6.82, 1); // its answer ends, not at the letter
  });

  it('is not fooled by bookmark hints that are two seconds early', () => {
    const hinted = items.map((item, i) => ({ ...item, hint: i === 2 ? 5.5 : undefined }));
    const spans = segment(speechRegions(sprite, SR), hinted)!;
    expect(spans[2]![0]).toBeCloseTo(7.47, 1); // "Б" really starts here
  });

  it('gives up when there are fewer regions than phrases', () => {
    expect(segment([{ start: 0, end: 1 }], [{ expected: 1 }, { expected: 1 }])).toBeNull();
  });

  it('pads spans without overlapping neighbours', () => {
    const padded = pad(
      [
        [1, 2],
        [2.1, 3],
      ],
      4,
    );
    expect(padded[0]![1]).toBeLessThanOrEqual(padded[1]![0]);
    expect(padded[0]![0]).toBe(0.88);
  });
});

describe('expectedSeconds', () => {
  it('counts digits as longer than letters', () => {
    expect(expectedSeconds('А: 1389')).toBeGreaterThan(expectedSeconds('А: Волга'));
  });
});
