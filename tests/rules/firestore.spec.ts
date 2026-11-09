import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  Timestamp,
} from 'firebase/firestore';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

// Runs against the Firestore emulator: `npm run test:rules`.

let env: RulesTestEnvironment;

const question = (i: number) => ({
  question: `Въпрос ${i}?`,
  answers: ['А', 'Б', 'В', 'Г'],
  correct: 0,
  difficulty: 3,
});

const pack = (owner: string, overrides: Record<string, unknown> = {}) => ({
  ownerId: owner,
  ownerName: owner,
  title: 'Моят пакет',
  description: '',
  visibility: 'private',
  questions: Array.from({ length: 15 }, (_, i) => question(i + 1)),
  questionCount: 15,
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
  ...overrides,
});

const as = (uid: string | null) =>
  (uid ? env.authenticatedContext(uid) : env.unauthenticatedContext()).firestore();

/** Writes a pack directly, bypassing the rules. */
async function seed(id: string, data: Record<string, unknown>) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'packs', id), {
      ...data,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
  });
}

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-become-millionaire',
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
  });
});

beforeEach(() => env.clearFirestore());
afterAll(() => env.cleanup());

describe('creating packs', () => {
  it('lets a signed-in player create their own pack', async () => {
    await assertSucceeds(setDoc(doc(as('ana'), 'packs/p1'), pack('ana')));
  });

  it('rejects guests and packs created in someone else’s name', async () => {
    await assertFails(setDoc(doc(as(null), 'packs/p1'), pack('ana')));
    await assertFails(setDoc(doc(as('ivo'), 'packs/p1'), pack('ana')));
  });

  it('allows a short private draft but not a short shared pack', async () => {
    const short = { questions: [question(1)], questionCount: 1 };
    await assertSucceeds(setDoc(doc(as('ana'), 'packs/p1'), pack('ana', short)));
    await assertFails(
      setDoc(doc(as('ana'), 'packs/p2'), pack('ana', { ...short, visibility: 'link' })),
    );
  });

  it('rejects unknown fields, wrong counts, bad visibility and client timestamps', async () => {
    const db = as('ana');
    await assertFails(setDoc(doc(db, 'packs/a'), pack('ana', { plays: 1000 })));
    await assertFails(setDoc(doc(db, 'packs/b'), pack('ana', { questionCount: 99 })));
    await assertFails(setDoc(doc(db, 'packs/c'), pack('ana', { visibility: 'everyone' })));
    await assertFails(setDoc(doc(db, 'packs/d'), pack('ana', { updatedAt: Timestamp.now() })));
    await assertFails(setDoc(doc(db, 'packs/e'), pack('ana', { title: '' })));
    await assertFails(setDoc(doc(db, 'packs/f'), pack('ana', { title: 'x'.repeat(81) })));
  });
});

describe('reading packs', () => {
  beforeEach(async () => {
    await seed('mine', pack('ana'));
    await seed('link', pack('ana', { visibility: 'link' }));
    await seed('pub', pack('ana', { visibility: 'public' }));
  });

  it('shows a private pack only to its owner', async () => {
    await assertSucceeds(getDoc(doc(as('ana'), 'packs/mine')));
    await assertFails(getDoc(doc(as('ivo'), 'packs/mine')));
    await assertFails(getDoc(doc(as(null), 'packs/mine')));
  });

  it('opens link and public packs for anyone, even guests', async () => {
    await assertSucceeds(getDoc(doc(as(null), 'packs/link')));
    await assertSucceeds(getDoc(doc(as(null), 'packs/pub')));
  });

  it('lists the public catalogue and your own packs, but never link-only packs', async () => {
    const packs = (uid: string | null) => collection(as(uid), 'packs');
    await assertSucceeds(getDocs(query(packs(null), where('visibility', '==', 'public'))));
    await assertSucceeds(getDocs(query(packs('ana'), where('ownerId', '==', 'ana'))));
    await assertFails(getDocs(query(packs('ivo'), where('visibility', '==', 'link'))));
    await assertFails(getDocs(query(packs('ivo'), where('ownerId', '==', 'ana'))));
    await assertFails(getDocs(packs('ivo')));
  });
});

describe('changing packs', () => {
  beforeEach(() => seed('mine', pack('ana')));

  it('lets the owner edit and delete', async () => {
    const ref = doc(as('ana'), 'packs/mine');
    await assertSucceeds(updateDoc(ref, { title: 'Нов', updatedAt: serverTimestamp() }));
    await assertSucceeds(deleteDoc(ref));
  });

  it('stops others from editing, deleting or taking the pack over', async () => {
    const ref = doc(as('ivo'), 'packs/mine');
    await assertFails(updateDoc(ref, { title: 'Хакнат', updatedAt: serverTimestamp() }));
    await assertFails(deleteDoc(ref));
    await assertFails(
      updateDoc(doc(as('ana'), 'packs/mine'), { ownerId: 'ivo', updatedAt: serverTimestamp() }),
    );
  });

  it('keeps the creation time', async () => {
    await assertFails(
      updateDoc(doc(as('ana'), 'packs/mine'), {
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }),
    );
  });
});

describe('reports', () => {
  const report = (uid: string) => ({
    packId: 'pub',
    uid,
    reason: 'Обидно съдържание',
    createdAt: serverTimestamp(),
  });

  it('can be sent by signed-in players in their own name', async () => {
    await assertSucceeds(setDoc(doc(as('ivo'), 'reports/r1'), report('ivo')));
    await assertFails(setDoc(doc(as('ivo'), 'reports/r2'), report('ana')));
    await assertFails(setDoc(doc(as(null), 'reports/r3'), report('ivo')));
  });

  it('cannot be read back by players', async () => {
    await assertSucceeds(setDoc(doc(as('ivo'), 'reports/r1'), report('ivo')));
    await assertFails(getDoc(doc(as('ivo'), 'reports/r1')));
  });
});

describe('admins', () => {
  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'admins/boss'), {});
    });
    await seed('secret', pack('ana'));
  });

  it('cannot be created by players', async () => {
    await assertFails(setDoc(doc(as('ivo'), 'admins/ivo'), {}));
  });

  it('lets a player check only their own admin entry', async () => {
    await assertSucceeds(getDoc(doc(as('boss'), 'admins/boss')));
    await assertSucceeds(getDoc(doc(as('ivo'), 'admins/ivo')));
    await assertFails(getDoc(doc(as('ivo'), 'admins/boss')));
  });

  it('can read private packs, delete any pack and read reports', async () => {
    await assertSucceeds(getDoc(doc(as('boss'), 'packs/secret')));
    await assertSucceeds(getDocs(collection(as('boss'), 'reports')));
    await assertFails(getDocs(collection(as('ivo'), 'reports')));
    await assertSucceeds(deleteDoc(doc(as('boss'), 'packs/secret')));
  });
});

describe('official questions', () => {
  const category = () => ({
    name: 'История',
    icon: 'landmark',
    order: 0,
    questions: [question(1)],
    updatedAt: serverTimestamp(),
  });

  beforeEach(() =>
    env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'admins/boss'), {});
    }),
  );

  it('are readable by anyone, even guests', async () => {
    await assertSucceeds(getDocs(collection(as(null), 'categories')));
    await assertSucceeds(getDoc(doc(as(null), 'meta/bank')));
  });

  it('can only be edited by admins', async () => {
    await assertSucceeds(setDoc(doc(as('boss'), 'categories/history'), category()));
    await assertSucceeds(setDoc(doc(as('boss'), 'meta/bank'), { updatedAt: serverTimestamp() }));
    await assertFails(setDoc(doc(as('ivo'), 'categories/history'), category()));
    await assertFails(setDoc(doc(as('ivo'), 'meta/bank'), { updatedAt: serverTimestamp() }));
  });

  it('rejects bad category ids and unknown fields', async () => {
    await assertFails(setDoc(doc(as('boss'), 'categories/Bad Id'), category()));
    await assertFails(setDoc(doc(as('boss'), 'categories/ok'), { ...category(), extra: 1 }));
  });
});

describe('player progress', () => {
  const progress = () => ({
    settings: {},
    stats: { gamesPlayed: 1 },
    hallOfFame: [],
    updatedAt: serverTimestamp(),
  });

  it('is private to the player', async () => {
    await assertSucceeds(setDoc(doc(as('ana'), 'users/ana'), progress()));
    await assertSucceeds(getDoc(doc(as('ana'), 'users/ana')));
    await assertFails(getDoc(doc(as('ivo'), 'users/ana')));
    await assertFails(setDoc(doc(as('ivo'), 'users/ana'), progress()));
  });
});

describe('leaderboard', () => {
  const score = (uid: string, prize: number, mode = 'normal') => ({
    uid,
    name: 'Ана',
    prize,
    mode,
    level: 10,
    updatedAt: serverTimestamp(),
  });

  it('accepts a real ladder amount under your own id', async () => {
    await assertSucceeds(setDoc(doc(as('ana'), 'leaderboard/ana_normal'), score('ana', 40000)));
    await assertSucceeds(getDocs(collection(as(null), 'leaderboard')));
  });

  it('rejects made-up amounts, other ids and other players', async () => {
    await assertFails(setDoc(doc(as('ana'), 'leaderboard/ana_normal'), score('ana', 12345)));
    await assertFails(setDoc(doc(as('ana'), 'leaderboard/ana_easy'), score('ana', 1000)));
    await assertFails(setDoc(doc(as('ana'), 'leaderboard/ivo_normal'), score('ivo', 1000)));
    await assertFails(setDoc(doc(as(null), 'leaderboard/ana_normal'), score('ana', 1000)));
  });

  it('only replaces a result with a better one', async () => {
    const ref = doc(as('ana'), 'leaderboard/ana_normal');
    await assertSucceeds(setDoc(ref, score('ana', 40000)));
    await assertFails(setDoc(ref, score('ana', 1000)));
    await assertSucceeds(setDoc(ref, score('ana', 75000)));
  });
});
