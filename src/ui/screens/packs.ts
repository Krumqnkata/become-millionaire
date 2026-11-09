import { cloud, cloudErrorMessage, type CloudService, type CloudUser } from '../../cloud/index.ts';
import { MODE_ORDER, MODES } from '../../game/modes.ts';
import { isPlayable, PACK_LIMITS, packToBank, type Pack } from '../../game/packs.ts';
import type { ModeId } from '../../game/types.ts';
import { loadSettings, saveSettings } from '../../storage/stats.ts';
import {
  avatar,
  backTo,
  errorBox,
  formatDate,
  loadingBox,
  questionCount,
  signInCard,
  visibilityBadge,
  withCloud,
} from '../components/cloud-ui.ts';
import { openModal } from '../components/modal.ts';
import type { AppContext, Screen } from '../context.ts';
import { h, replace } from '../dom.ts';
import { enterFullscreen } from '../fullscreen.ts';
import { packUrl, shareLink } from '../links.ts';
import { icon } from '../icons.ts';

const copyLinkButton = (pack: Pack, label = 'Копирай линка') => {
  const button = h(
    'button',
    {
      type: 'button',
      class: 'btn btn--ghost btn--sm',
      onClick: async () => {
        const ok = await shareLink(pack.title, packUrl(pack.id));
        button.replaceChildren(icon(ok ? 'check' : 'x'), ok ? 'Копирано' : 'Не стана');
        setTimeout(() => button.replaceChildren(icon('link'), label), 2000);
      },
    },
    label,
  );
  return button;
};

// ─── My packs ────────────────────────────────────────────────────────────────

export function myPacksScreen(ctx: AppContext): Screen {
  const back = backTo('Меню', () => ctx.go.menu());
  const body = h('div', { class: 'packs' });

  const stop = withCloud(ctx, body, (service, user) => {
    if (!user) {
      replace(
        body,
        signInCard(
          service,
          'Влез с профила си, за да правиш свои пакети с въпроси, да ги играеш и да ги споделяш с приятели.',
        ),
      );
      return;
    }
    void renderMine(service, user);
  });

  async function renderMine(service: CloudService, user: CloudUser) {
    const list = h('div', { class: 'pack-list' }, loadingBox('Зареждаме пакетите ти…'));
    const adminLink = h(
      'button',
      { type: 'button', class: 'btn btn--ghost', hidden: true, onClick: () => ctx.go.admin() },
      icon('shield'),
      'Администрация',
    );
    replace(
      body,
      h(
        'div',
        { class: 'card profile' },
        avatar(user, 44),
        h(
          'div',
          { class: 'profile__text' },
          h('strong', null, user.name),
          h('small', null, `Вход с ${user.provider}`),
        ),
        h(
          'button',
          {
            type: 'button',
            class: 'btn btn--ghost btn--sm',
            onClick: () => void service.signOut(),
          },
          'Изход',
        ),
      ),
      h(
        'div',
        { class: 'packs__actions' },
        h(
          'button',
          { type: 'button', class: 'btn btn--primary', onClick: () => ctx.go.editPack(null) },
          icon('plus'),
          'Нов пакет',
        ),
        h(
          'button',
          { type: 'button', class: 'btn btn--ghost', onClick: () => ctx.go.browse() },
          icon('globe'),
          'Пакети на играчите',
        ),
        adminLink,
      ),
      list,
    );
    void service.isAdmin().then((admin) => (adminLink.hidden = !admin));

    try {
      const packs = await service.myPacks();
      if (packs.length === 0) {
        replace(
          list,
          h(
            'div',
            { class: 'card empty' },
            h('p', null, 'Още нямаш пакети.'),
            h(
              'p',
              { class: 'hint' },
              `Направи пакет с поне ${PACK_LIMITS.minToPlay} въпроса: за приятели, за час в училище или за рожден ден.`,
            ),
          ),
        );
        return;
      }
      replace(
        list,
        packs.map((pack) => ownPackRow(service, pack, () => void renderMine(service, user))),
      );
    } catch (e) {
      console.error(e);
      replace(list, errorBox(cloudErrorMessage(e)));
    }
  }

  function ownPackRow(service: CloudService, pack: Pack, refresh: () => void): HTMLElement {
    const playable = isPlayable(pack);
    return h(
      'article',
      { class: 'card pack-row' },
      h(
        'div',
        { class: 'pack-row__main' },
        h('h3', { class: 'pack-row__title' }, pack.title),
        h(
          'p',
          { class: 'pack-row__meta' },
          visibilityBadge(pack),
          ` · ${questionCount(pack.questionCount)} · ${formatDate(pack.updatedAt)}`,
        ),
        playable
          ? null
          : h(
              'p',
              { class: 'hint' },
              `Още ${PACK_LIMITS.minToPlay - pack.questionCount} въпроса до пълна игра.`,
            ),
      ),
      h(
        'div',
        { class: 'pack-row__actions' },
        playable
          ? h(
              'button',
              {
                type: 'button',
                class: 'btn btn--primary btn--sm',
                onClick: () => ctx.go.pack(pack.id, pack),
              },
              icon('play'),
              'Играй',
            )
          : null,
        h(
          'button',
          { type: 'button', class: 'btn btn--ghost btn--sm', onClick: () => ctx.go.editPack(pack) },
          icon('pencil'),
          'Редактирай',
        ),
        pack.visibility === 'private' ? null : copyLinkButton(pack, 'Линк'),
        h(
          'button',
          {
            type: 'button',
            class: 'btn btn--ghost btn--sm',
            'aria-label': `Изтрий „${pack.title}“`,
            title: 'Изтрий',
            onClick: () =>
              openModal({
                title: 'Да изтрия ли пакета?',
                body: h(
                  'p',
                  null,
                  `„${pack.title}“ ще бъде изтрит завинаги, също и за всеки, който има линка.`,
                ),
                actions: [
                  { label: 'Отказ' },
                  {
                    label: 'Изтрий',
                    variant: 'danger',
                    onClick: () =>
                      void service
                        .deletePack(pack.id)
                        .then(refresh)
                        .catch((e) =>
                          openModal({
                            title: 'Не стана',
                            body: h('p', null, cloudErrorMessage(e)),
                            actions: [{ label: 'Добре' }],
                          }),
                        ),
                  },
                ],
              }),
          },
          icon('trash'),
        ),
      ),
    );
  }

  const el = h(
    'section',
    { class: 'screen info' },
    back,
    h('h1', { class: 'info__title' }, icon('notebook-pen'), 'Моите въпроси'),
    body,
  );
  return { el, focus: back, destroy: stop };
}

// ─── Public catalogue ────────────────────────────────────────────────────────

export function browseScreen(ctx: AppContext): Screen {
  const back = backTo('Меню', () => ctx.go.menu());
  const body = h('div', { class: 'packs' });

  const stop = withCloud(ctx, body, (service) => {
    replace(body, loadingBox('Зареждаме пакетите…'));
    service
      .publicPacks()
      .then((packs) => {
        const playable = packs.filter(isPlayable);
        replace(
          body,
          h(
            'p',
            { class: 'hint' },
            'Пакети с въпроси, направени от играчите. Искаш и ти? ',
            h(
              'button',
              { type: 'button', class: 'link-btn', onClick: () => ctx.go.myPacks() },
              'Направи свой пакет',
            ),
            '.',
          ),
          playable.length === 0
            ? h('div', { class: 'card empty' }, 'Още няма публични пакети. Бъди първият!')
            : h(
                'div',
                { class: 'pack-list' },
                playable.map((pack) =>
                  h(
                    'button',
                    {
                      type: 'button',
                      class: 'card pack-row pack-row--link',
                      onClick: () => ctx.go.pack(pack.id, pack),
                    },
                    h(
                      'span',
                      { class: 'pack-row__main' },
                      h('span', { class: 'pack-row__title' }, pack.title),
                      h(
                        'span',
                        { class: 'pack-row__meta' },
                        `от ${pack.ownerName} · ${questionCount(pack.questionCount)}`,
                      ),
                      pack.description
                        ? h('span', { class: 'pack-row__desc' }, pack.description)
                        : null,
                    ),
                    icon('arrow-right', { class: 'btn__arrow' }),
                  ),
                ),
              ),
        );
      })
      .catch((e) => {
        console.error(e);
        replace(body, errorBox(cloudErrorMessage(e)));
      });
  });

  const el = h(
    'section',
    { class: 'screen info' },
    back,
    h('h1', { class: 'info__title' }, icon('globe'), 'Пакети на играчите'),
    body,
  );
  return { el, focus: back, destroy: stop };
}

// ─── One pack: details and start ─────────────────────────────────────────────

export function packScreen(ctx: AppContext, id: string, preloaded?: Pack): Screen {
  const back = backTo('Меню', () => ctx.go.menu());
  const body = h('div', { class: 'packs' });
  let pack: Pack | null = preloaded ?? null;

  const stop = withCloud(ctx, body, (service, user) => {
    if (pack) {
      render(service, pack, user);
      return;
    }
    service
      .getPack(id)
      .then((loaded) => {
        pack = loaded;
        render(service, loaded, cloud.user);
      })
      .catch((e) => {
        console.error(e);
        replace(
          body,
          errorBox(
            cloudErrorMessage(e),
            h(
              'button',
              { type: 'button', class: 'btn btn--ghost btn--sm', onClick: () => ctx.go.browse() },
              icon('globe'),
              'Други пакети',
            ),
          ),
        );
      });
  });

  function render(service: CloudService, p: Pack, user: CloudUser | null) {
    const isOwner = user?.uid === p.ownerId;
    // Admins can take down any pack (the rules check it again).
    const adminDelete = h(
      'button',
      {
        type: 'button',
        class: 'btn btn--danger btn--sm',
        hidden: true,
        onClick: () =>
          openModal({
            title: 'Да изтрия ли пакета?',
            body: h('p', null, `„${p.title}“ от ${p.ownerName} ще бъде изтрит за всички.`),
            actions: [
              { label: 'Отказ' },
              {
                label: 'Изтрий',
                variant: 'danger',
                onClick: () =>
                  void service
                    .deletePack(p.id)
                    .then(() => ctx.go.browse())
                    .catch((e) => alert(cloudErrorMessage(e))),
              },
            ],
          }),
      },
      icon('trash'),
      'Изтрий (админ)',
    );
    const settings = loadSettings();
    let mode: ModeId = settings.lastMode;

    const modeButtons = MODE_ORDER.map((m) =>
      h(
        'button',
        {
          type: 'button',
          class: `mode-pill mode--${m}`,
          role: 'radio',
          'aria-checked': String(m === mode),
          dataset: { mode: m },
          title: MODES[m].tagline,
          onClick: () => {
            mode = m;
            modeButtons.forEach((b) =>
              b.setAttribute('aria-checked', String(b.dataset.mode === m)),
            );
            ctx.audio.play('select');
          },
        },
        MODES[m].name,
      ),
    );

    const nameInput = h('input', {
      type: 'text',
      class: 'input input--name',
      maxLength: 24,
      placeholder: 'Твоето име',
      value: settings.playerName,
      'aria-label': 'Име на участника',
      autocomplete: 'nickname',
    });

    const playable = isPlayable(p);
    const start = h(
      'button',
      {
        type: 'button',
        class: 'btn btn--primary btn--xl',
        disabled: !playable,
        onClick: () => {
          if (loadSettings().fullscreen) void enterFullscreen();
          saveSettings({ lastMode: mode, playerName: nameInput.value.trim().slice(0, 24) });
          ctx.go.play(mode, [], { pack: p, bank: packToBank(p) });
        },
      },
      'Към студиото',
      icon('arrow-right', { class: 'btn__arrow' }),
    );

    replace(
      body,
      h(
        'div',
        { class: 'card menu__panel pack-hero' },
        h(
          'p',
          { class: 'pack-hero__meta' },
          visibilityBadge(p),
          ` · от ${p.ownerName} · ${questionCount(p.questionCount)}`,
        ),
        h('h2', { class: 'pack-hero__title' }, p.title),
        p.description ? h('p', { class: 'pack-hero__desc' }, p.description) : null,
        playable
          ? null
          : h(
              'p',
              { class: 'notice__error' },
              `Пакетът има ${questionCount(p.questionCount)}. За игра са нужни поне ${PACK_LIMITS.minToPlay}.`,
            ),
        h('h3', { class: 'section-title' }, h('span', { class: 'step' }, '1'), 'Избери трудност'),
        h(
          'div',
          { class: 'mode-pills', role: 'radiogroup', 'aria-label': 'Трудност' },
          modeButtons,
        ),
        h(
          'h3',
          { class: 'section-title' },
          h('span', { class: 'step' }, '2'),
          'Как се казва участникът?',
        ),
        nameInput,
        start,
      ),
      h(
        'nav',
        { class: 'menu__links', 'aria-label': 'Още' },
        p.visibility === 'private' ? null : copyLinkButton(p),
        isOwner
          ? h(
              'button',
              {
                type: 'button',
                class: 'btn btn--ghost btn--sm',
                onClick: () => ctx.go.editPack(p),
              },
              icon('pencil'),
              'Редактирай',
            )
          : h(
              'button',
              {
                type: 'button',
                class: 'btn btn--ghost btn--sm',
                onClick: () => report(service, p, user),
              },
              icon('flag'),
              'Докладвай',
            ),
        adminDelete,
      ),
    );
    if (user && !isOwner) void service.isAdmin().then((admin) => (adminDelete.hidden = !admin));
    if (playable) start.focus({ preventScroll: true });
  }

  function report(service: CloudService, p: Pack, user: CloudUser | null) {
    if (!user) {
      openModal({
        title: 'Докладване',
        body: signInCard(service, 'За да докладваш пакет, влез с профила си.'),
        actions: [{ label: 'Затвори' }],
      });
      return;
    }
    const reason = h('textarea', {
      class: 'input textarea',
      rows: 3,
      maxLength: 500,
      placeholder: 'Какво не е наред? (обидно съдържание, спам, грешни отговори…)',
      'aria-label': 'Причина',
    });
    const status = h('p', { class: 'notice__error', role: 'alert' });
    const close = openModal({
      title: `Докладвай „${p.title}“`,
      body: [reason, status],
      actions: [
        { label: 'Отказ' },
        {
          label: 'Изпрати',
          variant: 'primary',
          keepOpen: true,
          onClick: () => {
            if (!reason.value.trim()) return reason.focus();
            service
              .reportPack(p.id, reason.value)
              .then(() => {
                close();
                openModal({
                  title: 'Благодарим!',
                  body: h('p', null, 'Ще прегледаме пакета.'),
                  actions: [{ label: 'Добре' }],
                });
              })
              .catch((e) => (status.textContent = cloudErrorMessage(e)));
          },
        },
      ],
    });
  }

  const el = h('section', { class: 'screen info' }, back, body);
  return { el, focus: back, destroy: stop };
}
