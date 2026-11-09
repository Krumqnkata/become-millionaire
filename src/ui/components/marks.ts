import { FRIENDS, LIFELINES, type Friend } from '../../game/lifelines.ts';
import type { LifelineId } from '../../game/types.ts';
import { h } from '../dom.ts';
import { icon } from '../icons.ts';

/** Small visual marks shared by several screens: lifelines, friends, ranks. */

/** A lifeline's symbol: "50:50" as text, the others as icons. */
export function lifelineMark(id: LifelineId, extraClass = ''): HTMLElement {
  const meta = LIFELINES[id];
  return h(
    'span',
    { class: `lifeline-mark lifeline-mark--${id} ${extraClass}`.trim(), 'aria-hidden': 'true' },
    id === 'fifty' ? h('span', { class: 'lifeline-mark__text' }, '½') : icon(meta.icon),
  );
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((part) => part[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase();

/** A friend's picture: their initials on a colour of their own. */
export function friendAvatar(friend: Friend, extraClass = ''): HTMLElement {
  const hue = (FRIENDS.indexOf(friend) * 57 + 200) % 360;
  return h(
    'span',
    {
      class: `person-avatar ${extraClass}`.trim(),
      style: `--hue: ${hue}`,
      'aria-hidden': 'true',
    },
    initials(friend.name),
  );
}

/** Place in a ranking: gold, silver and bronze discs for the top three. */
export const rankMark = (index: number) =>
  h(
    'span',
    { class: `rank${index < 3 ? ` rank--${index + 1}` : ''}`, 'aria-label': `${index + 1} място` },
    String(index + 1),
  );
