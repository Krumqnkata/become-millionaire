import type { Game } from '../../game/engine.ts';
import { formatPrize, LEVEL_COUNT } from '../../game/ladder.ts';
import { LIFELINES } from '../../game/lifelines.ts';
import {
  addToHallOfFame,
  loadSettings,
  qualifiesForHallOfFame,
  recordGame,
  rememberQuestionIds,
  saveSettings,
} from '../../storage/stats.ts';
import { HOST, line } from '../../show/script.ts';
import type { AppContext, Screen } from '../context.ts';
import { h, prefersReducedMotion } from '../dom.ts';

const HEADLINES = {
  won: { icon: '🏆', title: 'Милионер!', text: 'Изкачи цялата стълба. Невероятно!' },
  walked: {
    icon: '💼',
    title: 'Умно решение',
    text: 'Понякога най-добрият ход е да спреш навреме.',
  },
  wrong: {
    icon: '💥',
    title: 'Край на играта',
    text: 'Грешен отговор, но пък беше на крачка напред.',
  },
  timeout: { icon: '⏰', title: 'Времето изтече', text: 'Часовникът беше по-бърз този път.' },
} as const;

/** Animates a number from 0 to `target` with an ease-out curve. */
function countUp(el: HTMLElement, target: number, duration = 1400) {
  if (prefersReducedMotion() || target === 0) {
    el.textContent = formatPrize(target);
    return;
  }
  const start = performance.now();
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = formatPrize(Math.round(target * eased));
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

export function resultScreen(ctx: AppContext, game: Game): Screen {
  const outcome = game.outcome ?? 'wrong';
  const winnings = game.winnings;
  const correctAnswers = outcome === 'won' ? LEVEL_COUNT : game.level - 1;

  recordGame({ mode: game.mode.id, winnings, correctAnswers, won: outcome === 'won' });
  rememberQuestionIds(game.seenIds);

  const copy = HEADLINES[outcome];
  const amount = h('p', { class: 'result__amount' }, formatPrize(0));
  countUp(amount, winnings);
  if (outcome === 'won') setTimeout(() => ctx.confetti.celebrate(), 300);

  const shareText = `Спечелих ${formatPrize(winnings)} в „Пътят към милиона“ (${game.mode.name}, ${correctAnswers}/${LEVEL_COUNT} верни). Можеш ли повече?`;
  const shareButton = h(
    'button',
    { type: 'button', class: 'btn btn--ghost', onClick: () => void share() },
    '📣 Сподели',
  );

  async function share() {
    const url = location.href.split('#')[0] ?? location.href;
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Пътят към милиона', text: shareText, url });
        return;
      }
      await navigator.clipboard.writeText(`${shareText} ${url}`);
      shareButton.textContent = '✔ Копирано!';
    } catch {
      /* the user cancelled or the clipboard is blocked */
    }
  }

  const fame = qualifiesForHallOfFame(winnings) ? hallOfFameForm(ctx, game, winnings) : null;

  const playAgain = h(
    'button',
    {
      type: 'button',
      class: 'btn btn--primary',
      onClick: () => ctx.go.play(game.mode.id, [...game.categories]),
    },
    '🔁 Играй пак',
  );

  const el = h(
    'section',
    { class: `screen result result--${outcome}` },
    h(
      'div',
      { class: 'card result__card' },
      h('div', { class: 'result__icon', 'aria-hidden': 'true' }, copy.icon),
      h('h1', { class: 'result__title' }, copy.title),
      h('p', { class: 'result__text' }, copy.text),
      h('p', { class: 'result__label' }, winnings > 0 ? 'Печелиш' : 'Печалба'),
      amount,
      h(
        'dl',
        { class: 'result__stats' },
        h(
          'div',
          null,
          h('dt', null, 'Верни отговори'),
          h('dd', null, `${correctAnswers} / ${LEVEL_COUNT}`),
        ),
        h('div', null, h('dt', null, 'Трудност'), h('dd', null, game.mode.name)),
        h(
          'div',
          null,
          h('dt', null, 'Жокери'),
          h(
            'dd',
            null,
            game.usedLifelines.size > 0
              ? [...game.usedLifelines].map((id) => LIFELINES[id].icon).join(' ')
              : 'нито един',
          ),
        ),
      ),
      fame,
      h(
        'div',
        { class: 'result__actions' },
        playAgain,
        h(
          'button',
          { type: 'button', class: 'btn btn--ghost', onClick: () => ctx.go.menu() },
          '🏠 Меню',
        ),
        shareButton,
      ),
    ),
  );

  ctx.announce(`${copy.title}. Печелиш ${formatPrize(winnings)}.`);
  const goodbye = line('goodbye', { name: loadSettings().playerName.trim() || 'нашия участник' });
  el.querySelector('.result__card')?.append(
    h('p', { class: 'result__host' }, `🎙️ ${HOST.shortName}: „${goodbye}“`),
  );
  void ctx.voice.speak(goodbye);
  return { el, focus: fame?.querySelector('input') ?? playAgain };
}

function hallOfFameForm(ctx: AppContext, game: Game, prize: number): HTMLElement {
  const input = h('input', {
    type: 'text',
    class: 'input',
    maxLength: 24,
    placeholder: 'Твоето име',
    value: loadSettings().playerName,
    'aria-label': 'Име за Залата на славата',
    required: true,
  });

  const form = h(
    'form',
    {
      class: 'fame-form',
      onSubmit: (event: Event) => {
        event.preventDefault();
        const name = input.value.trim().slice(0, 24);
        if (!name) {
          input.focus();
          return;
        }
        saveSettings({ playerName: name });
        const rank = addToHallOfFame({
          name,
          prize,
          mode: game.mode.id,
          level: game.outcome === 'won' ? LEVEL_COUNT : game.level - 1,
          date: new Date().toISOString(),
        });
        form.replaceChildren(
          h(
            'p',
            { class: 'fame-form__done' },
            `🏆 Записан си на ${rank + 1}-во място в Залата на славата!`,
          ),
          h(
            'button',
            { type: 'button', class: 'btn btn--ghost btn--sm', onClick: () => ctx.go.hallOfFame() },
            'Виж класирането',
          ),
        );
      },
    },
    h('label', { class: 'fame-form__label' }, '🏆 Влизаш в Залата на славата! Запиши името си:'),
    h(
      'div',
      { class: 'fame-form__row' },
      input,
      h('button', { type: 'submit', class: 'btn btn--primary btn--sm' }, 'Запиши'),
    ),
  );
  return form;
}
