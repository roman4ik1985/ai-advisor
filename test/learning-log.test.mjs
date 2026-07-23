import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendLearningRecord, buildLearningRecord } from '../src/learning-log.mjs';

test('learning records redact personal data and queue uncovered questions for review', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'ai-advisor-learning-'));
  const logPath = join(directory, 'ai-advisor-learning.log');
  context.after(() => rm(directory, { recursive: true, force: true }));

  const record = await appendLearningRecord(logPath, {
    requestId: 'request-1',
    provider: 'test',
    messages: [
      { role: 'assistant', content: 'Earlier reply that must not be saved.' },
      { role: 'user', content: 'Напишите на client@example.com или +38 (067) 123-45-67' },
    ],
    answer: 'Менеджер уточнит детали для client@example.com.',
    knowledge: [],
    catalogDiagnostics: { code: 'EMPTY_RESULTS' },
  }, { now: () => new Date('2026-07-23T22:40:00.000Z') });

  assert.equal(record.candidate?.status, 'pending');
  assert.equal(record.candidate?.reason, 'no-knowledge-match');
  assert.match(record.question, /redacted-email/);
  assert.match(record.question, /redacted-phone/);
  assert.match(record.answer, /redacted-email/);
  assert.doesNotMatch(record.question, /Earlier reply/);
  const saved = await readFile(logPath, 'utf8');
  assert.equal(JSON.parse(saved).requestId, 'request-1');
});

test('learning records do not queue covered answers without a follow-up signal', () => {
  const record = buildLearningRecord({
    requestId: 'request-2',
    provider: 'test',
    messages: [{ role: 'user', content: 'Как выбрать экран?' }],
    answer: 'Учитывайте размер комнаты и диагональ.',
    knowledge: [{ id: 'screen-selection' }],
    catalogDiagnostics: { code: 'OK' },
  });

  assert.equal(record.candidate, null);
  assert.deepEqual(record.knowledgeIds, ['screen-selection']);
});
