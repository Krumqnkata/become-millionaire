import { validateQuestionFile, type QuestionBank } from '../game/questions.ts';
import type { CategoryMeta, CategorizedQuestion } from '../game/types.ts';
import { firebaseSettings, useEmulators } from './config.ts';

/**
 * The official questions live in Firestore (`categories/*`), edited from the admin panel.
 * They are read over Firestore's REST API, so the game starts without the Firebase SDK,
 * and cached in the browser: a visit costs one small read (`meta/bank`) unless an admin
 * changed something since the last one.
 *
 * Returns `null` when the database has no questions yet; the app then uses the JSON
 * files shipped with the site.
 */

const CACHE_KEY = 'ptm:v1:bank';
const TIMEOUT_MS = 5000;

type Value = Record<string, unknown>;

/** Firestore REST values ({ stringValue: "…" }, { arrayValue: { values: [...] } }, …) → plain JSON. */
export function decodeValue(value: Value): unknown {
  if ('stringValue' in value) return value.stringValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return Number(value.doubleValue);
  if ('booleanValue' in value) return value.booleanValue;
  if ('timestampValue' in value) return value.timestampValue;
  if ('nullValue' in value) return null;
  if ('arrayValue' in value) {
    const values = (value.arrayValue as { values?: Value[] }).values ?? [];
    return values.map(decodeValue);
  }
  if ('mapValue' in value)
    return decodeFields((value.mapValue as { fields?: Record<string, Value> }).fields);
  return undefined;
}

export const decodeFields = (fields: Record<string, Value> | undefined): Record<string, unknown> =>
  Object.fromEntries(Object.entries(fields ?? {}).map(([k, v]) => [k, decodeValue(v)]));

interface RestDocument {
  name: string;
  fields?: Record<string, Value>;
}

/** Turns the category documents into a question bank, dropping anything invalid. */
export function bankFromDocuments(docs: RestDocument[]): QuestionBank | null {
  const categories: (CategoryMeta & { order: number })[] = [];
  const questions: CategorizedQuestion[] = [];
  for (const d of docs) {
    const id = d.name.split('/').pop() ?? '';
    const data = decodeFields(d.fields);
    const file = validateQuestionFile(
      { category: id, name: data.name, questions: data.questions },
      `categories/${id}`,
    );
    file.errors.forEach((e) => console.warn(e));
    if (!file.value || file.value.questions.length === 0) continue;
    categories.push({
      id,
      name: file.value.name,
      icon: typeof data.icon === 'string' ? data.icon : 'circle-help',
      file: '',
      order: typeof data.order === 'number' ? data.order : 0,
    });
    for (const q of file.value.questions) questions.push({ ...q, category: id });
  }
  if (questions.length === 0) return null;
  categories.sort((a, b) => a.order - b.order);
  return { categories: categories.map(({ order: _order, ...meta }) => meta), questions };
}

function restBase(): string | null {
  if (!firebaseSettings) return null;
  const host = useEmulators ? 'http://127.0.0.1:8080' : 'https://firestore.googleapis.com';
  return `${host}/v1/projects/${firebaseSettings.projectId}/databases/(default)/documents`;
}

async function getJson(url: string): Promise<unknown> {
  const key = firebaseSettings?.apiKey;
  const withKey = useEmulators || !key ? url : `${url}${url.includes('?') ? '&' : '?'}key=${key}`;
  const res = await fetch(withKey, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Firestore ${res.status}`);
  return res.json();
}

interface CachedBank {
  version: string;
  bank: QuestionBank;
}

function readCache(): CachedBank | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as CachedBank) : null;
  } catch {
    return null;
  }
}

function writeCache(value: CachedBank): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(value));
  } catch {
    /* full or blocked: the next visit just downloads again */
  }
}

export async function loadCloudBank(): Promise<QuestionBank | null> {
  const base = restBase();
  if (!base) return null;

  const cached = readCache();
  let meta: unknown;
  try {
    meta = await getJson(`${base}/meta/bank`);
  } catch (error) {
    // Offline or slow: last known questions are better than none.
    if (cached) return cached.bank;
    throw error;
  }
  if (!meta) return null; // nothing uploaded yet

  const version = String(decodeFields((meta as RestDocument).fields).updatedAt ?? '');
  if (cached && cached.version === version && cached.bank.questions.length > 0) return cached.bank;

  const list = (await getJson(`${base}/categories?pageSize=300`)) as {
    documents?: RestDocument[];
  } | null;
  const bank = bankFromDocuments(list?.documents ?? []);
  if (bank) writeCache({ version, bank });
  return bank;
}

/** Forgets the cached questions (after an admin saves, so they see the change at once). */
export function clearBankCache(): void {
  try {
    localStorage.removeItem(CACHE_KEY);
  } catch {
    /* ignore */
  }
}
