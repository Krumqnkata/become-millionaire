import { ANSWER_LETTERS, FRIENDS, type Friend } from '../../game/lifelines.ts';
import { h, prefersReducedMotion, wait } from '../dom.ts';
import { icon } from '../icons.ts';
import { friendAvatar } from './marks.ts';

const CATEGORY_HINTS: Record<string, string> = {
  history: 'история',
  bulgaria: 'България',
  science: 'наука',
  geography: 'география',
  sport: 'спорт',
  art: 'изкуство',
  general: 'обща култура',
  entertainment: 'кино и музика',
  animals: 'животни',
  tech: 'технологии',
  myth: 'митология',
  food: 'кухня',
  language: 'езика',
};

// ── Ask the audience ─────────────────────────────────────────────────────────

export interface AudienceView {
  el: HTMLElement;
  /** Animates the voting, then settles on the real result. */
  run(votes: number[]): Promise<void>;
}

export function audiencePanel(hidden: ReadonlySet<number>): AudienceView {
  const bars: HTMLElement[] = [];
  const labels: HTMLElement[] = [];
  const cols = [0, 1, 2, 3].map((i) => {
    const bar = h('div', { class: 'poll__bar', style: { height: '0%' } });
    const pct = h('span', { class: 'poll__pct' }, '–');
    bars.push(bar);
    labels.push(pct);
    return h(
      'div',
      { class: `poll__col${hidden.has(i) ? ' is-hidden' : ''}` },
      pct,
      h('div', { class: 'poll__track' }, bar),
      h('span', { class: 'poll__letter' }, ANSWER_LETTERS[i]),
    );
  });
  const title = h('h3', { class: 'panel__title' }, 'Публиката гласува…');
  const poll = h('div', { class: 'poll', role: 'img', 'aria-label': 'Гласуване' }, cols);
  const el = h(
    'section',
    { class: 'panel panel--poll is-voting', 'aria-label': 'Гласуване на публиката' },
    title,
    poll,
  );

  return {
    el,
    async run(votes) {
      if (!prefersReducedMotion()) {
        const end = performance.now() + 2600;
        while (performance.now() < end) {
          bars.forEach(
            (bar, i) => (bar.style.height = hidden.has(i) ? '0%' : `${10 + Math.random() * 70}%`),
          );
          await wait(160);
        }
      }
      const top = Math.max(...votes);
      votes.forEach((v, i) => {
        bars[i]!.style.height = `${v}%`;
        labels[i]!.textContent = `${v}%`;
        cols[i]!.classList.toggle('is-top', v === top);
      });
      el.classList.remove('is-voting');
      title.textContent = 'Публиката гласува';
      poll.setAttribute(
        'aria-label',
        votes.map((v, i) => `${ANSWER_LETTERS[i]}: ${v}%`).join(', '),
      );
    },
  };
}

// ── Phone a friend ───────────────────────────────────────────────────────────

/** Lets the player choose whom to call, like picking a name from the contact list. */
export function friendPicker(onPick: (friend: Friend) => void): HTMLElement {
  return h(
    'section',
    { class: 'panel panel--friends', 'aria-label': 'Избери приятел' },
    h('h3', { class: 'panel__title' }, 'На кого да се обадим?'),
    h(
      'div',
      { class: 'friends' },
      FRIENDS.map((friend) =>
        h(
          'button',
          { type: 'button', class: 'friend', onClick: () => onPick(friend) },
          friendAvatar(friend, 'friend__avatar'),
          h('span', { class: 'friend__name' }, friend.name),
          h('span', { class: 'friend__role' }, friend.role),
          h(
            'span',
            { class: 'friend__tags' },
            icon('star'),
            friend.expertise.map((c) => CATEGORY_HINTS[c] ?? c).join(', '),
          ),
        ),
      ),
    ),
  );
}

export interface CallView {
  el: HTMLElement;
  /** Starts the 30-second clock. Resolves when it runs out or `end()` is called. */
  countdown(seconds: number): Promise<void>;
  showAnswer(message: string, confidence: number): void;
  end(): void;
}

export function callPanel(friend: Friend): CallView {
  const clock = h('span', { class: 'call__clock' }, '30');
  const message = h(
    'p',
    { class: 'call__message' },
    h('span', { class: 'dots' }, h('i'), h('i'), h('i')),
  );
  const meterFill = h('div', { class: 'call__meter-fill', style: { width: '0%' } });
  const meterValue = h('span', null, '');
  const meter = h(
    'div',
    { class: 'call__meter', hidden: true },
    h('span', null, 'Увереност'),
    h('div', { class: 'call__meter-track' }, meterFill),
    meterValue,
  );

  const el = h(
    'section',
    { class: 'panel panel--call is-ringing', 'aria-label': `Обаждане на ${friend.name}` },
    h('h3', { class: 'panel__title' }, 'Разговор', clock),
    h(
      'div',
      { class: 'call' },
      friendAvatar(friend, 'call__avatar'),
      h(
        'div',
        { class: 'call__body' },
        h('p', { class: 'call__who' }, h('strong', null, friend.name), ` · ${friend.role}`),
        message,
        meter,
      ),
    ),
  );

  let stop: (() => void) | null = null;

  return {
    el,
    countdown(seconds) {
      el.classList.remove('is-ringing');
      return new Promise<void>((resolve) => {
        const started = performance.now();
        const interval = setInterval(() => {
          const left = Math.max(0, seconds - Math.floor((performance.now() - started) / 1000));
          clock.textContent = String(left);
          clock.classList.toggle('is-low', left <= 10);
          if (left === 0) stop?.();
        }, 200);
        stop = () => {
          clearInterval(interval);
          stop = null;
          resolve();
        };
      });
    },
    showAnswer(text, confidence) {
      message.textContent = text;
      meter.hidden = false;
      meterValue.textContent = `${confidence}%`;
      requestAnimationFrame(() => (meterFill.style.width = `${confidence}%`));
    },
    end() {
      stop?.();
      el.classList.add('is-ended');
    },
  };
}
