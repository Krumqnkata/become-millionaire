import { formatPrize, PRIZES } from '../../game/ladder.ts';
import { LIFELINES } from '../../game/lifelines.ts';
import { MODE_ORDER, MODES } from '../../game/modes.ts';
import { loadHallOfFame, loadStats, resetProgress } from '../../storage/stats.ts';
import { openModal } from '../components/modal.ts';
import type { AppContext, Screen } from '../context.ts';
import { h, replace } from '../dom.ts';

const backButton = (ctx: AppContext) =>
  h(
    'button',
    { type: 'button', class: 'btn btn--ghost btn--sm back', onClick: () => ctx.go.menu() },
    '← Назад',
  );

const kbd = (...keys: string[]) =>
  keys.map((k, i) => [i > 0 ? ' / ' : '', h('kbd', null, k)]).flat();

export function rulesScreen(ctx: AppContext): Screen {
  const back = backButton(ctx);
  const el = h(
    'section',
    { class: 'screen info' },
    back,
    h('h1', { class: 'info__title' }, '📖 Правила'),
    h(
      'div',
      { class: 'card prose' },
      h('h2', null, 'Как се играе'),
      h(
        'p',
        null,
        `Отговаряш на 15 въпроса, всеки по-труден и по-скъп от предишния. Последното стъпало носи ${formatPrize(PRIZES.at(-1) ?? 0)}. `,
        'Всеки въпрос има 4 възможни отговора и само един е верен.',
      ),
      h(
        'ul',
        null,
        h(
          'li',
          null,
          h('strong', null, 'Сигурни суми 🔒'),
          ' – стигнеш ли до тях, остават твои дори да сгрешиш по-нататък.',
        ),
        h(
          'li',
          null,
          h('strong', null, 'Вземи парите 💰'),
          ' – можеш да спреш по всяко време и да запазиш спечеленото до момента.',
        ),
        h(
          'li',
          null,
          h('strong', null, 'Грешка или изтекло време'),
          ' – печелиш последната сигурна сума, която си минал.',
        ),
      ),

      h('h2', null, 'Трудности'),
      h(
        'div',
        { class: 'table-wrap' },
        h(
          'table',
          null,
          h(
            'thead',
            null,
            h(
              'tr',
              null,
              h('th', null, 'Режим'),
              h('th', null, 'Таймер'),
              h('th', null, 'Жокери'),
              h('th', null, 'Сигурни суми'),
            ),
          ),
          h(
            'tbody',
            null,
            MODE_ORDER.map((id) => {
              const m = MODES[id];
              return h(
                'tr',
                null,
                h('td', null, h('strong', null, m.name)),
                h('td', null, m.timer ? `${m.timer} s` : '—'),
                h('td', null, m.lifelines.map((l) => LIFELINES[l].icon).join(' ')),
                h(
                  'td',
                  null,
                  m.safeHavens.length
                    ? m.safeHavens.map((l) => formatPrize(PRIZES[l - 1] ?? 0)).join(', ')
                    : 'няма',
                ),
              );
            }),
          ),
        ),
      ),

      h('h2', null, 'Жокери'),
      h(
        'ul',
        { class: 'lifeline-list' },
        Object.values(LIFELINES).map((l) =>
          h(
            'li',
            null,
            h('span', { class: 'lifeline-list__icon' }, l.icon),
            h('strong', null, l.name),
            ` – ${l.description}`,
          ),
        ),
      ),

      h('h2', null, 'Клавиши'),
      h(
        'ul',
        { class: 'keys' },
        h(
          'li',
          null,
          ...kbd('1', '2', '3', '4'),
          ' или ',
          ...kbd('A', 'B', 'C', 'D'),
          ' – избор на отговор (повторно натискане го заключва)',
        ),
        h('li', null, ...kbd('Enter'), ' – потвърди / следващ въпрос'),
        h('li', null, ...kbd('Esc'), ' – откажи избора'),
        h('li', null, ...kbd('W'), ' – вземи парите'),
        h('li', null, ...kbd('L'), ' – покажи стълбата (на телефон)'),
        h('li', null, ...kbd('M'), ' – звук вкл./изкл.'),
        h('li', null, ...kbd('F'), ' – цял екран вкл./изкл.'),
      ),
    ),
  );
  return { el, focus: back };
}

export function hallOfFameScreen(ctx: AppContext): Screen {
  const back = backButton(ctx);
  const container = h('div');

  const render = () => {
    const entries = loadHallOfFame();
    const stats = loadStats();
    const dateFormat = new Intl.DateTimeFormat('bg-BG', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });

    replace(
      container,
      h(
        'div',
        { class: 'stat-grid' },
        [
          ['Изиграни игри', String(stats.gamesPlayed)],
          ['Верни отговори', String(stats.correctAnswers)],
          ['Най-голяма печалба', formatPrize(stats.bestPrize)],
          ['Общо спечелени', formatPrize(stats.totalWinnings)],
        ].map(([label, value]) =>
          h(
            'div',
            { class: 'stat card' },
            h('span', { class: 'stat__value' }, value),
            h('span', { class: 'stat__label' }, label),
          ),
        ),
      ),
      h(
        'div',
        { class: 'card' },
        entries.length === 0
          ? h('p', { class: 'empty' }, 'Още няма записи. Изиграй една игра и влез в класацията!')
          : h(
              'ol',
              { class: 'fame' },
              entries.map((e, i) =>
                h(
                  'li',
                  { class: `fame__row${i < 3 ? ` fame__row--${i + 1}` : ''}` },
                  h('span', { class: 'fame__rank' }, i < 3 ? ['🥇', '🥈', '🥉'][i] : `${i + 1}.`),
                  h('span', { class: 'fame__name' }, e.name),
                  h(
                    'span',
                    { class: 'fame__mode' },
                    `${MODES[e.mode].name} · ${e.level}/15 · ${dateFormat.format(new Date(e.date))}`,
                  ),
                  h('span', { class: 'fame__prize' }, formatPrize(e.prize)),
                ),
              ),
            ),
      ),
      stats.gamesPlayed > 0 || entries.length > 0
        ? h(
            'button',
            {
              type: 'button',
              class: 'btn btn--ghost btn--sm reset',
              onClick: () =>
                openModal({
                  title: 'Изтриване на прогреса',
                  body: h(
                    'p',
                    null,
                    'Статистиката и Залата на славата ще бъдат изтрити от този браузър. Това не може да се върне.',
                  ),
                  actions: [
                    { label: 'Отказ' },
                    {
                      label: 'Изтрий',
                      variant: 'danger',
                      onClick: () => (resetProgress(), render()),
                    },
                  ],
                }),
            },
            '🗑 Изчисти прогреса',
          )
        : null,
    );
  };
  render();

  const el = h(
    'section',
    { class: 'screen info' },
    back,
    h('h1', { class: 'info__title' }, '🏆 Зала на славата'),
    container,
  );
  return { el, focus: back };
}
