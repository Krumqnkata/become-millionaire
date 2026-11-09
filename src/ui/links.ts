/** Shareable links. A pack is opened with `?pack=<id>`, which works on any static host. */

const PARAM = 'pack';

export function packUrl(id: string): string {
  const url = new URL(import.meta.env.BASE_URL, location.origin);
  url.searchParams.set(PARAM, id);
  return url.toString();
}

/** The pack id in the address bar, if the page was opened from a pack link. */
export function packIdFromUrl(): string | null {
  const id = new URLSearchParams(location.search).get(PARAM);
  return id && /^[A-Za-z0-9_-]{1,128}$/.test(id) ? id : null;
}

/** Keeps the address bar in sync, so a pack page can be copied and shared as is. */
export function showPackInUrl(id: string | null): void {
  const url = new URL(location.href);
  if (id) url.searchParams.set(PARAM, id);
  else url.searchParams.delete(PARAM);
  if (url.href !== location.href) history.replaceState(history.state, '', url);
}

/** Copies a link, using the share sheet on phones. Returns true when it worked. */
export async function shareLink(title: string, url: string): Promise<boolean> {
  try {
    if (navigator.share && matchMedia('(pointer: coarse)').matches) {
      await navigator.share({ title, url });
      return true;
    }
    await navigator.clipboard.writeText(url);
    return true;
  } catch {
    return false;
  }
}
