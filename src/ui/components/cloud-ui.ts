import {
  cloud,
  cloudErrorMessage,
  isSilentError,
  type CloudService,
  type CloudUser,
} from '../../cloud/index.ts';
import { VISIBILITY, type Pack } from '../../game/packs.ts';
import type { AppContext } from '../context.ts';
import { h, replace, type Child } from '../dom.ts';
import { logoMark } from './logo.ts';
import { icon } from '../icons.ts';

/** Building blocks shared by the account and pack screens. */

export const backTo = (label: string, onClick: () => void) =>
  h(
    'button',
    { type: 'button', class: 'btn btn--ghost btn--sm back', onClick },
    icon('arrow-left'),
    label,
  );

export const loadingBox = (text = 'Зареждаме…') =>
  h(
    'div',
    { class: 'loading loading--inline' },
    h('div', { class: 'loading__coin' }, logoMark(48)),
    h('p', null, text),
  );

export const errorBox = (message: string, ...actions: Child[]) =>
  h(
    'div',
    { class: 'card notice notice--error' },
    h('p', null, message),
    actions.length ? h('div', { class: 'notice__actions' }, actions) : null,
  );

export function avatar(user: CloudUser, size = 36): HTMLElement {
  if (user.photoUrl)
    return h('img', {
      class: 'avatar',
      src: user.photoUrl,
      alt: '',
      width: size,
      height: size,
      referrerPolicy: 'no-referrer',
    });
  return h(
    'span',
    { class: 'avatar avatar--letter', style: { width: `${size}px`, height: `${size}px` } },
    user.name.slice(0, 1).toUpperCase(),
  );
}

export const visibilityBadge = (pack: Pick<Pack, 'visibility'>) => {
  const v = VISIBILITY[pack.visibility];
  return h(
    'span',
    { class: `badge badge--${pack.visibility}`, title: v.hint },
    icon(v.icon),
    v.name,
  );
};

export const questionCount = (n: number) => `${n} ${n === 1 ? 'въпрос' : 'въпроса'}`;

const dateFormat = new Intl.DateTimeFormat('bg-BG', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});
export const formatDate = (date: Date | null) => (date ? dateFormat.format(date) : 'току-що');

/**
 * Sign-in: Google, or e-mail and password (with registration and a reset link).
 * Each way has to be switched on in Firebase → Authentication → Sign-in method.
 */
export function signInCard(service: CloudService, why: string): HTMLElement {
  const error = h('p', { class: 'notice__error', role: 'alert' });
  const info = h('p', { class: 'notice__info', role: 'status' });
  let mode: 'in' | 'up' = 'in';

  const busy = async (button: HTMLButtonElement, action: () => Promise<void>) => {
    button.disabled = true;
    error.textContent = '';
    info.textContent = '';
    try {
      await action();
    } catch (e) {
      if (!isSilentError(e)) error.textContent = cloudErrorMessage(e);
    } finally {
      button.disabled = false;
    }
  };

  const google: HTMLButtonElement = h(
    'button',
    {
      type: 'button',
      class: 'btn btn--provider',
      onClick: () => void busy(google, () => service.signIn()),
    },
    h('span', { class: 'provider-mark', 'aria-hidden': 'true' }, 'G'),
    'Влез с Google',
  );

  const name = h('input', {
    type: 'text',
    class: 'input',
    placeholder: 'Име, което другите ще виждат',
    maxLength: 40,
    autocomplete: 'nickname',
    'aria-label': 'Име',
    hidden: true,
  });
  const email = h('input', {
    type: 'email',
    class: 'input',
    placeholder: 'Имейл',
    autocomplete: 'email',
    required: true,
    'aria-label': 'Имейл',
  });
  const password = h('input', {
    type: 'password',
    class: 'input',
    placeholder: 'Парола',
    autocomplete: 'current-password',
    minLength: 6,
    required: true,
    'aria-label': 'Парола',
  });
  const submit = h('button', { type: 'submit', class: 'btn btn--primary' }, 'Влез');
  const switchMode = h('button', { type: 'button', class: 'link-btn' });
  const forgot = h(
    'button',
    {
      type: 'button',
      class: 'link-btn',
      onClick: () => {
        if (!email.value.trim()) {
          error.textContent = 'Въведи имейла си и пак натисни „Забравена парола“.';
          return email.focus();
        }
        void busy(forgot, async () => {
          await service.resetPassword(email.value);
          info.textContent = 'Пратихме ти имейл с линк за нова парола.';
        });
      },
    },
    'Забравена парола',
  );

  const render = () => {
    const up = mode === 'up';
    name.hidden = !up;
    password.autocomplete = up ? 'new-password' : 'current-password';
    submit.textContent = up ? 'Създай профил' : 'Влез';
    switchMode.textContent = up ? 'Имам профил' : 'Нямам профил';
    forgot.hidden = up;
  };
  switchMode.addEventListener('click', () => {
    mode = mode === 'in' ? 'up' : 'in';
    error.textContent = '';
    render();
  });
  render();

  const form = h(
    'form',
    {
      class: 'email-form',
      onSubmit: (event: Event) => {
        event.preventDefault();
        void busy(submit, () =>
          mode === 'up'
            ? service.signUpWithEmail(name.value, email.value, password.value)
            : service.signInWithEmail(email.value, password.value),
        );
      },
    },
    name,
    email,
    password,
    submit,
    h('div', { class: 'email-form__links' }, switchMode, forgot),
  );

  return h(
    'div',
    { class: 'card notice sign-in' },
    h('p', null, why),
    google,
    h('div', { class: 'sign-in__divider' }, h('span', null, 'или с имейл')),
    form,
    error,
    info,
    h(
      'small',
      { class: 'notice__fine' },
      'Пазим само името ти, прогреса ти и пакетите, които създадеш.',
    ),
  );
}

/**
 * Loads Firebase into `container` and calls `render` with the service and the current user
 * (again on every sign-in or sign-out). Returns a cleanup for the screen's `destroy`.
 */
export function withCloud(
  ctx: AppContext,
  container: HTMLElement,
  render: (service: CloudService, user: CloudUser | null) => void,
): () => void {
  let stop: (() => void) | null = null;
  let alive = true;
  replace(container, loadingBox());
  cloud
    .load()
    .then((service) => {
      if (!alive) return;
      stop = cloud.onUser((user) => render(service, user));
    })
    .catch((e) => {
      console.error(e);
      if (alive)
        replace(
          container,
          errorBox(
            cloudErrorMessage(e),
            h(
              'button',
              { type: 'button', class: 'btn btn--ghost btn--sm', onClick: () => ctx.go.menu() },
              icon('house'),
              'Меню',
            ),
          ),
        );
    });
  return () => {
    alive = false;
    stop?.();
  };
}
