import { s } from '../dom.ts';

let gradientId = 0;

/** The game's mark: a gold coin with a staircase climbing to a spark. */
export function logoMark(size = 40): SVGSVGElement {
  const id = `logo-gold-${++gradientId}`;
  return s(
    'svg',
    { viewBox: '0 0 64 64', width: size, height: size, 'aria-hidden': 'true', class: 'logo-mark' },
    s(
      'defs',
      null,
      s(
        'linearGradient',
        { id, x1: '0', y1: '0', x2: '1', y2: '1' },
        s('stop', { offset: '0', 'stop-color': '#ffe9a3' }),
        s('stop', { offset: '0.55', 'stop-color': '#f5c542' }),
        s('stop', { offset: '1', 'stop-color': '#c8961e' }),
      ),
    ),
    s('circle', { cx: 32, cy: 32, r: 30, fill: `url(#${id})` }),
    s('circle', {
      cx: 32,
      cy: 32,
      r: 25,
      fill: 'none',
      stroke: '#0b1233',
      'stroke-opacity': 0.25,
      'stroke-width': 1.5,
    }),
    s('path', {
      d: 'M15 47h8v-8h8v-8h8v-8h8',
      fill: 'none',
      stroke: '#0b1233',
      'stroke-width': 4.5,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
    }),
    s('path', {
      d: 'M49 9l1.8 4.2L55 15l-4.2 1.8L49 21l-1.8-4.2L43 15l4.2-1.8z',
      fill: '#0b1233',
    }),
  );
}
