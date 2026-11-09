import { initializeApp } from 'firebase/app';
import {
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  getAuth,
  GoogleAuthProvider,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  updateProfile,
  onAuthStateChanged,
  signInWithCredential,
  signInWithPopup,
  signOut as firebaseSignOut,
  type User,
} from 'firebase/auth';
import {
  addDoc,
  collection,
  connectFirestoreEmulator,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
  type DocumentData,
  type DocumentSnapshot,
} from 'firebase/firestore/lite';
import {
  cleanQuestion,
  isVisibility,
  PACK_LIMITS,
  parseQuestions,
  type Pack,
  type PackDraft,
} from '../game/packs.ts';
import { PRIZES } from '../game/ladder.ts';
import { isModeId } from '../game/modes.ts';
import type { Question } from '../game/types.ts';
import type { Progress } from '../storage/stats.ts';
import { firebaseSettings, useEmulators } from './config.ts';
import type { CloudUser } from './index.ts';

/**
 * Everything that touches Firebase. Loaded lazily through `cloud.load()`.
 *
 * Data model (see firestore.rules for who may do what):
 *   packs/{packId}     – a player's question pack, questions stored inline (one read per pack)
 *   reports/{reportId} – "this pack is inappropriate", write-only for players
 *   users/{uid}        – a player's settings, statistics and personal Hall of Fame
 *   leaderboard/{uid}_{mode} – each player's best result per mode, readable by all
 *   categories/{id}    – the official questions, one document per category (admins write)
 *   meta/bank          – when the official questions last changed (for the browser cache)
 *   admins/{uid}       – who may edit questions and moderate (created by hand in the console)
 */

if (!firebaseSettings) throw new Error('Firebase is not configured');

const app = initializeApp(firebaseSettings);
const auth = getAuth(app);
const db = getFirestore(app);
auth.languageCode = 'bg';

if (useEmulators) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
}

const PROVIDER_NAMES: Record<string, string> = {
  'google.com': 'Google',
  password: 'имейл',
};

const toCloudUser = (u: User): CloudUser => ({
  uid: u.uid,
  name: (u.displayName ?? u.email?.split('@')[0] ?? 'Играч').slice(0, PACK_LIMITS.ownerName),
  photoUrl: u.photoURL,
  provider: PROVIDER_NAMES[u.providerData[0]?.providerId ?? ''] ?? 'профил',
});

let notify: (user: CloudUser | null) => void = () => {};

export function start(onUser: (user: CloudUser | null) => void): void {
  notify = onUser;
  onAuthStateChanged(auth, (u) => onUser(u ? toCloudUser(u) : null));

  // Emulator only: lets automated tests sign in without the Google window.
  if (useEmulators) {
    (window as unknown as Record<string, unknown>).__ptmTestSignIn = (name: string) =>
      signInWithCredential(
        auth,
        GoogleAuthProvider.credential(
          JSON.stringify({ sub: name, email: `${name}@example.com`, email_verified: true, name }),
        ),
      );
  }
}

// ─── Accounts ────────────────────────────────────────────────────────────────

export async function signIn(): Promise<void> {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  await signInWithPopup(auth, provider);
}

export async function signInWithEmail(email: string, password: string): Promise<void> {
  await signInWithEmailAndPassword(auth, email.trim(), password);
}

export async function signUpWithEmail(
  name: string,
  email: string,
  password: string,
): Promise<void> {
  const { user } = await createUserWithEmailAndPassword(auth, email.trim(), password);
  const displayName = name.trim().slice(0, PACK_LIMITS.ownerName);
  if (displayName) {
    await updateProfile(user, { displayName });
    notify(toCloudUser(user)); // the sign-in event fired before the name was set
  }
}

export const resetPassword = (email: string) => sendPasswordResetEmail(auth, email.trim());

export const signOut = () => firebaseSignOut(auth);

function requireUser(): User {
  if (!auth.currentUser)
    throw Object.assign(new Error('Not signed in'), { code: 'unauthenticated' });
  return auth.currentUser;
}

// ─── Packs ───────────────────────────────────────────────────────────────────

const packs = collection(db, 'packs');

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');

/** Reads a pack defensively: the rules check the shape, not every question. */
function fromDoc(snap: DocumentSnapshot<DocumentData>): Pack | null {
  const d = snap.data();
  if (!d) return null;
  const questions = parseQuestions(d.questions);
  return {
    id: snap.id,
    ownerId: str(d.ownerId, 128),
    ownerName: str(d.ownerName, PACK_LIMITS.ownerName) || 'Играч',
    title: str(d.title, PACK_LIMITS.title) || 'Без име',
    description: str(d.description, PACK_LIMITS.description),
    visibility: isVisibility(d.visibility) ? d.visibility : 'private',
    questions,
    questionCount: questions.length,
    updatedAt: d.updatedAt instanceof Timestamp ? d.updatedAt.toDate() : null,
  };
}

const LIST_SIZE = 50;

export async function myPacks(): Promise<Pack[]> {
  const user = requireUser();
  const snap = await getDocs(
    query(packs, where('ownerId', '==', user.uid), orderBy('updatedAt', 'desc'), limit(LIST_SIZE)),
  );
  return snap.docs.map(fromDoc).filter((p): p is Pack => p !== null);
}

export async function publicPacks(): Promise<Pack[]> {
  const snap = await getDocs(
    query(
      packs,
      where('visibility', '==', 'public'),
      orderBy('updatedAt', 'desc'),
      limit(LIST_SIZE),
    ),
  );
  return snap.docs.map(fromDoc).filter((p): p is Pack => p !== null);
}

export async function getPack(id: string): Promise<Pack> {
  const pack = fromDoc(await getDoc(doc(packs, id)));
  if (!pack) throw Object.assign(new Error('Pack not found'), { code: 'not-found' });
  return pack;
}

function payload(draft: PackDraft, user: User) {
  const questions = draft.questions.map(cleanQuestion);
  return {
    ownerId: user.uid,
    ownerName: toCloudUser(user).name,
    title: draft.title.trim(),
    description: draft.description.trim(),
    visibility: draft.visibility,
    questions,
    questionCount: questions.length,
    updatedAt: serverTimestamp(),
  };
}

/** Creates a pack (no `id`) or overwrites the player's own pack. Returns the pack id. */
export async function savePack(id: string | null, draft: PackDraft): Promise<string> {
  const user = requireUser();
  if (id) {
    await updateDoc(doc(packs, id), payload(draft, user));
    return id;
  }
  const ref = await addDoc(packs, { ...payload(draft, user), createdAt: serverTimestamp() });
  return ref.id;
}

export const deletePack = (id: string) => deleteDoc(doc(packs, id));

export async function reportPack(packId: string, reason: string): Promise<void> {
  const user = requireUser();
  await setDoc(doc(collection(db, 'reports')), {
    packId,
    uid: user.uid,
    reason: reason.trim().slice(0, 500),
    createdAt: serverTimestamp(),
  });
}

// ─── Admins ──────────────────────────────────────────────────────────────────

export async function isAdmin(): Promise<boolean> {
  const user = auth.currentUser;
  if (!user) return false;
  try {
    return (await getDoc(doc(db, 'admins', user.uid))).exists();
  } catch {
    return false;
  }
}

export interface Report {
  id: string;
  packId: string;
  reason: string;
  createdAt: Date | null;
}

export async function listReports(): Promise<Report[]> {
  const snap = await getDocs(
    query(collection(db, 'reports'), orderBy('createdAt', 'desc'), limit(100)),
  );
  return snap.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      packId: str(data.packId, 128),
      reason: str(data.reason, 500),
      createdAt: data.createdAt instanceof Timestamp ? data.createdAt.toDate() : null,
    };
  });
}

export const dismissReport = (id: string) => deleteDoc(doc(db, 'reports', id));

// ─── Player progress ─────────────────────────────────────────────────────────

export async function loadRemoteProgress(): Promise<unknown> {
  const user = requireUser();
  const snap = await getDoc(doc(db, 'users', user.uid));
  return snap.exists() ? snap.data() : null;
}

export async function saveRemoteProgress(progress: Progress): Promise<void> {
  const user = requireUser();
  await setDoc(doc(db, 'users', user.uid), { ...progress, updatedAt: serverTimestamp() });
}

// ─── Leaderboard ─────────────────────────────────────────────────────────────

export interface Score {
  id: string;
  uid: string;
  name: string;
  prize: number;
  mode: string;
  level: number;
  updatedAt: Date | null;
}

const toScore = (id: string, d: DocumentData): Score => ({
  id,
  uid: str(d.uid, 128),
  name: str(d.name, 24) || 'Играч',
  prize: typeof d.prize === 'number' ? d.prize : 0,
  mode: isModeId(d.mode) ? d.mode : 'normal',
  level: typeof d.level === 'number' ? d.level : 0,
  updatedAt: d.updatedAt instanceof Timestamp ? d.updatedAt.toDate() : null,
});

/**
 * Keeps the player's best result per mode. Returns true when it is a new best.
 * The rules only accept real ladder amounts and only improvements.
 */
export async function submitScore(entry: {
  name: string;
  prize: number;
  mode: string;
  level: number;
}): Promise<boolean> {
  const user = requireUser();
  if (entry.prize <= 0 || !(PRIZES as readonly number[]).includes(entry.prize)) return false;
  const ref = doc(db, 'leaderboard', `${user.uid}_${entry.mode}`);
  const current = await getDoc(ref);
  if (current.exists() && (current.data().prize as number) >= entry.prize) return false;
  await setDoc(ref, {
    uid: user.uid,
    name: entry.name.trim().slice(0, 24) || toCloudUser(user).name.slice(0, 24),
    prize: entry.prize,
    mode: entry.mode,
    level: entry.level,
    updatedAt: serverTimestamp(),
  });
  return true;
}

export async function topScores(size = 20): Promise<Score[]> {
  const snap = await getDocs(
    query(
      collection(db, 'leaderboard'),
      orderBy('prize', 'desc'),
      orderBy('updatedAt', 'asc'),
      limit(size),
    ),
  );
  return snap.docs.map((d) => toScore(d.id, d.data()));
}

export const deleteScore = (id: string) => deleteDoc(doc(db, 'leaderboard', id));

// ─── Official questions (admins) ─────────────────────────────────────────────

export interface CategoryDoc {
  id: string;
  name: string;
  icon: string;
  order: number;
  questions: Question[];
}

export async function loadCategories(): Promise<CategoryDoc[]> {
  const snap = await getDocs(collection(db, 'categories'));
  return snap.docs
    .map((d) => {
      const data = d.data();
      return {
        id: d.id,
        name: str(data.name, 60),
        icon: str(data.icon, 40),
        order: typeof data.order === 'number' ? data.order : 0,
        questions: Array.isArray(data.questions) ? (data.questions as Question[]) : [],
      };
    })
    .sort((a, b) => a.order - b.order);
}

const categoryData = (c: CategoryDoc) => ({
  name: c.name,
  icon: c.icon,
  order: c.order,
  questions: c.questions.map((q) => {
    const clean: Question = {
      id: q.id,
      difficulty: q.difficulty,
      question: q.question.trim(),
      answers: q.answers.map((a) => a.trim()) as Question['answers'],
      correct: q.correct,
    };
    if (q.explanation?.trim()) clean.explanation = q.explanation.trim();
    return clean;
  }),
  updatedAt: serverTimestamp(),
});

/** Saves categories and marks the question bank as changed, in one atomic write. */
export async function saveCategories(
  categories: CategoryDoc[],
  removed: string[] = [],
): Promise<void> {
  requireUser();
  const batch = writeBatch(db);
  for (const c of categories) batch.set(doc(db, 'categories', c.id), categoryData(c));
  for (const id of removed) batch.delete(doc(db, 'categories', id));
  batch.set(doc(db, 'meta', 'bank'), { updatedAt: serverTimestamp() });
  await batch.commit();
}
