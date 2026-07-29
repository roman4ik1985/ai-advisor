import { appendFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildLearningReviewQueue,
  createLearningReviewDecision,
  parseLearningDecisions,
  parseLearningRecords,
} from '../learning-review.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const args = parseArgs(process.argv.slice(2));
const logPath = resolve(root, args.log || 'logs/ai-advisor-learning.log');
const ledgerPath = resolve(root, args.ledger || 'data/learning-review-decisions.jsonl');
const records = parseLearningRecords(await optionalRead(logPath));
const decisions = parseLearningDecisions(await optionalRead(ledgerPath));

if (args.action) {
  const decision = createLearningReviewDecision({
    requestId: args.requestId,
    action: args.action,
    note: args.note,
    sourceUrl: args.sourceUrl,
    reviewer: args.reviewer,
  });
  if (args.apply) await appendFile(ledgerPath, `${JSON.stringify(decision)}\n`, 'utf8');
  console.log(JSON.stringify({ mode: args.apply ? 'applied' : 'preview', ledgerPath, decision }, null, 2));
} else {
  const queue = buildLearningReviewQueue(records, decisions);
  console.log(JSON.stringify({
    logPath,
    ledgerPath,
    pendingCount: queue.filter((item) => item.status === 'PENDING' || item.status === 'DEFER').length,
    candidates: queue,
  }, null, 2));
}

function parseArgs(values) {
  const result = { apply: false };
  for (const item of values) {
    if (item === '--apply') result.apply = true;
    else if (item.startsWith('--')) {
      const [key, ...rest] = item.slice(2).split('=');
      result[key.replace(/-([a-z])/gu, (_, letter) => letter.toUpperCase())] = rest.join('=');
    }
  }
  return result;
}

async function optionalRead(path) {
  try { return await readFile(path, 'utf8'); } catch { return ''; }
}
