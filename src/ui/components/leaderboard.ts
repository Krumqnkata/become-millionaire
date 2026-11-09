import { cloud, cloudErrorMessage } from '../../cloud/index.ts';
import { formatPrize } from '../../game/ladder.ts';
import { isModeId, MODES } from '../../game/modes.ts';
import type { AppContext } from '../context.ts';
import { h, replace } from '../dom.ts';
import { icon } from '../icons.ts';
import { errorBox, loadingBox, withCloud } from './cloud-ui.ts';
import { rankMark } from './marks.ts';

/**
 * The global leaderboard: every signed-in player's best result per mode.
 * Results are sent from the browser, so a determined cheater could fake one;
 * admins can remove such entries straight from this list.
 */
export function globalLeaderboard(ctx: AppContext): { el: HTMLElement; destroy: () => void } {
  const body = h('div');
  const el = h(
    'section',
    { class: 'card board' },
    h('h2', { class: 'board__title' }, icon('earth'), 'Всички играчи'),
    body,
  );
  if (!cloud.enabled) return { el: h('div', { hidden: true }), destroy: () => {} };

  const destroy = withCloud(ctx, body, (service, user) => {
    replace(body, loadingBox('Зареждаме класацията…'));
    void Promise.all([service.topScores(20), service.isAdmin()])
      .then(([scores, admin]) => {
        const rows = scores.map((s, i) =>
          h(
            'li',
            {
              class: `fame__row${i < 3 ? ` fame__row--${i + 1}` : ''}${s.uid === user?.uid ? ' is-me' : ''}`,
            },
            h('span', { class: 'fame__rank' }, rankMark(i)),
            h('span', { class: 'fame__name' }, s.name),
            h(
              'span',
              { class: 'fame__mode' },
              `${isModeId(s.mode) ? MODES[s.mode].name : s.mode} · ${s.level}/15`,
            ),
            h(
              'span',
              { class: 'fame__prize' },
              formatPrize(s.prize),
              admin
                ? h(
                    'button',
                    {
                      type: 'button',
                      class: 'icon-btn icon-btn--sm fame__remove',
                      title: 'Премахни резултата',
                      'aria-label': `Премахни резултата на ${s.name}`,
                      onClick: () =>
                        void service
                          .deleteScore(s.id)
                          .then(() => rows[i]?.remove())
                          .catch((e) => alert(cloudErrorMessage(e))),
                    },
                    icon('trash'),
                  )
                : null,
            ),
          ),
        );
        replace(
          body,
          scores.length === 0
            ? h(
                'p',
                { class: 'empty' },
                'Още няма резултати. Влез с профила си, изиграй игра и бъди първият.',
              )
            : h('ol', { class: 'fame' }, rows),
          user
            ? null
            : h(
                'p',
                { class: 'board__hint' },
                'Влез с профила си, за да се появиш тук. ',
                h(
                  'button',
                  { type: 'button', class: 'link-btn', onClick: () => ctx.go.myPacks() },
                  'Вход',
                ),
              ),
        );
      })
      .catch((e) => {
        console.error(e);
        replace(body, errorBox(cloudErrorMessage(e)));
      });
  });
  return { el, destroy };
}

/** After a game: sends the result to the global leaderboard if the player is signed in. */
export async function submitToLeaderboard(entry: {
  name: string;
  prize: number;
  mode: string;
  level: number;
}): Promise<boolean> {
  if (!cloud.enabled || !cloud.user || entry.prize <= 0) return false;
  try {
    const service = await cloud.load();
    return await service.submitScore(entry);
  } catch (error) {
    console.warn('Leaderboard submit failed', error);
    return false;
  }
}
