import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildProductSpecificationEvidence,
  mergeProductSpecificationEvidence,
} from '../product-specification-evidence.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const args = parseArgs(process.argv.slice(2));
if (!args.reviewedAt || !args.reviewer) {
  throw new Error('Use --reviewed-at=YYYY-MM-DD and --reviewer=<id>.');
}
const inputPath = resolve(root, args.input || 'data/ai-advisor-public-catalog-dry-run.json');
const outputPath = resolve(root, args.output || 'knowledge/product-specifications.json');
const dataset = JSON.parse(await readFile(inputPath, 'utf8'));
const candidates = (Array.isArray(dataset.products) ? dataset.products : [])
  .map((product) => buildProductSpecificationEvidence(product, {
    reviewedAt: args.reviewedAt,
    reviewer: args.reviewer,
  }))
  .filter(Boolean);
const current = await optionalJson(outputPath);
const merged = mergeProductSpecificationEvidence(current, candidates);

if (args.apply) {
  await mkdir(dirname(outputPath), { recursive: true });
  const tempPath = `${outputPath}.${process.pid}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(merged, null, 2)}\n`, 'utf8');
  await rename(tempPath, outputPath);
}
console.log(JSON.stringify({
  mode: args.apply ? 'applied' : 'preview',
  inputPath,
  outputPath,
  capturedAt: dataset.collection?.capturedAt || null,
  candidateCount: candidates.length,
  evidenceCount: merged.length,
  commercialFactsPromoted: false,
}, null, 2));

function parseArgs(values) {
  const result = { apply: false };
  for (const item of values) {
    if (item === '--apply') result.apply = true;
    else if (item.startsWith('--')) {
      const [key, ...rest] = item.slice(2).split('=');
      result[key.replace(/-([a-z])/gu, (_, letter) => letter.toUpperCase())] = rest.join('=');
    }
  }
  return result;
}

async function optionalJson(path) {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
