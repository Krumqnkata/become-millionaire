import { formatPrize } from '../../game/ladder.ts';
import { LIFELINES } from '../../game/lifelines.ts';
import { MODE_ORDER, MODES } from '../../game/modes.ts';
import type { GameMode, ModeId } from '../../game/types.ts';
import { loadSettings, loadStats, saveSettings } from '../../storage/stats.ts';
import { logoMark } from '../components/logo.ts';
import type { AppContext, Screen } from '../context.ts';
import { h } from '../dom.ts';

function modeDetails(mode: GameMode): HTMLElement {
  return h(
    'ul',
    { class: 'mode__meta' },
    h('li', { title: 'Време за въпрос' }, '⏱ ', mode.timer ? `${mode.timer} s` : 'без таймер'),
    h(
      'li',
      { title: 'Жокери' },
      mode.lifelines.map((id) =>
        h('span', { class: 'mode__lifeline', title: LIFELINES[id].name }, LIFELINES[id].icon),
      ),
    ),
    h(
      'li',
      { title: 'Сигурни суми' },
      '🔒 ',
      mode.safeHavens.length > 0 ? mode.safeHavens.map((l) => `${l}`).join(' и ') : 'няма',
    ),
  );
}

export function menuScreen(ctx: AppContext): Screen {
  const settings = loadSettings();
  const stats = loadStats();
  const known = new Set(ctx.bank.categories.map((c) => c.id));
  let mode: ModeId = settings.lastMode;
  let selected = new Set(settings.lastCategories.filter((c) => known.has(c)));

  // ── Mode picker ──
  const modeButtons = MODE_ORDER.map((id, index) => {
    const m = MODES[id];
    return h(
      'button',
      {
        type: 'button',
        class: `mode mode--${id}`,
        role: 'radio',
        dataset: { mode: id },
        onClick: () => setMode(id),
      },
      h(
        'span',
        { class: 'mode__head' },
        h('span', { class: 'mode__name' }, m.name),
        h(
          'span',
          { class: 'mode__dots', 'aria-hidden': 'true' },
          MODE_ORDER.map((_, i) => h('i', { class: i <= index ? 'is-on' : '' })),
        ),
      ),
      h('span', { class: 'mode__tagline' }, m.tagline),
      modeDetails(m),
      stats.bestByMode[id]
        ? h('span', { class: 'mode__best' }, `Рекорд: ${formatPrize(stats.bestByMode[id])}`)
        : null,
    );
  });

  function setMode(id: ModeId) {
    mode = id;
    modeButtons.forEach((btn) => btn.setAttribute('aria-checked', String(btn.dataset.mode === id)));
    ctx.audio.play('select');
  }
  modeButtons.forEach((btn) => btn.setAttribute('aria-checked', String(btn.dataset.mode === mode)));

  // ── Category chips ──
  const counts = new Map<string, number>();
  ctx.bank.questions.forEach((q) => counts.set(q.category, (counts.get(q.category) ?? 0) + 1));

  const allChip = h(
    'button',
    { type: 'button', class: 'chip chip--all', onClick: () => setCategories(new Set()) },
    '✨ Всички',
  );
  const chips = ctx.bank.categories.map((c) =>
    h(
      'button',
      {
        type: 'button',
        class: 'chip',
        dataset: { category: c.id },
        onClick: () => {
          const next = new Set(selected);
          if (next.has(c.id)) next.delete(c.id);
          else next.add(c.id);
          setCategories(next.size === known.size ? new Set() : next);
        },
      },
      h('span', { 'aria-hidden': 'true' }, c.icon),
      ` ${c.name} `,
      h('small', null, counts.get(c.id) ?? 0),
    ),
  );

  function setCategories(next: Set<string>) {
    selected = next;
    allChip.setAttribute('aria-pressed', String(selected.size === 0));
    chips.forEach((chip) =>
      chip.setAttribute('aria-pressed', String(selected.has(chip.dataset.category ?? ''))),
    );
  }
  setCategories(selected);

  // ── Options & start ──
  const nameInput = h('input', {
    type: 'text',
    class: 'input input--name',
    maxLength: 24,
    placeholder: 'Твоето име',
    value: settings.playerName,
    'aria-label': 'Име на участника',
    autocomplete: 'nickname',
    onKeydown: (e: KeyboardEvent) => {
      if (e.key === 'Enter') start.click();
    },
  });

  const start = h(
    'button',
    {
      type: 'button',
      class: 'btn btn--primary btn--xl',
      onClick: () => {
        saveSettings({
          lastMode: mode,
          lastCategories: [...selected],
          playerName: nameInput.value.trim().slice(0, 24),
        });
        ctx.go.play(mode, [...selected]);
      },
    },
    'Към студиото',
    h('span', { class: 'btn__arrow', 'aria-hidden': 'true' }, '→'),
  );

  const el = h(
    'section',
    { class: 'screen menu' },
    h(
      'header',
      { class: 'hero' },
      h('div', { class: 'hero__mark' }, logoMark(104)),
      h('h1', { class: 'hero__title' }, 'Пътят към ', h('span', { class: 'gold' }, 'милиона')),
      h('p', { class: 'hero__subtitle' }, '15 въпроса · 4 жокера · 1 000 000 €'),
      h(
        'p',
        { class: 'hero__tagline' },
        'Седни на горещия стол. Водещият те чака, светлините са запалени.',
      ),
    ),
    h(
      'div',
      { class: 'card menu__panel' },
      h('h2', { class: 'section-title' }, h('span', { class: 'step' }, '1'), 'Избери трудност'),
      h('div', { class: 'modes', role: 'radiogroup', 'aria-label': 'Трудност' }, modeButtons),
      h(
        'h2',
        { class: 'section-title' },
        h('span', { class: 'step' }, '2'),
        'Категории ',
        h('small', null, 'по желание'),
      ),
      h('div', { class: 'chips', role: 'group', 'aria-label': 'Категории' }, allChip, chips),
      h(
        'h2',
        { class: 'section-title' },
        h('span', { class: 'step' }, '3'),
        'Как се казва участникът?',
      ),
      nameInput,
      start,
    ),
    h(
      'nav',
      { class: 'menu__links', 'aria-label': 'Още' },
      h(
        'button',
        { type: 'button', class: 'btn btn--ghost', onClick: () => ctx.go.rules() },
        '📖 Правила',
      ),
      h(
        'button',
        { type: 'button', class: 'btn btn--ghost', onClick: () => ctx.go.hallOfFame() },
        '🏆 Зала на славата',
      ),
    ),
    stats.gamesPlayed > 0
      ? h(
          'p',
          { class: 'menu__stats' },
          `Изиграни игри: ${stats.gamesPlayed} · Най-голяма печалба: ${formatPrize(stats.bestPrize)}`,
          stats.millions > 0 ? ` · Милиони: ${stats.millions} 💰` : '',
        )
      : null,
  );

  return { el, focus: start };
}
