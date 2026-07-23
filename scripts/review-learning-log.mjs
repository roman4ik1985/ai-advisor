import { createReadStream } from 'node:fs';
import { access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const args = parseArgs(process.argv.slice(2));
const logPath = resolve(projectRoot, args.logPath || 'logs/ai-advisor-learning.log');

try {
  await access(logPath);
} catch {
  console.log(`No learning log found: ${logPath}`);
  process.exit(0);
}

const candidates = [];
const reader = createInterface({ input: createReadStream(logPath, 'utf8'), crlfDelay: Infinity });
for await (const line of reader) {
  if (!line.trim()) continue;
  try {
    const record = JSON.parse(line);
    if (record?.candidate?.status === 'pending') candidates.push(record);
  } catch {
    // A partial trailing line must not block review of earlier records.
  }
}

console.log(JSON.stringify({
  logPath,
  pendingCount: candidates.length,
  candidates: candidates.map((record) => ({
    timestamp: record.timestamp,
    requestId: record.requestId,
    reason: record.candidate.reason,
    question: record.question,
    answer: record.answer,
    knowledgeIds: record.knowledgeIds,
  })),
}, null, 2));

function parseArgs(values) {
  const result = { logPath: '' };
  for (const value of values) {
    if (value.startsWith('--log=')) result.logPath = value.slice('--log='.length);
  }
  return result;
}
