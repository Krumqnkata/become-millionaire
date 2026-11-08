/** Difficulty of a single question: 1 (trivial) … 5 (very hard). */
export type Difficulty = 1 | 2 | 3 | 4 | 5;

/** Index of an answer slot as shown on screen (A = 0 … D = 3). */
export type AnswerIndex = 0 | 1 | 2 | 3;

/** A question exactly as stored in the JSON files. `correct` points into `answers`. */
export interface Question {
  id: string;
  difficulty: Difficulty;
  question: string;
  answers: [string, string, string, string];
  correct: AnswerIndex;
  explanation?: string;
}

/** A question together with the category it came from. */
export interface CategorizedQuestion extends Question {
  category: string;
}

/** One entry of `public/questions/manifest.json`. */
export interface CategoryMeta {
  id: string;
  name: string;
  icon: string;
  file: string;
}

export interface Manifest {
  categories: CategoryMeta[];
}

/** Shape of a `public/questions/<category>.json` file. */
export interface QuestionFile {
  $schema?: string;
  category: string;
  name: string;
  questions: Question[];
}

export type LifelineId = 'fifty' | 'audience' | 'phone' | 'switch';

export type ModeId = 'easy' | 'normal' | 'hard' | 'expert';

export interface GameMode {
  id: ModeId;
  name: string;
  tagline: string;
  /** Seconds per question, or `null` for no timer. */
  timer: number | null;
  lifelines: LifelineId[];
  /** Ladder levels (1-based) that lock in their prize. */
  safeHavens: number[];
  /** Question difficulty for each of the 15 levels. */
  difficultyCurve: Difficulty[];
}

/** A random number source in [0, 1). Injected so the logic is deterministic in tests. */
export type Rng = () => number;
