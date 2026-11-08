import { MODES } from '../src/game/modes.ts';
import {
  countByDifficulty,
  validateManifest,
  validateQuestionFile,
} from '../src/game/questions.ts';
import type { Difficulty, Question } from '../src/game/types.ts';

export interface BankReport {
  errors: string[];
  warnings: string[];
  total: number;
  perCategory: Record<string, number>;
  perDifficulty: Record<Difficulty, number>;
}

/** A word that mixes Latin and Cyrillic letters is almost always a typo (e.g. a Latin "e" in "Амадeус"). */
const MIXED_SCRIPT =
  /[\p{Script=Latin}][\p{Script=Cyrillic}]|[\p{Script=Cyrillic}][\p{Script=Latin}]/u;

/** How many questions of each difficulty the most demanding mode can consume in one game. */
function requiredPerDifficulty(): Record<Difficulty, number> {
  const required: Record<Difficulty, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const mode of Object.values(MODES)) {
    const counts: Record<Difficulty, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    mode.difficultyCurve.forEach((d) => counts[d]++);
    const extra = mode.lifelines.includes('switch') ? 1 : 0;
    for (const d of [1, 2, 3, 4, 5] as Difficulty[])
      required[d] = Math.max(required[d], counts[d] + extra);
  }
  return required;
}

/**
 * Runs every content check over the question bank.
 * Shared by `npm run validate` and the test suite.
 */
export function checkQuestionBank(readJson: (file: string) => unknown): BankReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const perCategory: Record<string, number> = {};
  const all: Question[] = [];
  const ids = new Map<string, string>();
  const texts = new Map<string, string>();

  const manifest = validateManifest(readJson('manifest.json'));
  errors.push(...manifest.errors);

  for (const meta of manifest.value?.categories ?? []) {
    let raw: unknown;
    try {
      raw = readJson(meta.file);
    } catch (error) {
      errors.push(`${meta.file}: не може да се прочете (${(error as Error).message})`);
      continue;
    }

    const { value: file, errors: fileErrors } = validateQuestionFile(raw, meta.file);
    errors.push(...fileErrors);
    if (!file) continue;

    if (file.category !== meta.id)
      errors.push(
        `${meta.file}: "category" е "${file.category}", а в manifest.json е "${meta.id}"`,
      );

    perCategory[meta.name] = file.questions.length;

    for (const q of file.questions) {
      const where = `${meta.file} [${q.id}]`;

      const otherFile = ids.get(q.id);
      if (otherFile && otherFile !== meta.file)
        errors.push(`${where}: id-то вече се използва в ${otherFile}`);
      ids.set(q.id, meta.file);

      const key = q.question.toLocaleLowerCase('bg');
      const duplicateOf = texts.get(key);
      if (duplicateOf) errors.push(`${where}: същият въпрос вече съществува (${duplicateOf})`);
      texts.set(key, q.id);

      for (const text of [q.question, ...q.answers, q.explanation ?? '']) {
        const word = text.split(/\s+/).find((w) => MIXED_SCRIPT.test(w));
        if (word) errors.push(`${where}: думата „${word}“ смесва латиница и кирилица`);
      }

      if (!q.question.endsWith('?')) warnings.push(`${where}: въпросът не завършва с „?“`);
      all.push(q);
    }
  }

  const perDifficulty = countByDifficulty(all);
  const required = requiredPerDifficulty();
  for (const d of [1, 2, 3, 4, 5] as Difficulty[]) {
    if (perDifficulty[d] < required[d])
      errors.push(
        `Трудност ${d}: има ${perDifficulty[d]} въпроса, а една игра може да изиска ${required[d]}`,
      );
  }

  return { errors, warnings, total: all.length, perCategory, perDifficulty };
}
