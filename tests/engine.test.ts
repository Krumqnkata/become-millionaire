import { describe, expect, it } from 'vitest';
import { Game, GameError } from '../src/game/engine.ts';
import { MODES } from '../src/game/modes.ts';
import { createRng } from '../src/game/random.ts';
import type { AnswerIndex, GameMode } from '../src/game/types.ts';
import { makePool } from './helpers.ts';

const newGame = (mode: GameMode = MODES.normal, seed = 1) =>
  new Game({ mode, pool: makePool(), rng: createRng(seed) });

const wrongAnswer = (game: Game) => ((game.question.correct + 1) % 4) as AnswerIndex;

function answerCorrectly(game: Game, times: number) {
  for (let i = 0; i < times; i++) {
    game.lockIn(game.question.correct);
    expect(game.reveal()).toBe(true);
    if (game.phase === 'correct') game.next();
  }
}

describe('Game', () => {
  it('starts at level 1 with a question of the right difficulty', () => {
    const game = newGame();
    expect(game.level).toBe(1);
    expect(game.phase).toBe('question');
    expect(game.question.difficulty).toBe(MODES.normal.difficultyCurve[0]);
  });

  it('follows the difficulty curve of the mode', () => {
    const game = newGame(MODES.hard);
    for (let level = 1; level <= 15; level++) {
      expect(game.question.difficulty).toBe(MODES.hard.difficultyCurve[level - 1]);
      answerCorrectly(game, 1);
    }
  });

  it('wins the million after 15 correct answers without repeating questions', () => {
    const game = newGame();
    const ids = new Set<string>();
    for (let i = 0; i < 15; i++) {
      ids.add(game.question.id);
      answerCorrectly(game, 1);
    }
    expect(ids.size).toBe(15);
    expect(game.phase).toBe('finished');
    expect(game.outcome).toBe('won');
    expect(game.winnings).toBe(1_000_000);
  });

  it('drops to the safe haven on a wrong answer', () => {
    const game = newGame();
    answerCorrectly(game, 7);
    game.lockIn(wrongAnswer(game));
    expect(game.reveal()).toBe(false);
    expect(game.outcome).toBe('wrong');
    expect(game.winnings).toBe(1_000);
  });

  it('loses everything in expert mode', () => {
    const game = newGame(MODES.expert);
    answerCorrectly(game, 12);
    game.lockIn(wrongAnswer(game));
    game.reveal();
    expect(game.winnings).toBe(0);
  });

  it('keeps the current prize when walking away', () => {
    const game = newGame();
    answerCorrectly(game, 8);
    game.walkAway();
    expect(game.outcome).toBe('walked');
    expect(game.winnings).toBe(10_000);
  });

  it('treats a timeout like a wrong answer', () => {
    const game = newGame();
    answerCorrectly(game, 11);
    game.timeout();
    expect(game.outcome).toBe('timeout');
    expect(game.winnings).toBe(40_000);
  });

  it('rejects actions in the wrong phase', () => {
    const game = newGame();
    expect(() => game.reveal()).toThrow(GameError);
    expect(() => game.next()).toThrow(GameError);
    expect(() => game.lockIn(null)).toThrow(GameError);
    game.lockIn(0);
    expect(() => game.walkAway()).toThrow(GameError);
    expect(() => game.useLifeline('fifty')).toThrow(GameError);
  });

  describe('lifelines', () => {
    it('can use each lifeline only once', () => {
      const game = newGame();
      game.useLifeline('audience');
      expect(game.canUseLifeline('audience')).toBe(false);
      expect(() => game.useLifeline('audience')).toThrow(GameError);
    });

    it('only offers the lifelines of the mode', () => {
      expect(newGame(MODES.normal).canUseLifeline('switch')).toBe(false);
      expect(newGame(MODES.easy).canUseLifeline('switch')).toBe(true);
      expect(newGame(MODES.expert).canUseLifeline('phone')).toBe(false);
    });

    it('50:50 hides two wrong answers and clears a hidden selection', () => {
      const game = newGame();
      const result = game.useLifeline('fifty');
      expect(result.id).toBe('fifty');
      expect(game.hidden.size).toBe(2);
      expect(game.hidden.has(game.question.correct)).toBe(false);
      const hiddenAnswer = [...game.hidden][0]!;
      game.select(hiddenAnswer);
      expect(game.selected).toBeNull();
    });

    it('the audience respects 50:50', () => {
      const game = newGame();
      game.useLifeline('fifty');
      const result = game.useLifeline('audience');
      if (result.id !== 'audience') throw new Error('unexpected result');
      game.hidden.forEach((i) => expect(result.votes[i]).toBe(0));
    });

    it('switch replaces the question at the same level and difficulty', () => {
      const game = newGame(MODES.easy);
      answerCorrectly(game, 3);
      const before = game.question;
      game.useLifeline('switch');
      expect(game.question.id).not.toBe(before.id);
      expect(game.question.difficulty).toBe(before.difficulty);
      expect(game.level).toBe(4);
      expect(game.seenIds.has(before.id)).toBe(true);
    });

    it('resets 50:50 and lifeline results on the next question', () => {
      const game = newGame();
      game.useLifeline('fifty');
      game.useLifeline('phone');
      answerCorrectly(game, 1);
      expect(game.hidden.size).toBe(0);
      expect(game.lifelineResults).toHaveLength(0);
      expect(game.usedLifelines.size).toBe(2);
    });
  });
});
