import type { ShowAudio } from '../audio/engine.ts';
import type { Narrator } from '../audio/narrator.ts';
import type { Voice } from '../audio/voice.ts';
import type { Game } from '../game/engine.ts';
import type { Pack } from '../game/packs.ts';
import type { QuestionBank } from '../game/questions.ts';
import type { ModeId } from '../game/types.ts';
import type { Confetti } from './components/confetti.ts';

/** A mounted screen. `destroy` must remove timers and global listeners. */
export interface Screen {
  el: HTMLElement;
  /** Element to focus after the screen is shown. */
  focus?: HTMLElement | null;
  destroy?: () => void;
  /** A reason to confirm before leaving (e.g. unsaved changes), or `null`. */
  leaveWarning?: () => string | null;
}

/** A game played with a player-made pack instead of the official questions. */
export interface PlaySource {
  pack: Pack;
  bank: QuestionBank;
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
  /** Speaks for the host: recorded voice pack first, browser voice as fallback. */
  narrator: Narrator;
  confetti: Confetti;
  /** Reads a message out loud to screen-reader users. */
  announce(message: string): void;
  /** Sets the studio lights. `tier` (1–3) controls how intense they are. */
  stage(state: StageState, tier?: number): void;
  go: {
    menu(): void;
    play(mode: ModeId, categories: string[], source?: PlaySource): void;
    result(game: Game, source?: PlaySource): void;
    rules(): void;
    hallOfFame(): void;
    /** The player's own packs (asks to sign in first). */
    myPacks(): void;
    /** The pack editor: an existing pack of the player's, or `null` for a new one. */
    editPack(pack: Pack | null): void;
    /** A pack's page: details, mode and start. `preloaded` skips fetching it again. */
    pack(id: string, preloaded?: Pack): void;
    /** Public packs made by players. */
    browse(): void;
    /** Official questions and moderation (admins only). */
    admin(): void;
  };
}
