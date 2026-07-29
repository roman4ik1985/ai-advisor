import test from 'node:test';
import assert from 'node:assert/strict';
import { buildKnowledgeCoverage } from '../knowledge-coverage.mjs';

test('C31 reports official coverage, staleness, and unresolved gaps without mutation', () => {
  const report = buildKnowledgeCoverage({
    entries: [
      {
        id: 'delivery',
        keywords: ['доставка', 'Нова пошта'],
        sourceUrl: 'https://ledprojector.com.ua/dostavka',
        reviewedAt: '2026-07-20',
      },
      {
        id: 'old',
        keywords: ['доставка'],
        sourceUrl: 'https://ledprojector.com.ua/dostavka',
        reviewedAt: '2025-01-01',
      },
    ],
    learningRecords: [{
      requestId: 'req-1',
      question: 'Чи є самовивіз?',
      candidate: { status: 'pending', reason: 'no-knowledge-match' },
    }],
    now: () => new Date('2026-07-29T12:00:00Z'),
  });
  assert.deepEqual(report.summary, {
    knowledgeEntries: 2,
    officialSources: 1,
    staleEntries: 1,
    pendingGaps: 1,
  });
  assert.deepEqual(report.staleEntryIds, ['old']);
  assert.equal(report.repeatedSources[0].entryCount, 2);
  assert.equal(report.gaps[0].recommendedAction, 'REVIEW_OFFICIAL_SOURCE');
  assert.equal(report.mutationAllowed, false);
});

test('resolved draft and dismissed records are removed from active coverage gaps', () => {
  const records = [
    { requestId: 'a', candidate: { status: 'pending' } },
    { requestId: 'b', candidate: { status: 'pending' } },
  ];
  const report = buildKnowledgeCoverage({
    learningRecords: records,
    decisions: [
      { requestId: 'a', action: 'DRAFT' },
      { requestId: 'b', action: 'DISMISS' },
    ],
  });
  assert.equal(report.summary.pendingGaps, 0);
});
