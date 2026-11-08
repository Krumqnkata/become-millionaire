import { pick, shuffle } from './random.ts';
import type {
  AnswerIndex,
  CategorizedQuestion,
  CategoryMeta,
  Difficulty,
  Manifest,
  Question,
  QuestionFile,
  Rng,
} from './types.ts';

// ─── Validation ──────────────────────────────────────────────────────────────

export interface ValidationResult<T> {
  value: T | null;
  errors: string[];
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const isNonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';

const normalize = (s: string) => s.trim().toLocaleLowerCase('bg');

/** Validates a single question. Returns every problem found, not just the first. */
export function validateQuestion(raw: unknown, where: string): ValidationResult<Question> {
  const errors: string[] = [];
  if (!isObject(raw)) return { value: null, errors: [`${where}: въпросът трябва да е обект`] };

  const { id, difficulty, question, answers, correct, explanation } = raw;
  const label = isNonEmptyString(id) ? `${where} [${id}]` : where;

  if (!isNonEmptyString(id)) errors.push(`${where}: липсва "id"`);
  else if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id))
    errors.push(`${label}: "id" трябва да е kebab-case (напр. "hist-001")`);

  if (!Number.isInteger(difficulty) || (difficulty as number) < 1 || (difficulty as number) > 5)
    errors.push(`${label}: "difficulty" трябва да е цяло число от 1 до 5`);

  if (!isNonEmptyString(question)) errors.push(`${label}: липсва текст на въпроса`);

  if (!Array.isArray(answers) || answers.length !== 4) {
    errors.push(`${label}: "answers" трябва да съдържа точно 4 отговора`);
  } else if (!answers.every(isNonEmptyString)) {
    errors.push(`${label}: всички отговори трябва да са непразни текстове`);
  } else if (new Set(answers.map(normalize)).size !== 4) {
    errors.push(`${label}: отговорите трябва да са различни`);
  }

  if (!Number.isInteger(correct) || (correct as number) < 0 || (correct as number) > 3)
    errors.push(`${label}: "correct" трябва да е индекс от 0 до 3`);

  if (explanation !== undefined && !isNonEmptyString(explanation))
    errors.push(`${label}: "explanation" трябва да е непразен текст, ако е зададен`);

  if (errors.length > 0) return { value: null, errors };

  const value: Question = {
    id: id as string,
    difficulty: difficulty as Difficulty,
    question: (question as string).trim(),
    answers: (answers as string[]).map((a) => a.trim()) as Question['answers'],
    correct: correct as AnswerIndex,
  };
  if (isNonEmptyString(explanation)) value.explanation = explanation.trim();
  return { value, errors };
}

/**
 * Validates a whole category file. Invalid questions are dropped (and reported),
 * so one typo does not take the whole category down in production.
 */
export function validateQuestionFile(
  raw: unknown,
  fileName: string,
): ValidationResult<QuestionFile> {
  if (!isObject(raw))
    return { value: null, errors: [`${fileName}: файлът трябва да е JSON обект`] };

  const errors: string[] = [];
  if (!isNonEmptyString(raw.category)) errors.push(`${fileName}: липсва "category"`);
  if (!isNonEmptyString(raw.name)) errors.push(`${fileName}: липсва "name"`);
  if (!Array.isArray(raw.questions)) errors.push(`${fileName}: "questions" трябва да е масив`);
  if (errors.length > 0) return { value: null, errors };

  const questions: Question[] = [];
  const seen = new Set<string>();
  (raw.questions as unknown[]).forEach((q, i) => {
    const result = validateQuestion(q, `${fileName} #${i + 1}`);
    errors.push(...result.errors);
    if (!result.value) return;
    if (seen.has(result.value.id)) {
      errors.push(`${fileName}: повторено id "${result.value.id}"`);
      return;
    }
    seen.add(result.value.id);
    questions.push(result.value);
  });

  return {
    value: { category: raw.category as string, name: raw.name as string, questions },
    errors,
  };
}

export function validateManifest(raw: unknown): ValidationResult<Manifest> {
  if (!isObject(raw) || !Array.isArray(raw.categories))
    return { value: null, errors: ['manifest.json: липсва масив "categories"'] };

  const errors: string[] = [];
  const categories: CategoryMeta[] = [];
  raw.categories.forEach((c: unknown, i: number) => {
    if (
      isObject(c) &&
      isNonEmptyString(c.id) &&
      isNonEmptyString(c.name) &&
      isNonEmptyString(c.icon) &&
      isNonEmptyString(c.file)
    ) {
      categories.push({ id: c.id, name: c.name, icon: c.icon, file: c.file });
    } else {
      errors.push(`manifest.json #${i + 1}: нужни са "id", "name", "icon" и "file"`);
    }
  });
  return { value: { categories }, errors };
}

// ─── Loading ─────────────────────────────────────────────────────────────────

export interface QuestionBank {
  categories: CategoryMeta[];
  questions: CategorizedQuestion[];
}

type FetchJson = (url: string) => Promise<unknown>;

const defaultFetchJson: FetchJson = async (url) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Неуспешно зареждане на ${url} (${res.status})`);
  return res.json();
};

/** Loads `manifest.json` and every category file it lists from `baseUrl`. */
export async function loadQuestionBank(
  baseUrl: string,
  fetchJson: FetchJson = defaultFetchJson,
): Promise<QuestionBank> {
  const root = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  const manifest = validateManifest(await fetchJson(`${root}manifest.json`));
  manifest.errors.forEach((e) => console.warn(e));
  if (!manifest.value) throw new Error('Невалиден manifest.json');

  const files = await Promise.all(
    manifest.value.categories.map(async (meta) => {
      const result = validateQuestionFile(await fetchJson(`${root}${meta.file}`), meta.file);
      result.errors.forEach((e) => console.warn(e));
      return { meta, file: result.value };
    }),
  );

  const categories: CategoryMeta[] = [];
  const questions: CategorizedQuestion[] = [];
  for (const { meta, file } of files) {
    if (!file || file.questions.length === 0) continue;
    categories.push(meta);
    for (const q of file.questions) questions.push({ ...q, category: meta.id });
  }
  if (questions.length === 0) throw new Error('Няма нито един валиден въпрос');
  return { categories, questions };
}

// ─── Selection ───────────────────────────────────────────────────────────────

export interface PickOptions {
  difficulty: Difficulty;
  /** Allowed category ids; empty or `null` means "all". */
  categories: ReadonlySet<string> | null;
  /** Ids that must not be picked (already used in this game). */
  exclude: ReadonlySet<string>;
  /** Ids seen in recent games – avoided when there is any alternative. */
  recent?: ReadonlySet<string>;
}

/**
 * Picks the best available question, relaxing the constraints step by step:
 * exact difficulty in the chosen categories → ±1 difficulty → any category → anything left.
 * Within each step, questions not seen recently are preferred.
 */
export function pickQuestion(
  pool: readonly CategorizedQuestion[],
  { difficulty, categories, exclude, recent }: PickOptions,
  rng: Rng,
): CategorizedQuestion | null {
  const hasFilter = categories !== null && categories.size > 0;
  const inSelected = (q: CategorizedQuestion) => !hasFilter || categories.has(q.category);
  const anyCategory = () => true;

  const steps: Array<[(q: CategorizedQuestion) => boolean, number]> = [
    [inSelected, 0],
    [inSelected, 1],
    [anyCategory, 0],
    [anyCategory, 1],
    [inSelected, 4],
    [anyCategory, 4],
  ];

  for (const [scope, distance] of steps) {
    const candidates = pool.filter(
      (q) => !exclude.has(q.id) && scope(q) && Math.abs(q.difficulty - difficulty) <= distance,
    );
    if (candidates.length === 0) continue;
    const fresh = recent ? candidates.filter((q) => !recent.has(q.id)) : candidates;
    return pick(rng, fresh.length > 0 ? fresh : candidates);
  }
  return null;
}

const NUMBER_PREFIX = /^[-−]?\d[\d\s]*(?:[.,]\d+)?/;

const numericValue = (answer: string): number | null => {
  const match = NUMBER_PREFIX.exec(answer.trim());
  return match ? Number(match[0].replace(/\s/g, '').replace(',', '.').replace('−', '-')) : null;
};

/**
 * True when all answers are numbers with the same unit ("6", "8"… or "343 m/s", "150 m/s"…).
 * Such answers are shown in ascending order, like on TV, instead of being shuffled.
 */
export function isNumericSet(answers: readonly string[]): boolean {
  const units = new Set<string>();
  for (const answer of answers) {
    const match = NUMBER_PREFIX.exec(answer.trim());
    if (!match || Number.isNaN(numericValue(answer))) return false;
    units.add(answer.trim().slice(match[0].length).trim());
  }
  return units.size === 1;
}

/**
 * Returns a copy of the question with its answers shuffled and `correct` remapped.
 * Numeric answers are sorted ascending instead.
 */
export function shuffleAnswers<T extends Question>(question: T, rng: Rng): T {
  const indices = [0, 1, 2, 3] as AnswerIndex[];
  const order = isNumericSet(question.answers)
    ? indices.sort(
        (a, b) => numericValue(question.answers[a])! - numericValue(question.answers[b])!,
      )
    : shuffle(rng, indices);
  return {
    ...question,
    answers: order.map((i) => question.answers[i]) as Question['answers'],
    correct: order.indexOf(question.correct) as AnswerIndex,
  };
}

/** Counts questions per difficulty – used by the validator and the rules screen. */
export function countByDifficulty(questions: readonly Question[]): Record<Difficulty, number> {
  const counts: Record<Difficulty, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const q of questions) counts[q.difficulty]++;
  return counts;
}
