import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('P3 operations cannot auto-publish knowledge or promote commercial facts', async () => {
  const [coverage, review, specifications, reviewScript, ingestScript] = await Promise.all([
    readFile(new URL('../knowledge-coverage.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../learning-review.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../product-specification-evidence.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../scripts/review-learning-log.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../scripts/product-specification-ingest.mjs', import.meta.url), 'utf8'),
  ]);
  assert.match(coverage, /mutationAllowed:\s*false/u);
  assert.match(review, /mutatesKnowledge:\s*false/u);
  assert.doesNotMatch(`${coverage}\n${review}\n${reviewScript}`, /store-faq\.json.*write|upsertKnowledgeEntry/iu);
  assert.match(specifications, /COMMERCIAL_FIELD/u);
  assert.match(ingestScript, /commercialFactsPromoted:\s*false/u);
  assert.doesNotMatch(`${coverage}\n${review}\n${specifications}`, /OPENAI_API_KEY|askViaApi|DELETE\s+FROM|UPDATE\s+/u);
});
