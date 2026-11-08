import { describe, expect, it } from 'vitest';
import {
  isNumericSet,
  loadQuestionBank,
  pickQuestion,
  shuffleAnswers,
  validateQuestion,
  validateQuestionFile,
} from '../src/game/questions.ts';
import { createRng } from '../src/game/random.ts';
import type { Question } from '../src/game/types.ts';
import { makePool } from './helpers.ts';

const valid: Question = {
  id: 'test-001',
  difficulty: 2,
  question: 'Колко е 2 + 2?',
  answers: ['3', '4', '5', '22'],
  correct: 1,
};

describe('validateQuestion', () => {
  it('accepts a valid question', () => {
    expect(validateQuestion(valid, 'x')).toEqual({ value: valid, errors: [] });
  });

  it.each([
    ['missing id', { ...valid, id: '' }],
    ['bad id format', { ...valid, id: 'Test 1' }],
    ['difficulty out of range', { ...valid, difficulty: 6 }],
    ['three answers', { ...valid, answers: ['a', 'b', 'c'] }],
    ['duplicate answers', { ...valid, answers: ['4', ' 4 ', '5', '6'] }],
    ['correct out of range', { ...valid, correct: 4 }],
    ['empty explanation', { ...valid, explanation: ' ' }],
  ])('rejects %s', (_, raw) => {
    const result = validateQuestion(raw, 'x');
    expect(result.value).toBeNull();
    expect(result.errors.length).toBeGreaterThan(0);
  });
});

describe('validateQuestionFile', () => {
  it('drops invalid and duplicate questions but keeps the rest', () => {
    const result = validateQuestionFile(
      {
        category: 'test',
        name: 'Тест',
        questions: [valid, { ...valid }, { ...valid, id: 'bad', correct: 9 }],
      },
      'test.json',
    );
    expect(result.value?.questions).toHaveLength(1);
    expect(result.errors).toHaveLength(2);
  });
});

describe('loadQuestionBank', () => {
  it('loads the manifest and every category', async () => {
    const files: Record<string, unknown> = {
      '/q/manifest.json': {
        categories: [
          { id: 'a', name: 'А', icon: '🅰', file: 'a.json' },
          { id: 'b', name: 'Б', icon: '🅱', file: 'b.json' },
        ],
      },
      '/q/a.json': { category: 'a', name: 'А', questions: [valid] },
      '/q/b.json': { category: 'b', name: 'Б', questions: [] },
    };
    const bank = await loadQuestionBank('/q', async (url) => files[url]);
    expect(bank.categories.map((c) => c.id)).toEqual(['a']); // empty category is skipped
    expect(bank.questions[0]).toMatchObject({ id: 'test-001', category: 'a' });
  });
});

describe('pickQuestion', () => {
  const pool = makePool(3);
  const rng = createRng(1);

  it('picks the exact difficulty from the selected categories', () => {
    for (let i = 0; i < 50; i++) {
      const q = pickQuestion(
        pool,
        { difficulty: 3, categories: new Set(['science']), exclude: new Set() },
        rng,
      );
      expect(q).toMatchObject({ difficulty: 3, category: 'science' });
    }
  });

  it('never returns excluded questions', () => {
    const exclude = new Set(
      pool
        .filter((q) => q.difficulty === 2)
        .map((q) => q.id)
        .slice(1),
    );
    const q = pickQuestion(pool, { difficulty: 2, categories: null, exclude }, rng);
    expect(q?.id).toBe(pool.find((p) => p.difficulty === 2)!.id);
  });

  it('prefers questions that were not seen recently', () => {
    const level1 = pool.filter((q) => q.difficulty === 1);
    const recent = new Set(level1.slice(1).map((q) => q.id));
    for (let i = 0; i < 20; i++) {
      const q = pickQuestion(
        pool,
        { difficulty: 1, categories: null, exclude: new Set(), recent },
        rng,
      );
      expect(q?.id).toBe(level1[0]!.id);
    }
  });

  it('relaxes difficulty, then category, when it runs out', () => {
    const onlyScience = makePool(1, ['science']).filter((q) => q.difficulty !== 4);
    const history = makePool(1, ['history']);
    const q = pickQuestion(
      [...onlyScience, ...history],
      { difficulty: 4, categories: new Set(['science']), exclude: new Set() },
      rng,
    );
    expect(q?.category).toBe('science');
    expect([3, 5]).toContain(q?.difficulty);
  });

  it('returns null when nothing is left', () => {
    const exclude = new Set(pool.map((q) => q.id));
    expect(pickQuestion(pool, { difficulty: 1, categories: null, exclude }, rng)).toBeNull();
  });
});

describe('shuffleAnswers', () => {
  it('keeps the correct answer pointing at the same text', () => {
    const rng = createRng(42);
    for (let i = 0; i < 100; i++) {
      const shuffled = shuffleAnswers(valid, rng);
      expect(shuffled.answers[shuffled.correct]).toBe('4');
      expect([...shuffled.answers].sort()).toEqual([...valid.answers].sort());
    }
  });
});

describe('numeric answers', () => {
  it.each([
    [['6', '8', '10', '12'], true],
    [['343 m/s', '150 m/s', '1000 m/s', '3000 m/s'], true],
    [['-273', '-459', '-100', '0'], true],
    [['2,54', '0,91', '1,61', '3,28'], true],
    [['13,8 милиарда', '4,5 милиарда', '100 милиона', '1 трилион'], false],
    [['Волга', 'Дунав', 'Рейн', 'Днепър'], false],
  ])('%j is numeric: %s', (answers, expected) => {
    expect(isNumericSet(answers)).toBe(expected);
  });

  it('shows numbers in ascending order instead of shuffling them', () => {
    const q: Question = { ...valid, answers: ['12', '6', '10', '8'], correct: 2 };
    const shown = shuffleAnswers(q, createRng(1));
    expect(shown.answers).toEqual(['6', '8', '10', '12']);
    expect(shown.answers[shown.correct]).toBe('10');
  });

  it('still shuffles text answers', () => {
    const q: Question = { ...valid, answers: ['Волга', 'Дунав', 'Рейн', 'Днепър'], correct: 0 };
    const rng = createRng(9);
    const orders = new Set(Array.from({ length: 20 }, () => shuffleAnswers(q, rng).answers.join()));
    expect(orders.size).toBeGreaterThan(1);
  });
});
