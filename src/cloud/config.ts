/**
 * Firebase settings come from VITE_FIREBASE_* variables (`.env.local` locally,
 * repository variables in the deploy workflow). These values are public by design:
 * Firebase protects the data with the security rules in `firestore.rules`, not with the key.
 *
 * Without them the site works exactly as before, just without accounts.
 * With VITE_FIREBASE_EMULATORS=true the app talks to the local Firebase emulators instead
 * (`npm run emulators`), and no real project is needed.
 */

const env = import.meta.env;

export const useEmulators = env.VITE_FIREBASE_EMULATORS === 'true';

export interface FirebaseSettings {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
}

/** Emulators accept any key; a `demo-` project id never touches the real Firebase. */
const EMULATOR_SETTINGS: FirebaseSettings = {
  apiKey: 'demo-key',
  authDomain: 'demo-become-millionaire.firebaseapp.com',
  projectId: 'demo-become-millionaire',
  appId: 'demo-app',
};

function fromEnv(): FirebaseSettings | null {
  const settings = {
    apiKey: env.VITE_FIREBASE_API_KEY ?? '',
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN ?? '',
    projectId: env.VITE_FIREBASE_PROJECT_ID ?? '',
    appId: env.VITE_FIREBASE_APP_ID ?? '',
  };
  return Object.values(settings).every((v) => v.trim() !== '') ? settings : null;
}

export const firebaseSettings: FirebaseSettings | null = useEmulators
  ? EMULATOR_SETTINGS
  : fromEnv();

export const cloudEnabled = firebaseSettings !== null;
