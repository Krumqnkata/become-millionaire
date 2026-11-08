import { isModeId } from '../game/modes.ts';
import type { ModeId } from '../game/types.ts';

/**
 * Everything persistent lives in localStorage under the `ptm:` prefix.
 * Every access is wrapped in try/catch: private windows and blocked storage
 * must never break the game – they just mean nothing is remembered.
 */

const PREFIX = 'ptm:v1:';

function read<T>(key: string, fallback: T, isValid: (v: unknown) => v is T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (raw === null) return fallback;
    const parsed: unknown = JSON.parse(raw);
    return isValid(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* storage unavailable or full – ignore */
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

// ─── Settings ────────────────────────────────────────────────────────────────

export interface Settings {
  /** All sound off. */
  muted: boolean;
  /** Background music. */
  music: boolean;
  /** The host speaks aloud (when the browser has a Bulgarian voice). */
  voice: boolean;
  /** The host also reads every question and its answers. */
  readQuestions: boolean;
  /** Name of the speech synthesis voice chosen for the host; empty = automatic. */
  voiceName: string;
  volume: number;
  confirmFinalAnswer: boolean;
  lastMode: ModeId;
  lastCategories: string[];
  playerName: string;
}

const DEFAULT_SETTINGS: Settings = {
  muted: false,
  music: true,
  voice: true,
  readQuestions: true,
  voiceName: '',
  volume: 0.8,
  confirmFinalAnswer: true,
  lastMode: 'normal',
  lastCategories: [],
  playerName: '',
};

const bool = (value: unknown, fallback: boolean) => (typeof value === 'boolean' ? value : fallback);

export function loadSettings(): Settings {
  const stored = read('settings', {}, isRecord);
  return {
    muted: bool(stored.muted, DEFAULT_SETTINGS.muted),
    music: bool(stored.music, DEFAULT_SETTINGS.music),
    voice: bool(stored.voice, DEFAULT_SETTINGS.voice),
    readQuestions: bool(stored.readQuestions, DEFAULT_SETTINGS.readQuestions),
    voiceName: typeof stored.voiceName === 'string' ? stored.voiceName : '',
    volume:
      typeof stored.volume === 'number' && stored.volume >= 0 && stored.volume <= 1
        ? stored.volume
        : DEFAULT_SETTINGS.volume,
    confirmFinalAnswer: bool(stored.confirmFinalAnswer, DEFAULT_SETTINGS.confirmFinalAnswer),
    lastMode: isModeId(stored.lastMode) ? stored.lastMode : DEFAULT_SETTINGS.lastMode,
    lastCategories: Array.isArray(stored.lastCategories)
      ? stored.lastCategories.filter((c): c is string => typeof c === 'string')
      : [],
    playerName: typeof stored.playerName === 'string' ? stored.playerName.slice(0, 24) : '',
  };
}

export function saveSettings(patch: Partial<Settings>): Settings {
  const next = { ...loadSettings(), ...patch };
  write('settings', next);
  return next;
}

// ─── Stats ───────────────────────────────────────────────────────────────────

export interface Stats {
  gamesPlayed: number;
  correctAnswers: number;
  totalWinnings: number;
  bestPrize: number;
  millions: number;
  bestByMode: Partial<Record<ModeId, number>>;
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);

export function loadStats(): Stats {
  const s = read('stats', {}, isRecord);
  const bestByMode: Stats['bestByMode'] = {};
  if (isRecord(s.bestByMode)) {
    for (const [mode, value] of Object.entries(s.bestByMode))
      if (isModeId(mode)) bestByMode[mode] = num(value);
  }
  return {
    gamesPlayed: num(s.gamesPlayed),
    correctAnswers: num(s.correctAnswers),
    totalWinnings: num(s.totalWinnings),
    bestPrize: num(s.bestPrize),
    millions: num(s.millions),
    bestByMode,
  };
}

export interface GameSummary {
  mode: ModeId;
  winnings: number;
  correctAnswers: number;
  won: boolean;
}

export function recordGame({ mode, winnings, correctAnswers, won }: GameSummary): Stats {
  const stats = loadStats();
  const next: Stats = {
    gamesPlayed: stats.gamesPlayed + 1,
    correctAnswers: stats.correctAnswers + correctAnswers,
    totalWinnings: stats.totalWinnings + winnings,
    bestPrize: Math.max(stats.bestPrize, winnings),
    millions: stats.millions + (won ? 1 : 0),
    bestByMode: { ...stats.bestByMode, [mode]: Math.max(stats.bestByMode[mode] ?? 0, winnings) },
  };
  write('stats', next);
  return next;
}

// ─── Hall of fame ────────────────────────────────────────────────────────────

export interface HallOfFameEntry {
  name: string;
  prize: number;
  mode: ModeId;
  level: number;
  date: string;
}

export const HALL_OF_FAME_SIZE = 10;

const isEntry = (v: unknown): v is HallOfFameEntry =>
  isRecord(v) &&
  typeof v.name === 'string' &&
  typeof v.prize === 'number' &&
  isModeId(v.mode) &&
  typeof v.level === 'number' &&
  typeof v.date === 'string';

export function loadHallOfFame(): HallOfFameEntry[] {
  const list = read('hall-of-fame', [], Array.isArray);
  return (list as unknown[]).filter(isEntry).slice(0, HALL_OF_FAME_SIZE);
}

/** Sort by prize, then by date (earlier wins ties – they got there first). */
const byRank = (a: HallOfFameEntry, b: HallOfFameEntry) =>
  b.prize - a.prize || a.date.localeCompare(b.date);

export function qualifiesForHallOfFame(prize: number): boolean {
  if (prize <= 0) return false;
  const list = loadHallOfFame();
  return list.length < HALL_OF_FAME_SIZE || prize > (list.at(-1)?.prize ?? 0);
}

/** Adds an entry and returns its 0-based rank, or -1 if it did not make the list. */
export function addToHallOfFame(entry: HallOfFameEntry): number {
  const list = [...loadHallOfFame(), entry].sort(byRank).slice(0, HALL_OF_FAME_SIZE);
  write('hall-of-fame', list);
  return list.indexOf(entry);
}

// ─── Recently seen questions ─────────────────────────────────────────────────

const RECENT_LIMIT = 150;

export function loadRecentQuestionIds(): Set<string> {
  const list = read('recent', [], Array.isArray);
  return new Set((list as unknown[]).filter((id): id is string => typeof id === 'string'));
}

export function rememberQuestionIds(ids: Iterable<string>): void {
  const merged = [...loadRecentQuestionIds(), ...ids];
  write('recent', [...new Set(merged.reverse())].reverse().slice(-RECENT_LIMIT));
}

// ─── Reset ───────────────────────────────────────────────────────────────────

export function resetProgress(): void {
  try {
    for (const key of ['stats', 'hall-of-fame', 'recent']) localStorage.removeItem(PREFIX + key);
  } catch {
    /* ignore */
  }
}
