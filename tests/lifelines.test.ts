import { describe, expect, it } from 'vitest';
import { askAudience, fiftyFifty, FRIENDS, phoneFriend } from '../src/game/lifelines.ts';
import { createRng } from '../src/game/random.ts';
import type { AnswerIndex, Difficulty } from '../src/game/types.ts';

const ALL: AnswerIndex[] = [0, 1, 2, 3];
const RUNS = 2_000;

describe('fiftyFifty', () => {
  it('always removes exactly two wrong answers', () => {
    const rng = createRng(7);
    for (let i = 0; i < 200; i++) {
      const correct = (i % 4) as AnswerIndex;
      const hidden = fiftyFifty(correct, rng);
      expect(hidden).toHaveLength(2);
      expect(hidden).not.toContain(correct);
      expect(new Set(hidden).size).toBe(2);
    }
  });
});

describe('askAudience', () => {
  it('returns integer percentages that add up to 100', () => {
    const rng = createRng(3);
    for (let i = 0; i < 500; i++) {
      const votes = askAudience(2, ((i % 5) + 1) as Difficulty, ALL, rng);
      expect(votes.reduce((a, b) => a + b, 0)).toBe(100);
      votes.forEach((v) => expect(Number.isInteger(v)).toBe(true));
    }
  });

  it('gives 0 % to answers hidden by 50:50', () => {
    const votes = askAudience(1, 3, [1, 3], createRng(5));
    expect(votes[0]).toBe(0);
    expect(votes[2]).toBe(0);
    expect(votes[1]! + votes[3]!).toBe(100);
  });

  it('is more reliable on easy questions than on hard ones', () => {
    const leaderAccuracy = (difficulty: Difficulty) => {
      const rng = createRng(11);
      let right = 0;
      for (let i = 0; i < RUNS; i++) {
        const votes = askAudience(0, difficulty, ALL, rng);
        if (votes.indexOf(Math.max(...votes)) === 0) right++;
      }
      return right / RUNS;
    };
    const easy = leaderAccuracy(1);
    const hard = leaderAccuracy(5);
    expect(easy).toBeGreaterThan(0.95);
    expect(hard).toBeLessThan(easy);
    expect(hard).toBeGreaterThan(0.4);
  });
});

describe('phoneFriend', () => {
  const friend = FRIENDS.find((f) => f.expertise.includes('sport'))!;

  const accuracy = (difficulty: Difficulty, category: string) => {
    const rng = createRng(99);
    let right = 0;
    for (let i = 0; i < RUNS; i++) {
      if (phoneFriend(0, difficulty, category, ALL, rng, friend).answer === 0) right++;
    }
    return right / RUNS;
  };

  it('answers within the available options and talks like a person', () => {
    const call = phoneFriend(3, 4, 'history', [0, 3], createRng(1), friend);
    expect([0, 3]).toContain(call.answer);
    expect(call.message).toMatch(/[АГ]/);
    expect(call.confidence).toBeGreaterThanOrEqual(10);
    expect(call.confidence).toBeLessThanOrEqual(99);
  });

  it('gets worse as questions get harder', () => {
    expect(accuracy(1, 'history')).toBeGreaterThan(accuracy(5, 'history'));
  });

  it('is better in their own field', () => {
    expect(accuracy(4, 'sport')).toBeGreaterThan(accuracy(4, 'history'));
    expect(phoneFriend(0, 1, 'sport', ALL, createRng(2), friend).isExpert).toBe(true);
  });
});
