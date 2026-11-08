import { pick, shuffle } from './random.ts';
import type { AnswerIndex, Difficulty, LifelineId, Rng } from './types.ts';

export const LIFELINES: Record<LifelineId, { name: string; icon: string; description: string }> = {
  fifty: {
    name: '50:50',
    icon: '½',
    description: 'Премахва два грешни отговора.',
  },
  audience: {
    name: 'Питай публиката',
    icon: '👥',
    description: 'Публиката гласува. Колкото по-труден е въпросът, толкова по-често греши.',
  },
  phone: {
    name: 'Обади се на приятел',
    icon: '📞',
    description: 'Приятел ти казва какво мисли. Всеки има любима тема.',
  },
  switch: {
    name: 'Смени въпроса',
    icon: '🔄',
    description: 'Получаваш нов въпрос със същата трудност.',
  },
};

export const ANSWER_LETTERS = ['А', 'Б', 'В', 'Г'] as const;

const ALL: AnswerIndex[] = [0, 1, 2, 3];

/** Picks two wrong answers to hide. */
export function fiftyFifty(correct: AnswerIndex, rng: Rng): AnswerIndex[] {
  const wrong = ALL.filter((i) => i !== correct);
  return shuffle(rng, wrong).slice(0, 2).sort();
}

// ─── Ask the audience ────────────────────────────────────────────────────────

/** Range of votes for the right answer, per difficulty. */
const AUDIENCE_CORRECT_SHARE: Record<Difficulty, [number, number]> = {
  1: [62, 88],
  2: [50, 74],
  3: [38, 60],
  4: [30, 50],
  5: [24, 42],
};

/** Chance that the crowd is confidently wrong. */
const AUDIENCE_MISLED: Record<Difficulty, number> = { 1: 0.02, 2: 0.06, 3: 0.12, 4: 0.2, 5: 0.3 };

/** Rounds shares to integers that still add up to exactly 100 (largest-remainder method). */
function toPercentages(shares: number[]): number[] {
  const total = shares.reduce((a, b) => a + b, 0);
  const exact = shares.map((s) => (s / total) * 100);
  const floored = exact.map(Math.floor);
  let missing = 100 - floored.reduce((a, b) => a + b, 0);
  const byRemainder = exact.map((v, i) => ({ i, r: v - Math.floor(v) })).sort((a, b) => b.r - a.r);
  for (const { i } of byRemainder) {
    if (missing <= 0) break;
    floored[i] = (floored[i] ?? 0) + 1;
    missing--;
  }
  return floored;
}

/**
 * Simulates an audience vote. Hidden answers (after 50:50) get 0 %.
 * @returns percentages indexed by answer slot, summing to 100
 */
export function askAudience(
  correct: AnswerIndex,
  difficulty: Difficulty,
  available: readonly AnswerIndex[],
  rng: Rng,
): number[] {
  const result = [0, 0, 0, 0];
  if (available.length <= 1) {
    result[available[0] ?? correct] = 100;
    return result;
  }

  const [min, max] = AUDIENCE_CORRECT_SHARE[difficulty];
  let correctShare = min + rng() * (max - min);
  if (available.length === 2) correctShare = Math.min(92, correctShare + 18);

  const others = available.filter((i) => i !== correct);
  const weights = others.map(() => 0.25 + rng());
  const weightSum = weights.reduce((a, b) => a + b, 0);
  const shares = new Map<AnswerIndex, number>([[correct, correctShare]]);
  others.forEach((i, k) => shares.set(i, ((100 - correctShare) * (weights[k] ?? 0)) / weightSum));

  // Sometimes the crowd falls for a trap: a wrong answer takes the lead.
  if (others.length > 0 && rng() < AUDIENCE_MISLED[difficulty]) {
    const trap = pick(rng, others);
    const trapShare = shares.get(trap) ?? 0;
    shares.set(trap, correctShare);
    shares.set(correct, trapShare);
  }

  const percentages = toPercentages(available.map((i) => shares.get(i) ?? 0));
  available.forEach((slot, k) => (result[slot] = percentages[k] ?? 0));
  return result;
}

// ─── Phone a friend ──────────────────────────────────────────────────────────

export interface Friend {
  name: string;
  role: string;
  avatar: string;
  /** Used to pick a matching voice for the phone call. */
  gender: 'male' | 'female';
  /** Category ids the friend is great at. */
  expertise: string[];
}

export const FRIENDS: Friend[] = [
  {
    name: 'Баба Мария',
    gender: 'female',
    role: 'пенсионирана учителка по история',
    avatar: '👵',
    expertise: ['history', 'bulgaria', 'food'],
  },
  {
    name: 'Деси',
    gender: 'female',
    role: 'студентка по медицина',
    avatar: '👩‍⚕️',
    expertise: ['science', 'animals'],
  },
  {
    name: 'Чичо Петър',
    gender: 'male',
    role: 'таксиметров шофьор, обиколил света',
    avatar: '🚕',
    expertise: ['geography', 'general'],
  },
  { name: 'Мартин', gender: 'male', role: 'треньор по футбол', avatar: '⚽', expertise: ['sport'] },
  {
    name: 'Кали',
    gender: 'female',
    role: 'библиотекарка',
    avatar: '📚',
    expertise: ['art', 'language', 'myth'],
  },
  {
    name: 'Иво',
    gender: 'male',
    role: 'програмист и киноман',
    avatar: '🎬',
    expertise: ['entertainment', 'tech'],
  },
];

const FRIEND_ACCURACY: Record<Difficulty, number> = { 1: 0.95, 2: 0.86, 3: 0.72, 4: 0.58, 5: 0.45 };
const EXPERTISE_BONUS = 0.15;

export interface PhoneResult {
  friend: Friend;
  answer: AnswerIndex;
  /** How sure the friend sounds, 0–100. */
  confidence: number;
  isExpert: boolean;
  message: string;
}

function friendMessage(
  letter: string,
  confidence: number,
  isExpert: boolean,
  gender: Friend['gender'],
): string {
  const intro = isExpert ? 'О, това ми е любимата тема! ' : '';
  const sure = gender === 'female' ? 'сигурна' : 'сигурен';
  if (confidence >= 85)
    return `${intro}${sure[0]!.toUpperCase()}${sure.slice(1)} съм на 100% – отговорът е ${letter}.`;
  if (confidence >= 65) return `${intro}Почти съм ${sure}, че е ${letter}.`;
  if (confidence >= 45) return `${intro}Мисля, че е ${letter}, но не залагай къщата.`;
  return `Ох, тук нямам идея… Ако трябва да избирам – ${letter}. Но наистина гадая.`;
}

export function phoneFriend(
  correct: AnswerIndex,
  difficulty: Difficulty,
  category: string,
  available: readonly AnswerIndex[],
  rng: Rng,
  friend: Friend = pick(rng, FRIENDS),
): PhoneResult {
  const isExpert = friend.expertise.includes(category);
  let accuracy = FRIEND_ACCURACY[difficulty] + (isExpert ? EXPERTISE_BONUS : 0);
  if (available.length === 2) accuracy += 0.1;
  accuracy = Math.min(0.98, accuracy);

  const knows = rng() < accuracy;
  const wrong = available.filter((i) => i !== correct);
  const answer = knows || wrong.length === 0 ? correct : pick(rng, wrong);

  // A friend who is right usually sounds confident; a wrong one usually hesitates.
  const base = knows ? 55 + accuracy * 40 : 25 + accuracy * 30;
  const confidence = Math.round(Math.max(10, Math.min(99, base + (rng() - 0.5) * 30)));

  return {
    friend,
    answer,
    confidence,
    isExpert,
    message: friendMessage(ANSWER_LETTERS[answer], confidence, isExpert, friend.gender),
  };
}
