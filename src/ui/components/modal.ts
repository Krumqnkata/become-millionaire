import { h, type Child } from '../dom.ts';

export interface ModalAction {
  label: string;
  variant?: 'primary' | 'ghost' | 'danger';
  onClick?: () => void;
  /** Keep the modal open after the click. */
  keepOpen?: boolean;
}

export interface ModalOptions {
  title: string;
  body: Child | Child[];
  actions: ModalAction[];
  onClose?: () => void;
}

/** Opens a native <dialog> (focus trap and Esc for free). Returns a function that closes it. */
export function openModal({ title, body, actions, onClose }: ModalOptions): () => void {
  let closed = false;
  const dialog = h('dialog', { class: 'modal', 'aria-labelledby': 'modal-title' });

  const close = () => {
    if (closed) return;
    closed = true;
    dialog.classList.add('is-closing');
    setTimeout(() => {
      if (dialog.open) dialog.close();
      dialog.remove();
    }, 160);
    onClose?.();
  };

  dialog.append(
    h('h2', { class: 'modal__title', id: 'modal-title' }, title),
    h('div', { class: 'modal__body' }, body),
    h(
      'div',
      { class: 'modal__actions' },
      actions.map((action) =>
        h(
          'button',
          {
            class: `btn btn--${action.variant ?? 'ghost'}`,
            type: 'button',
            onClick: () => {
              action.onClick?.();
              if (!action.keepOpen) close();
            },
          },
          action.label,
        ),
      ),
    ),
  );

  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    close();
  });
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) close(); // click on the backdrop
  });

  document.body.append(dialog);
  dialog.showModal();
  return close;
}
