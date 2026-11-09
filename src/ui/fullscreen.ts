/**
 * Fullscreen helpers. Browsers only allow entering fullscreen from a user gesture
 * (a click, tap or key press), so call `enterFullscreen()` from an event handler.
 * Older Safari versions use the webkit-prefixed API; iPhone Safari has none at all.
 */

type WebkitElement = HTMLElement & { webkitRequestFullscreen?: () => void };
type WebkitDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => void;
};

const root = () => document.documentElement as WebkitElement;
const doc = () => document as WebkitDocument;

export function fullscreenSupported(): boolean {
  return Boolean(root().requestFullscreen ?? root().webkitRequestFullscreen);
}

export function isFullscreen(): boolean {
  return Boolean(document.fullscreenElement ?? doc().webkitFullscreenElement);
}

export async function enterFullscreen(): Promise<void> {
  if (isFullscreen() || !fullscreenSupported()) return;
  try {
    if (root().requestFullscreen) await root().requestFullscreen({ navigationUI: 'hide' });
    else root().webkitRequestFullscreen?.();
  } catch {
    /* refused (no gesture, iframe without permission…) – the game works the same */
  }
}

export async function exitFullscreen(): Promise<void> {
  if (!isFullscreen()) return;
  try {
    if (document.exitFullscreen) await document.exitFullscreen();
    else doc().webkitExitFullscreen?.();
  } catch {
    /* ignore */
  }
}

export function toggleFullscreen(): Promise<void> {
  return isFullscreen() ? exitFullscreen() : enterFullscreen();
}

export function onFullscreenChange(listener: () => void): void {
  document.addEventListener('fullscreenchange', listener);
  document.addEventListener('webkitfullscreenchange', listener);
}
