import { searchKnowledge } from '../src/knowledge.mjs';

const query = process.argv.slice(2).join(' ').trim();

if (!query) {
  console.error('Usage: npm run knowledge:find -- "question text"');
  process.exit(1);
}

const matches = await searchKnowledge({
  messages: [{ role: 'user', content: query }],
  page: {},
});

if (matches.length === 0) {
  console.log('No knowledge matches found.');
  process.exit(0);
}

for (const match of matches) {
  console.log([
    match.id,
    match.title,
    match.reviewedAt,
    match.sourceUrl,
    match.keywords.join(', '),
  ].join(' | '));
}
