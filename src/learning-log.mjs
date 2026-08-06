import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const MAX_TEXT_LENGTH = 1200;
const FOLLOW_UP_RE = /менеджер|уточн(?:ить|ите)|не мож[уы]|немає даних|не має даних|підтверд/iu;
const LIVE_FACT_RE = /(?:ц[іе]н|стоимост|кошту|наявност|наличи|в наличии|есть ли|способ\w*.{0,24}(?:оплат|достав)|(?:оплат|достав)\w*.{0,24}способ|достав\w*.{0,24}(?:завтра|сьогодні|сегодня)|(?:строк|срок)\w*.{0,24}достав)/iu;

export async function appendLearningRecord(logPath, input, { now = () => new Date() } = {}) {
  const record = buildLearningRecord(input, { now });
  await mkdir(dirname(logPath), { recursive: true });
  await appendFile(logPath, `${JSON.stringify(record)}\n`, 'utf8');
  return record;
}

export function buildLearningRecord({ requestId, messages, answer, knowledge, catalogDiagnostics, provider }, { now = () => new Date() } = {}) {
  const question = redactText(latestUserMessage(messages));
  const safeAnswer = redactText(answer);
  const knowledgeIds = Array.isArray(knowledge)
    ? knowledge.map((entry) => String(entry?.id || '')).filter(Boolean).slice(0, 4)
    : [];
  const reason = learningReason({ question, answer: safeAnswer, knowledgeIds });

  return {
    type: 'ai-advisor-learning-record',
    version: 1,
    timestamp: now().toISOString(),
    requestId: String(requestId || '').slice(0, 80),
    provider: String(provider || '').slice(0, 24),
    question,
    answer: safeAnswer,
    knowledgeIds,
    catalogCode: String(catalogDiagnostics?.code || '').slice(0, 80),
    candidate: reason ? { status: 'pending', reason } : null,
  };
}

export function redactText(value) {
  return String(value || '')
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/giu, '[redacted-email]')
    .replace(/(?:\+?\d[\d\s().-]{7,}\d)/gu, '[redacted-phone]')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, MAX_TEXT_LENGTH);
}

function latestUserMessage(messages) {
  return [...(Array.isArray(messages) ? messages : [])]
    .reverse()
    .find((message) => message?.role === 'user')?.content || '';
}

function learningReason({ question, answer, knowledgeIds }) {
  if (!question || !answer) return 'incomplete-record';
  if (LIVE_FACT_RE.test(question)) {
    return FOLLOW_UP_RE.test(answer) ? 'live-evidence-unavailable' : '';
  }
  if (knowledgeIds.length === 0) return 'no-knowledge-match';
  return FOLLOW_UP_RE.test(answer) ? 'needs-manager-review' : '';
}
