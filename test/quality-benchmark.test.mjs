import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runQualityBenchmark } from '../quality-benchmark.mjs';

test('C44 benchmark locks the bilingual route corpus and model-call ceiling', async () => {
  const scenarios = JSON.parse(await readFile(
    new URL('./fixtures/p4-quality-scenarios.json', import.meta.url),
    'utf8',
  ));
  const report = runQualityBenchmark(scenarios);
  assert.equal(report.status, 'PASS');
  assert.equal(report.scenarioCount, 12);
  assert.equal(report.failed, 0);
  assert.equal(report.totalModelCallBudget <= 13, true);
});

test('quality benchmark identifies a route regression', () => {
  const report = runQualityBenchmark([{
    id: 'wrong',
    question: 'Нужен менеджер',
    expected: { intent: 'store_faq', route: 'SIMPLE', resolvers: ['knowledge'] },
  }]);
  assert.equal(report.status, 'FAIL');
  assert.equal(report.failed, 1);
});
