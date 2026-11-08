import { h, s } from '../dom.ts';

export interface TimerView {
  el: HTMLElement;
  start(): void;
  stop(): void;
  readonly remaining: number;
}

const RADIUS = 26;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/**
 * A circular countdown. Time is measured with `performance.now()` instead of counting ticks,
 * and it runs on an interval rather than animation frames, so switching to another tab
 * does not stop the clock (no looking answers up in a background tab).
 */
export function createTimer(
  seconds: number,
  { onSecond, onExpire }: { onSecond?: (left: number) => void; onExpire: () => void },
): TimerView {
  const progress = s('circle', {
    class: 'timer__progress',
    cx: 32,
    cy: 32,
    r: RADIUS,
    'stroke-dasharray': CIRCUMFERENCE.toFixed(2),
    'stroke-dashoffset': '0',
  });
  const label = h('span', { class: 'timer__label' }, seconds);
  const el = h(
    'div',
    { class: 'timer', role: 'timer', 'aria-label': `Оставащо време: ${seconds} секунди` },
    s(
      'svg',
      { viewBox: '0 0 64 64', 'aria-hidden': 'true' },
      s('circle', { class: 'timer__track', cx: 32, cy: 32, r: RADIUS }),
      progress,
    ),
    label,
  );

  let startedAt = 0;
  let interval = 0;
  let lastWhole = seconds;
  let remaining = seconds;

  const render = () => {
    const ratio = remaining / seconds;
    progress.setAttribute('stroke-dashoffset', (CIRCUMFERENCE * (1 - ratio)).toFixed(2));
    el.classList.toggle('is-warning', remaining <= 10 && remaining > 5);
    el.classList.toggle('is-danger', remaining <= 5);
  };

  const tick = () => {
    remaining = Math.max(0, seconds - (performance.now() - startedAt) / 1000);
    const whole = Math.ceil(remaining);
    if (whole !== lastWhole) {
      lastWhole = whole;
      label.textContent = String(whole);
      el.setAttribute('aria-label', `Оставащо време: ${whole} секунди`);
      onSecond?.(whole);
    }
    render();
    if (remaining <= 0) {
      clearInterval(interval);
      interval = 0;
      onExpire();
    }
  };

  return {
    el,
    start() {
      if (interval) return;
      startedAt = performance.now() - (seconds - remaining) * 1000;
      interval = window.setInterval(tick, 100);
    },
    stop() {
      clearInterval(interval);
      interval = 0;
    },
    get remaining() {
      return remaining;
    },
  };
}
