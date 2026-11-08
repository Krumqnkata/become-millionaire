import { describe, expect, it } from 'vitest';
import { createRng } from '../src/game/random.ts';
import { fill, HOST, line, LINES, questionIntroKey, type LineKey } from '../src/show/script.ts';

const ALL_VARS = {
  name: 'Мария',
  prize: '5 000 €',
  level: 7,
  letter: 'В',
  answer: 'Дунав',
  guaranteed: '1 000 €',
  friend: 'Иво',
  next: '10 000 €',
};

describe('host script', () => {
  it('fills placeholders, including the host name', () => {
    expect(fill('Здравей, {name}! Аз съм {host}.', { name: 'Мария' })).toBe(
      `Здравей, Мария! Аз съм ${HOST.name}.`,
    );
  });

  it('leaves unknown placeholders visible instead of printing "undefined"', () => {
    expect(fill('{nope}', {})).toBe('{nope}');
  });

  it.each(Object.keys(LINES) as LineKey[])(
    'every "%s" line resolves all of its placeholders',
    (key) => {
      for (const template of LINES[key]) {
        expect(fill(template, ALL_VARS)).not.toMatch(/\{\w+\}/);
      }
    },
  );

  it('picks variations at random', () => {
    const rng = createRng(3);
    const seen = new Set(Array.from({ length: 50 }, () => line('correct', ALL_VARS, rng)));
    expect(seen.size).toBeGreaterThan(1);
  });

  it('chooses the right intro for each level', () => {
    expect(questionIntroKey(1, false, 15)).toBe('firstQuestion');
    expect(questionIntroKey(5, true, 15)).toBe('safeQuestion');
    expect(questionIntroKey(7, false, 15)).toBe('question');
    expect(questionIntroKey(12, false, 15)).toBe('bigQuestion');
    expect(questionIntroKey(15, false, 15)).toBe('millionQuestion');
  });
});
