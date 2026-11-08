import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkQuestionBank } from '../scripts/check-bank.ts';
import { Game } from '../src/game/engine.ts';
import { MODE_ORDER, MODES } from '../src/game/modes.ts';
import { loadQuestionBank } from '../src/game/questions.ts';
import { createRng } from '../src/game/random.ts';

const root = resolve(import.meta.dirname, '../public/questions');
const readJson = (file: string): unknown => JSON.parse(readFileSync(resolve(root, file), 'utf8'));

describe('the real question bank', () => {
  it('passes every content check', () => {
    const report = checkQuestionBank(readJson);
    expect(report.errors).toEqual([]);
    expect(report.total).toBeGreaterThanOrEqual(500);
  });

  it.each(MODE_ORDER)(
    'can be played to the million in %s mode, in every category',
    async (modeId) => {
      const bank = await loadQuestionBank('/', async (url) => readJson(url.slice(1)));
      const categories = [[], ...bank.categories.map((c) => [c.id])];

      for (const selected of categories) {
        const game = new Game({
          mode: MODES[modeId],
          pool: bank.questions,
          categories: new Set(selected),
          rng: createRng(7),
        });
        while (game.phase !== 'finished') {
          game.lockIn(game.question.correct);
          game.reveal();
          if (game.phase === 'correct') game.next();
        }
        expect(game.outcome).toBe('won');
        expect(game.seenIds.size).toBe(15);
      }
    },
  );
});
