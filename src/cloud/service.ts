import { initializeApp } from 'firebase/app';
import {
  connectAuthEmulator,
  getAuth,
  GoogleAuthProvider,
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
import { firebaseSettings, useEmulators } from './config.ts';
import type { CloudUser } from './index.ts';

/**
 * Everything that touches Firebase. Loaded lazily through `cloud.load()`.
 *
 * Data model (see firestore.rules for who may do what):
 *   packs/{packId}     – a player's question pack, questions stored inline (one read per pack)
 *   reports/{reportId} – "this pack is inappropriate", write-only for players
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

const toCloudUser = (u: User): CloudUser => ({
  uid: u.uid,
  name: (u.displayName ?? u.email?.split('@')[0] ?? 'Играч').slice(0, PACK_LIMITS.ownerName),
  photoUrl: u.photoURL,
});

export function start(onUser: (user: CloudUser | null) => void): void {
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
