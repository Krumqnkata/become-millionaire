/**
 * A ~40-line hyperscript helper: enough to build the UI declaratively
 * without pulling in a framework.
 *
 *   h('button', { class: 'btn', onClick: start }, 'Старт')
 */

export type Child = Node | string | number | null | undefined | false;
type Children = Array<Child | Child[]>;
type Props = Record<string, unknown>;

function applyProps(el: Element, props: Props | null | undefined): void {
  if (!props) return;
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;

    if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    } else if (key === 'class') {
      el.setAttribute('class', String(value));
    } else if (key === 'style' && typeof value === 'object') {
      Object.assign((el as HTMLElement).style, value);
    } else if (key === 'dataset' && typeof value === 'object') {
      Object.assign((el as HTMLElement).dataset, value);
    } else if (key in el && !key.includes('-') && !(el instanceof SVGElement)) {
      (el as unknown as Record<string, unknown>)[key] = value;
    } else {
      el.setAttribute(key, value === true ? '' : String(value));
    }
  }
}

function appendChildren(el: Element, children: Children): void {
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : String(child));
  }
}

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props?: Props | null,
  ...children: Children
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  applyProps(el, props);
  appendChildren(el, children);
  return el;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

export function s<K extends keyof SVGElementTagNameMap>(
  tag: K,
  props?: Props | null,
  ...children: Children
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  applyProps(el, props);
  appendChildren(el, children);
  return el;
}

export const $ = <T extends Element = HTMLElement>(selector: string, root: ParentNode = document) =>
  root.querySelector<T>(selector);

export const prefersReducedMotion = () =>
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

export const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Like `el.replaceChildren()`, but accepts the same nullable children as `h()`. */
export function replace(el: Element, ...children: Children): void {
  el.replaceChildren();
  appendChildren(el, children);
}
