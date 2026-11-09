import { describe, expect, it } from 'vitest';
import { Game } from '../src/game/engine.ts';
import { MODES } from '../src/game/modes.ts';
import {
  draftProblems,
  emptyDraft,
  packToBank,
  parseQuestions,
  type PackDraft,
  type PackQuestion,
} from '../src/game/packs.ts';
import { createRng } from '../src/game/random.ts';

const q = (i: number, overrides: Partial<PackQuestion> = {}): PackQuestion => ({
  question: `Въпрос номер ${i}?`,
  answers: [`А${i}`, `Б${i}`, `В${i}`, `Г${i}`],
  correct: (i % 4) as PackQuestion['correct'],
  difficulty: ((i % 5) + 1) as PackQuestion['difficulty'],
  ...overrides,
});

const draft = (count: number, overrides: Partial<PackDraft> = {}): PackDraft => ({
  title: 'Моят пакет',
  description: '',
  visibility: 'private',
  questions: Array.from({ length: count }, (_, i) => q(i + 1)),
  ...overrides,
});

describe('draftProblems', () => {
  it('accepts a complete pack', () => {
    expect(draftProblems(draft(15, { visibility: 'public' }))).toEqual([]);
  });

  it('allows a short private draft but not a short shared one', () => {
    expect(draftProblems(draft(3))).toEqual([]);
    expect(draftProblems(draft(3, { visibility: 'link' })).join()).toMatch(/поне 15 въпроса/);
  });

  it('names the question that has a problem', () => {
    const d = draft(2);
    d.questions[1] = q(2, { answers: ['Да', 'да', 'Не', 'Може'] });
    expect(draftProblems(d)).toEqual(['Въпрос 2: отговорите трябва да са различни']);
  });

  it('reports a missing title and empty fields in a fresh draft', () => {
    const problems = draftProblems(emptyDraft());
    expect(problems).toContain('Пакетът няма име');
    expect(problems.some((p) => p.startsWith('Въпрос 1:'))).toBe(true);
  });

  it('enforces length limits', () => {
    expect(draftProblems(draft(1, { title: 'x'.repeat(81) })).join()).toMatch(/Името/);
    const long = draft(1);
    long.questions[0] = q(1, { question: 'x'.repeat(301) });
    expect(draftProblems(long).join()).toMatch(/по-дълъг от 300/);
  });
});

describe('parseQuestions', () => {
  it('keeps valid questions, trims them and skips broken ones', () => {
    const parsed = parseQuestions([
      { ...q(1), question: '  С интервали?  ', explanation: '   ' },
      { question: 'Без отговори', correct: 0, difficulty: 1 },
      'нещо',
      { ...q(2), correct: 7 },
      q(3),
    ]);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]?.question).toBe('С интервали?');
    expect(parsed[0]).not.toHaveProperty('explanation');
  });

  it('returns nothing for something that is not a list', () => {
    expect(parseQuestions({ questions: [] })).toEqual([]);
  });
});

describe('packToBank', () => {
  it('builds a one-category bank the engine can play to the end', () => {
    const bank = packToBank({ id: 'AbC123', title: 'Моят пакет', questions: draft(15).questions });
    expect(bank.categories).toEqual([
      { id: 'pack-AbC123', name: 'Моят пакет', icon: '📝', file: '' },
    ]);
    expect(new Set(bank.questions.map((x) => x.id)).size).toBe(15);
    expect(bank.questions[0]?.id).toBe('pack-abc123-1');

    const game = new Game({ mode: MODES.easy, pool: bank.questions, rng: createRng(3) });
    for (let level = 1; level <= 15; level++) {
      game.lockIn(game.question.correct);
      game.reveal();
      if (level < 15) game.next();
    }
    expect(game.outcome).toBe('won');
  });
});

describe('switching the question in a small pack', () => {
  it('is only offered while a spare question is left', () => {
    const exact = packToBank({ id: 'a', title: 'x', questions: draft(15).questions });
    expect(new Game({ mode: MODES.easy, pool: exact.questions }).canUseLifeline('switch')).toBe(
      false,
    );

    const spare = packToBank({ id: 'b', title: 'x', questions: draft(16).questions });
    const game = new Game({ mode: MODES.easy, pool: spare.questions, rng: createRng(1) });
    expect(game.canUseLifeline('switch')).toBe(true);
    game.useLifeline('switch');
    for (let level = 1; level < 15; level++) {
      game.lockIn(game.question.correct);
      game.reveal();
      game.next();
    }
    expect(game.level).toBe(15);
  });
});
