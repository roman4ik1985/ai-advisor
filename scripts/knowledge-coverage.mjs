import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildKnowledgeCoverage } from '../knowledge-coverage.mjs';
import { parseLearningDecisions, parseLearningRecords } from '../learning-review.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).map((item) => {
  const [key, ...rest] = item.replace(/^--/u, '').split('=');
  return [key, rest.join('=')];
}));
const knowledge = JSON.parse(await readFile(resolve(root, args.knowledge || 'knowledge/store-faq.json'), 'utf8'));
const learning = await optionalRead(resolve(root, args.log || 'logs/ai-advisor-learning.log'));
const decisions = await optionalRead(resolve(root, args.ledger || 'data/learning-review-decisions.jsonl'));
console.log(JSON.stringify(buildKnowledgeCoverage({
  entries: knowledge,
  learningRecords: parseLearningRecords(learning),
  decisions: parseLearningDecisions(decisions),
}), null, 2));

async function optionalRead(path) {
  try { return await readFile(path, 'utf8'); } catch { return ''; }
}
