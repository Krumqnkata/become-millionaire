import { cloudEnabled } from './config.ts';
import type * as Service from './service.ts';

/**
 * The app's door to accounts and player-made packs.
 * The Firebase SDK is big, so it is only downloaded when this is first needed
 * (shortly after the menu appears): the game itself never waits for it.
 */

export interface CloudUser {
  uid: string;
  name: string;
  photoUrl: string | null;
}

export type CloudService = typeof Service;

type UserListener = (user: CloudUser | null) => void;

let service: Promise<CloudService> | null = null;
let user: CloudUser | null = null;
let known = false;
const listeners = new Set<UserListener>();

export const cloud = {
  enabled: cloudEnabled,

  /** The signed-in player, or `null`. Only meaningful once `known` is true. */
  get user(): CloudUser | null {
    return user;
  },

  /** True once Firebase has told us whether someone is signed in. */
  get known(): boolean {
    return known;
  },

  /** Calls `listener` now and on every sign-in / sign-out. Returns an unsubscribe. */
  onUser(listener: UserListener): () => void {
    listeners.add(listener);
    if (known) listener(user);
    return () => listeners.delete(listener);
  },

  /** Loads Firebase (once) and returns the service. */
  load(): Promise<CloudService> {
    if (!cloudEnabled) return Promise.reject(new Error('Акаунтите не са настроени'));
    service ??= import('./service.ts').then((m) => {
      m.start((next) => {
        user = next;
        known = true;
        listeners.forEach((l) => l(next));
      });
      return m;
    });
    return service;
  },
};

const MESSAGES: Record<string, string> = {
  'permission-denied': 'Пакетът не съществува или е личен.',
  'not-found': 'Пакетът не съществува.',
  unavailable: 'Няма връзка със сървъра. Провери интернета и опитай пак.',
  unauthenticated: 'Трябва да влезеш в профила си.',
  'resource-exhausted': 'Сървърът е претоварен. Опитай пак след малко.',
  // A new index is still being built (a few minutes after `npm run firebase:deploy`).
  'failed-precondition': 'Базата още се подготвя. Опитай пак след няколко минути.',
  'auth/popup-blocked': 'Браузърът блокира прозореца за вход. Разреши изскачащите прозорци.',
  'auth/network-request-failed': 'Няма връзка със сървъра. Провери интернета и опитай пак.',
  'auth/unauthorized-domain':
    'Този адрес не е разрешен за вход. Добави го във Firebase → Authentication → Settings → Authorized domains.',
  'auth/operation-not-allowed':
    'Входът с Google не е включен във Firebase (Authentication → Sign-in method).',
};

/** Codes that just mean "the player closed the sign-in window". */
const SILENT = new Set(['auth/popup-closed-by-user', 'auth/cancelled-popup-request']);

const codeOf = (error: unknown) =>
  typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';

export const isSilentError = (error: unknown) => SILENT.has(codeOf(error));

/** A Bulgarian message for a Firebase error. */
export function cloudErrorMessage(error: unknown): string {
  const code = codeOf(error);
  return (
    MESSAGES[code] ??
    MESSAGES[code.replace(/^firestore\//, '')] ??
    'Нещо се обърка. Опитай пак след малко.'
  );
}
