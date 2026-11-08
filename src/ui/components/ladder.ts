import { formatPrize, PRIZES } from '../../game/ladder.ts';
import type { GameMode } from '../../game/types.ts';
import { h } from '../dom.ts';

export interface LadderView {
  el: HTMLElement;
  /** @param answered how many questions are behind the player */
  update(level: number, answered: number): void;
}

export function createLadder(mode: GameMode): LadderView {
  const rows = PRIZES.map((prize, i) => {
    const level = i + 1;
    const isSafe = mode.safeHavens.includes(level);
    return h(
      'li',
      {
        class: `ladder__row${isSafe ? ' is-safe' : ''}${level === PRIZES.length ? ' is-top' : ''}`,
        dataset: { level: String(level) },
      },
      h('span', { class: 'ladder__level' }, level),
      h('span', { class: 'ladder__prize' }, formatPrize(prize)),
      isSafe
        ? h(
            'span',
            { class: 'ladder__badge', title: 'Сигурна сума', 'aria-label': 'сигурна сума' },
            '🔒',
          )
        : null,
    );
  });

  const list = h('ol', { class: 'ladder__list', reversed: true }, [...rows].reverse());
  const el = h(
    'aside',
    { class: 'ladder card', 'aria-label': 'Стълба на наградите' },
    h('h2', { class: 'ladder__title' }, 'Стълба'),
    list,
  );

  return {
    el,
    update(level, answered) {
      rows.forEach((row, i) => {
        const rowLevel = i + 1;
        row.classList.toggle('is-current', rowLevel === level && answered < rowLevel);
        row.classList.toggle('is-done', rowLevel <= answered);
        if (rowLevel === level) row.setAttribute('aria-current', 'step');
        else row.removeAttribute('aria-current');
      });
    },
  };
}
