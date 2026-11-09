/**
 * Downloads the official questions from Firestore into public/questions/*.json.
 *
 * The questions are edited in the admin panel; this keeps the copy in the repository
 * up to date, which the site falls back to and `npm run voice` records from.
 *
 *   npm run questions:pull
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { bankFromDocuments } from '../src/cloud/bank.ts';

function env(name: string): string {
  if (process.env[name]) return process.env[name]!;
  if (existsSync('.env.local')) {
    const line = readFileSync('.env.local', 'utf8')
      .split(/\r?\n/)
      .find((l) => l.startsWith(`${name}=`));
    if (line) return line.slice(name.length + 1).trim();
  }
  return '';
}

const projectId = env('VITE_FIREBASE_PROJECT_ID');
const apiKey = env('VITE_FIREBASE_API_KEY');
if (!projectId) {
  console.error('Липсва VITE_FIREBASE_PROJECT_ID (в .env.local).');
  process.exit(1);
}

const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/categories?pageSize=300${apiKey ? `&key=${apiKey}` : ''}`;
const res = await fetch(url);
if (!res.ok) {
  console.error(`Firestore отговори с ${res.status}: ${await res.text()}`);
  process.exit(1);
}
const { documents = [] } = (await res.json()) as {
  documents?: { name: string; fields?: Record<string, Record<string, unknown>> }[];
};
const bank = bankFromDocuments(documents);
if (!bank) {
  console.error('В базата още няма въпроси (качи ги от администрацията).');
  process.exit(1);
}

const manifest = { categories: bank.categories.map((c) => ({ ...c, file: `${c.id}.json` })) };
for (const c of manifest.categories) {
  const questions = bank.questions
    .filter((q) => q.category === c.id)
    .map(({ category: _c, ...q }) => q);
  const file = {
    $schema: '../../schema/questions.schema.json',
    category: c.id,
    name: c.name,
    questions,
  };
  writeFileSync(`public/questions/${c.file}`, `${JSON.stringify(file, null, 2)}\n`);
  console.log(`${c.file}: ${questions.length} въпроса`);
}
writeFileSync('public/questions/manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Общо ${bank.questions.length} въпроса. Провери с npm run validate и git diff.`);
