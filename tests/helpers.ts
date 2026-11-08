import type { CategorizedQuestion, Difficulty } from '../src/game/types.ts';

/** Builds a synthetic pool: `perDifficulty` questions for every difficulty and category. */
export function makePool(
  perDifficulty = 6,
  categories: string[] = ['history', 'science'],
): CategorizedQuestion[] {
  const pool: CategorizedQuestion[] = [];
  for (const category of categories) {
    for (let d = 1; d <= 5; d++) {
      for (let n = 0; n < perDifficulty; n++) {
        pool.push({
          id: `${category}-${d}-${n}`,
          category,
          difficulty: d as Difficulty,
          question: `Въпрос ${category} ${d}/${n}?`,
          answers: ['верен', 'грешен 1', 'грешен 2', 'грешен 3'],
          correct: 0,
        });
      }
    }
  }
  return pool;
}
