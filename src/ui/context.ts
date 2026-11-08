import type { ShowAudio } from '../audio/engine.ts';
import type { Voice } from '../audio/voice.ts';
import type { Game } from '../game/engine.ts';
import type { QuestionBank } from '../game/questions.ts';
import type { ModeId } from '../game/types.ts';
import type { Confetti } from './components/confetti.ts';

/** A mounted screen. `destroy` must remove timers and global listeners. */
export interface Screen {
  el: HTMLElement;
  /** Element to focus after the screen is shown. */
  focus?: HTMLElement | null;
  destroy?: () => void;
}

/**
 * Studio lighting state, mirrored on `<body data-stage>`:
 * the CSS turns it into spotlights, dimming and colour washes.
 */
export type StageState =
  'idle' | 'intro' | 'question' | 'lock' | 'correct' | 'wrong' | 'win' | 'walk';

/** Everything a screen needs from the app, passed in explicitly instead of via globals. */
export interface AppContext {
  bank: QuestionBank;
  audio: ShowAudio;
  voice: Voice;
  confetti: Confetti;
  /** Reads a message out loud to screen-reader users. */
  announce(message: string): void;
  /** Sets the studio lights. `tier` (1–3) controls how intense they are. */
  stage(state: StageState, tier?: number): void;
  go: {
    menu(): void;
    play(mode: ModeId, categories: string[]): void;
    result(game: Game): void;
    rules(): void;
    hallOfFame(): void;
  };
}
