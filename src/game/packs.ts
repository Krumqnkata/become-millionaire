import { LEVEL_COUNT } from './ladder.ts';
import { validateQuestion, type QuestionBank } from './questions.ts';
import type { AnswerIndex, Difficulty, Question } from './types.ts';

/**
 * Question packs made by players. Pure data and validation, no Firebase:
 * the same rules run in the editor, on load and in the tests.
 */

export type Visibility = 'private' | 'link' | 'public';

export const VISIBILITY: Record<Visibility, { icon: string; name: string; hint: string }> = {
  private: { icon: '🔒', name: 'Личен', hint: 'Виждаш го само ти.' },
  link: { icon: '🔗', name: 'С линк', hint: 'Всеки с линка може да го играе.' },
  public: { icon: '🌍', name: 'Публичен', hint: 'Показва се в „Пакети на играчите“.' },
};

export const PACK_LIMITS = {
  title: 80,
  description: 300,
  ownerName: 40,
  question: 300,
  answer: 120,
  explanation: 400,
  /** A whole game needs one question per level. */
  minToPlay: LEVEL_COUNT,
  maxQuestions: 100,
} as const;

/** A question as the editor and Firestore store it (no id: its position is enough). */
export interface PackQuestion {
  question: string;
  answers: [string, string, string, string];
  correct: AnswerIndex;
  difficulty: Difficulty;
  explanation?: string;
}

/** What the player edits. */
export interface PackDraft {
  title: string;
  description: string;
  visibility: Visibility;
  questions: PackQuestion[];
}

/** A pack as read from the database. */
export interface Pack extends PackDraft {
  id: string;
  ownerId: string;
  ownerName: string;
  questionCount: number;
  updatedAt: Date | null;
}

export const emptyQuestion = (): PackQuestion => ({
  question: '',
  answers: ['', '', '', ''],
  correct: 0,
  difficulty: 3,
});

export const emptyDraft = (): PackDraft => ({
  title: '',
  description: '',
  visibility: 'private',
  questions: [emptyQuestion()],
});

export const isVisibility = (v: unknown): v is Visibility =>
  v === 'private' || v === 'link' || v === 'public';

const tooLong = (text: string, max: number) => text.trim().length > max;

/** An empty explanation box means "no explanation", not an invalid one. */
function forValidation(raw: object, id: string): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...raw, id };
  if (typeof copy.explanation === 'string' && copy.explanation.trim() === '')
    delete copy.explanation;
  return copy;
}

/** Problems with a single question, worded for the editor ("Въпрос 3: …"). */
export function questionProblems(q: PackQuestion, index: number): string[] {
  const where = `Въпрос ${index + 1}`;
  const problems = validateQuestion(forValidation(q, `q-${index + 1}`), where).errors.map((e) =>
    e.replace(/^Въпрос \d+ \[q-\d+\]: /, `${where}: `),
  );
  if (tooLong(q.question, PACK_LIMITS.question))
    problems.push(`${where}: въпросът е по-дълъг от ${PACK_LIMITS.question} знака`);
  if (q.answers.some((a) => tooLong(a, PACK_LIMITS.answer)))
    problems.push(`${where}: отговор е по-дълъг от ${PACK_LIMITS.answer} знака`);
  if (q.explanation && tooLong(q.explanation, PACK_LIMITS.explanation))
    problems.push(`${where}: обяснението е по-дълго от ${PACK_LIMITS.explanation} знака`);
  return problems;
}

/**
 * Everything that stops a draft from being saved. A private draft may be short;
 * a shared one must be playable.
 */
export function draftProblems(draft: PackDraft): string[] {
  const problems: string[] = [];
  if (draft.title.trim() === '') problems.push('Пакетът няма име');
  if (tooLong(draft.title, PACK_LIMITS.title))
    problems.push(`Името е по-дълго от ${PACK_LIMITS.title} знака`);
  if (tooLong(draft.description, PACK_LIMITS.description))
    problems.push(`Описанието е по-дълго от ${PACK_LIMITS.description} знака`);
  if (draft.questions.length === 0) problems.push('Пакетът няма нито един въпрос');
  if (draft.questions.length > PACK_LIMITS.maxQuestions)
    problems.push(`Най-много ${PACK_LIMITS.maxQuestions} въпроса в пакет`);
  if (draft.visibility !== 'private' && draft.questions.length < PACK_LIMITS.minToPlay)
    problems.push(
      `За да споделиш пакета, са нужни поне ${PACK_LIMITS.minToPlay} въпроса (има ${draft.questions.length})`,
    );
  draft.questions.forEach((q, i) => problems.push(...questionProblems(q, i)));
  return problems;
}

/** Trims the text and drops empty optional fields, ready to store. */
export function cleanQuestion(q: PackQuestion): PackQuestion {
  const clean: PackQuestion = {
    question: q.question.trim(),
    answers: q.answers.map((a) => a.trim()) as PackQuestion['answers'],
    correct: q.correct,
    difficulty: q.difficulty,
  };
  const explanation = q.explanation?.trim();
  if (explanation) clean.explanation = explanation;
  return clean;
}

/**
 * Reads questions that came from the database or a pasted file. Anything malformed is
 * skipped, so a broken entry never reaches the game (the database rules can't check
 * every question in a list).
 */
export function parseQuestions(raw: unknown): PackQuestion[] {
  if (!Array.isArray(raw)) return [];
  const out: PackQuestion[] = [];
  raw.slice(0, PACK_LIMITS.maxQuestions).forEach((item: unknown, i) => {
    if (typeof item !== 'object' || item === null) return;
    const { value } = validateQuestion(forValidation(item, `q-${i + 1}`), `#${i + 1}`);
    if (!value) return;
    const q = cleanQuestion(value);
    if (questionProblems(q, i).length === 0) out.push(q);
  });
  return out;
}

/**
 * Turns a pack into a question bank for the regular game engine:
 * one category named after the pack, ids that can't clash with the official questions.
 */
export function packToBank(pack: Pick<Pack, 'id' | 'title' | 'questions'>): QuestionBank {
  const category = `pack-${pack.id}`;
  return {
    categories: [{ id: category, name: pack.title, icon: '📝', file: '' }],
    questions: pack.questions.map((q, i): Question & { category: string } => ({
      ...cleanQuestion(q),
      id: `pack-${pack.id}-${i + 1}`.toLowerCase().replace(/[^a-z0-9-]/g, ''),
      category,
    })),
  };
}

export const isPlayable = (pack: Pick<Pack, 'questions'>) =>
  pack.questions.length >= PACK_LIMITS.minToPlay;
