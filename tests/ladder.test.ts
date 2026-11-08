import { describe, expect, it } from 'vitest';
import {
  formatPrize,
  guaranteedPrize,
  LEVEL_COUNT,
  prizeForLevel,
  PRIZES,
} from '../src/game/ladder.ts';
import { MODES } from '../src/game/modes.ts';

describe('ladder', () => {
  it('has 15 strictly increasing prizes ending at one million', () => {
    expect(LEVEL_COUNT).toBe(15);
    expect(PRIZES.at(-1)).toBe(1_000_000);
    for (let i = 1; i < PRIZES.length; i++) expect(PRIZES[i]).toBeGreaterThan(PRIZES[i - 1]!);
  });

  it('maps levels to prizes', () => {
    expect(prizeForLevel(0)).toBe(0);
    expect(prizeForLevel(1)).toBe(100);
    expect(prizeForLevel(5)).toBe(1_000);
    expect(prizeForLevel(15)).toBe(1_000_000);
  });

  it('falls back to the last cleared safe haven', () => {
    const havens = [5, 10];
    expect(guaranteedPrize(0, havens)).toBe(0);
    expect(guaranteedPrize(4, havens)).toBe(0);
    expect(guaranteedPrize(5, havens)).toBe(1_000);
    expect(guaranteedPrize(9, havens)).toBe(1_000);
    expect(guaranteedPrize(14, havens)).toBe(40_000);
    expect(guaranteedPrize(14, [])).toBe(0);
  });

  it('formats prizes the Bulgarian way', () => {
    // Intl uses a narrow no-break space as the thousands separator.
    expect(formatPrize(1_000_000).replace(/\s/g, ' ')).toBe('1 000 000 €');
  });
});

describe('modes', () => {
  it.each(Object.values(MODES))('$name has a valid 15-step difficulty curve', (mode) => {
    expect(mode.difficultyCurve).toHaveLength(LEVEL_COUNT);
    for (let i = 1; i < mode.difficultyCurve.length; i++)
      expect(mode.difficultyCurve[i]).toBeGreaterThanOrEqual(mode.difficultyCurve[i - 1]!);
    mode.safeHavens.forEach((level) => expect(level).toBeGreaterThanOrEqual(1));
    mode.safeHavens.forEach((level) => expect(level).toBeLessThan(LEVEL_COUNT));
  });
});
