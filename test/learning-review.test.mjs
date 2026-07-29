import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLearningReviewQueue,
  createLearningReviewDecision,
  parseLearningDecisions,
  parseLearningRecords,
} from '../learning-review.mjs';

test('C32 parses partial logs and overlays the latest explicit review decision', () => {
  const records = parseLearningRecords([
    JSON.stringify({
      requestId: 'req-1',
      timestamp: '2026-07-29T10:00:00Z',
      question: 'Question',
      answer: 'Answer',
      candidate: { status: 'pending', reason: 'no-knowledge-match' },
    }),
    '{broken',
  ].join('\n'));
  const decisions = parseLearningDecisions(JSON.stringify({
    type: 'ai-advisor-learning-review-decision',
    requestId: 'req-1',
    action: 'DEFER',
  }));
  const queue = buildLearningReviewQueue(records, decisions);
  assert.equal(queue.length, 1);
  assert.equal(queue[0].status, 'DEFER');
});

test('DRAFT requires an official source and never mutates knowledge', () => {
  assert.throws(() => createLearningReviewDecision({
    requestId: 'req-1',
    action: 'DRAFT',
    reviewer: 'operator',
    sourceUrl: 'https://example.com/fake',
  }), /official/u);
  const decision = createLearningReviewDecision({
    requestId: 'req-1',
    action: 'DRAFT',
    reviewer: 'operator',
    sourceUrl: 'https://ledprojector.com.ua/garantiya#details',
    now: () => new Date('2026-07-29T12:00:00Z'),
  });
  assert.equal(decision.sourceUrl, 'https://ledprojector.com.ua/garantiya');
  assert.equal(decision.mutatesKnowledge, false);
});

test('review actions are closed to the explicit three-state set', () => {
  assert.throws(() => createLearningReviewDecision({
    requestId: 'req-1',
    action: 'APPROVE_AND_PUBLISH',
    reviewer: 'operator',
  }), /DEFER\/DISMISS\/DRAFT/u);
});
