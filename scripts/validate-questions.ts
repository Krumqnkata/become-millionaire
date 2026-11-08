/**
 * Validates every question file listed in public/questions/manifest.json.
 *
 *   npm run validate
 *
 * Runs in CI, so a broken question never reaches the live site.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkQuestionBank } from './check-bank.ts';

const root = resolve(fileURLToPath(import.meta.url), '../../public/questions');
const readJson = (file: string): unknown => JSON.parse(readFileSync(resolve(root, file), 'utf8'));

const report = checkQuestionBank(readJson);

for (const warning of report.warnings) console.log(`  ⚠  ${warning}`);
for (const error of report.errors) console.log(`  ✖  ${error}`);

console.log('\n📚 Въпроси по категории:');
for (const [category, count] of Object.entries(report.perCategory))
  console.log(`   ${category.padEnd(24)} ${count}`);
console.log('\n📈 Въпроси по трудност:');
for (const [difficulty, count] of Object.entries(report.perDifficulty))
  console.log(`   ${'★'.repeat(Number(difficulty)).padEnd(6)} ${count}`);
console.log(`\n   Общо: ${report.total}\n`);

if (report.errors.length > 0) {
  const n = report.errors.length;
  console.log(`❌ ${n} ${n === 1 ? 'грешка' : 'грешки'}. Поправи и пусни отново.`);
  process.exit(1);
}
console.log('✅ Всички въпроси са валидни.');
