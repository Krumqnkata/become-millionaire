import { describe, expect, it } from 'vitest';
import { romanToNumber, splitForSpeech, toSpeech } from '../src/audio/speech-text.ts';
import { formatPrize } from '../src/game/ladder.ts';

describe('toSpeech', () => {
  it('reads prizes as whole numbers in euro', () => {
    expect(toSpeech(`Въпрос за ${formatPrize(1_000_000)}.`)).toBe('Въпрос за 1000000 евро.');
    expect(toSpeech('Имаш 2 500 €!')).toBe('Имаш 2500 евро!');
  });

  it('spells out units and symbols', () => {
    expect(toSpeech('343 m/s')).toBe('343 метра в секунда');
    expect(toSpeech('9,8 m/s²')).toBe('9,8 метра в секунда на квадрат');
    expect(toSpeech('42,2 km')).toBe('42,2 километра');
    expect(toSpeech('3,05 m')).toBe('3,05 метра');
    expect(toSpeech('100 °C')).toBe('100 градуса');
    expect(toSpeech('А: 69%')).toBe('А: 69 процента');
    expect(toSpeech('Жокерът 50:50')).toBe('Жокерът петдесет на петдесет');
  });

  it('reads centuries and rulers', () => {
    expect(toSpeech('през IX век')).toBe('през девети век');
    expect(toSpeech('Николай II абдикира')).toBe('Николай Втори абдикира');
    expect(toSpeech('Елизабет I')).toBe('Елизабет Първа');
    expect(toSpeech('Цар Симеон I Велики')).toBe('Цар Симеон Първи Велики');
  });

  it('drops emoji, stars and quotes', () => {
    expect(toSpeech('🔒 „Арго“ ★★☆')).toBe('Арго');
  });

  it('leaves Latin words alone', () => {
    expect(toSpeech('HTML и CSS')).toBe('HTML и CSS');
    expect(toSpeech('Magna Carta')).toBe('Magna Carta');
  });
});

describe('romanToNumber', () => {
  it.each([
    ['I', 1],
    ['IV', 4],
    ['IX', 9],
    ['XIV', 14],
    ['XXI', 21],
  ])('%s → %i', (roman, n) => expect(romanToNumber(roman)).toBe(n));
});

describe('splitForSpeech', () => {
  it('keeps short text whole', () => {
    expect(splitForSpeech('Здравей! Как си?')).toEqual(['Здравей! Как си?']);
  });

  it('splits long text on sentence boundaries', () => {
    const long = `${'Едно изречение тук. '.repeat(12)}Край!`;
    const chunks = splitForSpeech(long, 80);
    expect(chunks.length).toBeGreaterThan(1);
    chunks.forEach((c) => expect(c.length).toBeLessThanOrEqual(80));
    expect(chunks.join(' ')).toBe(long.trim());
  });
});
