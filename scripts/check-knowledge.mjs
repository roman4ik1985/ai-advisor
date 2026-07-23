import { readFile } from 'node:fs/promises';
import { validateKnowledgeEntries } from '../src/knowledge-validation.mjs';

const knowledgeUrl = new URL('../knowledge/store-faq.json', import.meta.url);

try {
  const raw = await readFile(knowledgeUrl, 'utf8');
  const entries = JSON.parse(raw);
  const normalized = validateKnowledgeEntries(entries);
  console.log(`Knowledge base OK: ${normalized.length} entries`);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
