import type { GameMode, LifelineId, ModeId } from './types.ts';

const CLASSIC_LIFELINES: LifelineId[] = ['fifty', 'audience', 'phone'];

export const MODES: Record<ModeId, GameMode> = {
  easy: {
    id: 'easy',
    name: 'Лесно',
    tagline: 'Без таймер, 4 жокера и по-леки въпроси',
    timer: null,
    lifelines: [...CLASSIC_LIFELINES, 'switch'],
    safeHavens: [5, 10],
    difficultyCurve: [1, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 4, 4, 4],
  },
  normal: {
    id: 'normal',
    name: 'Нормално',
    tagline: '45 секунди за въпрос и 3 жокера',
    timer: 45,
    lifelines: CLASSIC_LIFELINES,
    safeHavens: [5, 10],
    difficultyCurve: [1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 4, 5, 5, 5],
  },
  hard: {
    id: 'hard',
    name: 'Трудно',
    tagline: '30 секунди и само една сигурна сума',
    timer: 30,
    lifelines: CLASSIC_LIFELINES,
    safeHavens: [10],
    difficultyCurve: [2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5],
  },
  expert: {
    id: 'expert',
    name: 'Експерт',
    tagline: '20 секунди, само 50:50, без сигурни суми',
    timer: 20,
    lifelines: ['fifty'],
    safeHavens: [],
    difficultyCurve: [3, 3, 3, 3, 4, 4, 4, 4, 4, 5, 5, 5, 5, 5, 5],
  },
};

export const MODE_ORDER: ModeId[] = ['easy', 'normal', 'hard', 'expert'];

export function isModeId(value: unknown): value is ModeId {
  return typeof value === 'string' && value in MODES;
}
