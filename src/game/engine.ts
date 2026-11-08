import { guaranteedPrize, LEVEL_COUNT, prizeForLevel } from './ladder.ts';
import {
  askAudience,
  fiftyFifty,
  phoneFriend,
  type Friend,
  type PhoneResult,
} from './lifelines.ts';
import { pickQuestion, shuffleAnswers } from './questions.ts';
import { defaultRng } from './random.ts';
import type {
  AnswerIndex,
  CategorizedQuestion,
  Difficulty,
  GameMode,
  LifelineId,
  Rng,
} from './types.ts';

/**
 * - `question` – waiting for the player
 * - `locked`   – final answer given, suspense before the reveal
 * - `correct`  – answer was right, waiting to continue
 * - `finished` – game over (see `outcome`)
 */
export type Phase = 'question' | 'locked' | 'correct' | 'finished';

export type Outcome = 'won' | 'walked' | 'wrong' | 'timeout';

export type LifelineResult =
  | { id: 'fifty'; hidden: AnswerIndex[] }
  | { id: 'audience'; votes: number[] }
  | { id: 'phone'; call: PhoneResult }
  | { id: 'switch'; question: CategorizedQuestion };

export interface GameOptions {
  mode: GameMode;
  pool: readonly CategorizedQuestion[];
  /** Category ids to draw from; empty means all. */
  categories?: ReadonlySet<string>;
  /** Question ids seen in recent games, avoided when possible. */
  recent?: ReadonlySet<string>;
  rng?: Rng;
}

export class GameError extends Error {}

/**
 * The whole game as a small state machine with no DOM or timers,
 * so it can be unit-tested and driven by any UI.
 */
export class Game {
  readonly mode: GameMode;
  private readonly pool: readonly CategorizedQuestion[];
  readonly categories: ReadonlySet<string>;
  private readonly recent: ReadonlySet<string>;
  private readonly rng: Rng;

  /** 1-based level currently being played. */
  level = 1;
  phase: Phase = 'question';
  outcome: Outcome | null = null;
  question: CategorizedQuestion;
  selected: AnswerIndex | null = null;
  /** Answers removed by 50:50 for the current question. */
  hidden = new Set<AnswerIndex>();
  readonly usedLifelines = new Set<LifelineId>();
  /** Every question id shown in this game, including switched-out ones. */
  readonly seenIds = new Set<string>();
  /** Results of lifelines used on the current question (for re-rendering). */
  lifelineResults: LifelineResult[] = [];

  constructor({ mode, pool, categories, recent, rng = defaultRng }: GameOptions) {
    this.mode = mode;
    this.pool = pool;
    this.categories = categories ?? new Set();
    this.recent = recent ?? new Set();
    this.rng = rng;
    this.question = this.drawQuestion();
  }

  /** Number of questions answered correctly. */
  get answered(): number {
    if (this.phase === 'correct') return this.level;
    if (this.phase === 'finished' && this.outcome === 'won') return LEVEL_COUNT;
    return this.level - 1;
  }

  get difficulty(): Difficulty {
    return this.mode.difficultyCurve[this.level - 1] ?? 5;
  }

  get currentPrize(): number {
    return prizeForLevel(this.answered);
  }

  get guaranteed(): number {
    return guaranteedPrize(this.answered, this.mode.safeHavens);
  }

  /** What the player takes home. Only meaningful once the game is finished. */
  get winnings(): number {
    switch (this.outcome) {
      case 'won':
        return prizeForLevel(LEVEL_COUNT);
      case 'walked':
        return prizeForLevel(this.level - 1);
      case 'wrong':
      case 'timeout':
        return guaranteedPrize(this.level - 1, this.mode.safeHavens);
      default:
        return 0;
    }
  }

  get isSafeHaven(): boolean {
    return this.mode.safeHavens.includes(this.level);
  }

  get availableAnswers(): AnswerIndex[] {
    return ([0, 1, 2, 3] as AnswerIndex[]).filter((i) => !this.hidden.has(i));
  }

  canUseLifeline(id: LifelineId): boolean {
    return (
      this.phase === 'question' && this.mode.lifelines.includes(id) && !this.usedLifelines.has(id)
    );
  }

  select(index: AnswerIndex): void {
    this.assertPhase('question');
    if (this.hidden.has(index)) return;
    this.selected = index;
  }

  /** Final answer. Moves to `locked`; call `reveal()` after the suspense pause. */
  lockIn(index: AnswerIndex | null = this.selected): void {
    this.assertPhase('question');
    if (index === null || this.hidden.has(index)) throw new GameError('Няма избран отговор');
    this.selected = index;
    this.phase = 'locked';
  }

  /** Evaluates the locked answer. Returns `true` if it was correct. */
  reveal(): boolean {
    this.assertPhase('locked');
    const isCorrect = this.selected === this.question.correct;
    if (!isCorrect) {
      this.finish('wrong');
    } else if (this.level === LEVEL_COUNT) {
      this.finish('won');
    } else {
      this.phase = 'correct';
    }
    return isCorrect;
  }

  /** Moves on to the next level after a correct answer. */
  next(): void {
    this.assertPhase('correct');
    this.level++;
    this.question = this.drawQuestion();
    this.resetQuestionState();
    this.phase = 'question';
  }

  timeout(): void {
    this.assertPhase('question');
    this.selected = null;
    this.finish('timeout');
  }

  walkAway(): void {
    this.assertPhase('question');
    this.finish('walked');
  }

  /** Uses a lifeline. For `phone`, the player may choose which friend to call. */
  useLifeline(id: LifelineId, { friend }: { friend?: Friend } = {}): LifelineResult {
    if (!this.canUseLifeline(id)) throw new GameError(`Жокерът "${id}" не е наличен`);
    this.usedLifelines.add(id);
    const { correct } = this.question;
    let result: LifelineResult;

    switch (id) {
      case 'fifty': {
        const hidden = fiftyFifty(correct, this.rng);
        hidden.forEach((i) => this.hidden.add(i));
        if (this.selected !== null && this.hidden.has(this.selected)) this.selected = null;
        result = { id, hidden };
        break;
      }
      case 'audience':
        result = {
          id,
          votes: askAudience(correct, this.difficulty, this.availableAnswers, this.rng),
        };
        break;
      case 'phone':
        result = {
          id,
          call: phoneFriend(
            correct,
            this.difficulty,
            this.question.category,
            this.availableAnswers,
            this.rng,
            friend,
          ),
        };
        break;
      case 'switch':
        this.question = this.drawQuestion();
        this.resetQuestionState();
        result = { id, question: this.question };
        break;
    }

    if (id !== 'switch') this.lifelineResults.push(result);
    return result;
  }

  private drawQuestion(): CategorizedQuestion {
    const picked = pickQuestion(
      this.pool,
      {
        difficulty: this.difficulty,
        categories: this.categories,
        exclude: this.seenIds,
        recent: this.recent,
      },
      this.rng,
    );
    if (!picked) throw new GameError('Свършиха въпросите');
    this.seenIds.add(picked.id);
    return shuffleAnswers(picked, this.rng);
  }

  private resetQuestionState(): void {
    this.selected = null;
    this.hidden = new Set();
    this.lifelineResults = [];
  }

  private finish(outcome: Outcome): void {
    this.outcome = outcome;
    this.phase = 'finished';
  }

  private assertPhase(expected: Phase): void {
    if (this.phase !== expected)
      throw new GameError(`Невалидно действие във фаза "${this.phase}" (очаква се "${expected}")`);
  }
}
