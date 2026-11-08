/** Prize for each of the 15 levels, in euro. Index 0 is level 1. */
export const PRIZES = [
  100, 200, 300, 500, 1_000, 2_500, 5_000, 10_000, 20_000, 40_000, 75_000, 150_000, 250_000,
  500_000, 1_000_000,
] as const;

export const LEVEL_COUNT = PRIZES.length;

/** Prize for a 1-based level; level 0 (nothing answered yet) is worth 0 €. */
export function prizeForLevel(level: number): number {
  if (level <= 0) return 0;
  return PRIZES[Math.min(level, LEVEL_COUNT) - 1] ?? 0;
}

/**
 * Money kept after a wrong answer: the prize of the highest safe haven
 * the player has already cleared.
 *
 * @param answered number of questions answered correctly so far
 */
export function guaranteedPrize(answered: number, safeHavens: readonly number[]): number {
  const cleared = safeHavens.filter((level) => level <= answered);
  return cleared.length > 0 ? prizeForLevel(Math.max(...cleared)) : 0;
}

const euro = new Intl.NumberFormat('bg-BG', {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 0,
});

/** `1000000` → `1 000 000 €` (Bulgarian formatting). */
export function formatPrize(amount: number): string {
  return euro.format(amount);
}
