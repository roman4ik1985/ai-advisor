import { readFile } from 'node:fs/promises';
import { validateKnowledgeEntries } from './knowledge-validation.mjs';

const knowledgeUrl = new URL('../knowledge/store-faq.json', import.meta.url);
const MAX_RESULTS = 4;

export async function searchKnowledge({ messages, page }, limit = MAX_RESULTS) {
  const entries = await loadKnowledge();
  const query = buildQuery(messages, page);
  if (!query) return [];

  const ranked = entries
    .map((entry) => ({ ...entry, ...scoreEntry(entry, query) }));
  const hasIntentMatch = ranked.some((entry) => entry.keywordScore > 0);

  return ranked
    .filter((entry) => entry.score > 0 && (!hasIntentMatch || entry.keywordScore > 0))
    .sort((left, right) => right.score - left.score)
    .slice(0, Math.max(1, Math.min(limit, MAX_RESULTS)))
    .map(({ score, keywordScore, ...entry }) => entry);
}

async function loadKnowledge() {
  const raw = await readFile(knowledgeUrl, 'utf8');
  const parsed = JSON.parse(raw);
  return validateKnowledgeEntries(parsed);
}

function buildQuery(messages, page) {
  const latestQuestion = [...(Array.isArray(messages) ? messages : [])]
    .reverse()
    .find((item) => item?.role === 'user')?.content || '';
  return tokenize(`${latestQuestion} ${page?.title || ''} ${page?.visibleText || ''}`);
}

function scoreEntry(entry, query) {
  const haystack = new Set(tokenize(`${entry.title} ${entry.text} ${entry.keywords.join(' ')}`));
  const queryTokens = new Set(query);
  const contentHits = query.reduce((score, token) => score + (haystack.has(token) ? 1 : 0), 0);
  const keywordScore = entry.keywords.reduce((score, keyword) => {
    const keywordTokens = tokenize(keyword);
    if (!keywordTokens.length || !keywordTokens.every((token) => queryTokens.has(token))) {
      return score;
    }

    // A complete keyword phrase identifies intent more reliably than a common word in card text.
    return score + 8 + keywordTokens.length * 2;
  }, 0);

  // Do not return cards that only share one generic word such as "проектор".
  return {
    keywordScore,
    score: keywordScore > 0 ? keywordScore + contentHits : contentHits >= 2 ? contentHits : 0,
  };
}

function tokenize(value) {
  // Keep compact technical terms such as 4K and HD intact for phrase matching.
  return [...new Set(normalize(value).split(/[^a-zа-яіїєґ0-9]+/u).filter((token) => token.length >= 2))];
}

function normalize(value) {
  return String(value || '').toLowerCase().replace(/ё/g, 'е');
}
