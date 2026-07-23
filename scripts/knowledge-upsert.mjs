import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { previewKnowledgeUpsert, upsertKnowledgeEntry } from '../src/knowledge-workflow.mjs';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const defaultKnowledgePath = resolve(projectRoot, 'knowledge', 'store-faq.json');
const args = parseArgs(process.argv.slice(2));

if (args.help) {
  printUsage();
  process.exit(0);
}

if (!args.entryPath) {
  printUsage();
  process.exit(1);
}

const knowledgePath = resolve(args.knowledgePath || defaultKnowledgePath);
const entryPath = resolve(args.entryPath);
const rawEntry = await readFile(entryPath, 'utf8');
const candidate = JSON.parse(rawEntry);

if (!candidate || Array.isArray(candidate) || typeof candidate !== 'object') {
  throw new Error('Entry file must contain a single JSON object.');
}

if (!args.apply) {
  const currentEntries = JSON.parse(await readFile(knowledgePath, 'utf8'));
  const preview = previewKnowledgeUpsert(currentEntries, candidate, args.mode);
  console.log(`Dry run: ${knowledgePath}`);
  console.log(`Action: ${preview.action}`);
  console.log(`Entry id: ${preview.entry.id}`);
  console.log(`Before: ${preview.beforeCount}`);
  console.log(`After: ${preview.afterCount}`);
  process.exit(0);
}

const result = await upsertKnowledgeEntry(knowledgePath, candidate, {
  mode: args.mode,
  backup: args.backup,
});

console.log(`Knowledge entry saved to ${knowledgePath}`);
if (result.backupPath) {
  console.log(`Backup created at ${result.backupPath}`);
}
console.log(`Total entries: ${result.count}`);

function parseArgs(argv) {
  const result = {
    mode: 'upsert',
    backup: true,
    knowledgePath: '',
    entryPath: '',
    help: false,
    apply: false,
  };

  for (const item of argv) {
    if (item === '--help' || item === '-h') {
      result.help = true;
      continue;
    }
    if (item.startsWith('--mode=')) {
      result.mode = item.split('=')[1] || 'upsert';
      continue;
    }
    if (item.startsWith('--knowledge=')) {
      result.knowledgePath = item.split('=')[1] || '';
      continue;
    }
    if (item === '--no-backup') {
      result.backup = false;
      continue;
    }
    if (item === '--apply') {
      result.apply = true;
      continue;
    }
    if (!item.startsWith('--') && !result.entryPath) {
      result.entryPath = item;
    }
  }

  if (!['add', 'upsert'].includes(result.mode)) {
    throw new Error(`Unsupported mode: ${result.mode}. Use add or upsert.`);
  }

  return result;
}

function printUsage() {
  console.log('Usage: npm run knowledge:upsert -- [--apply] [--mode=add|upsert] [--knowledge=path] path/to/entry.json');
  console.log('Options:');
  console.log('  --mode=add|upsert   add rejects duplicates, upsert replaces by id');
  console.log('  --knowledge=path    target knowledge file, defaults to knowledge/store-faq.json');
  console.log('  --no-backup         skip creating a backup copy before writing');
  console.log('  --apply             write changes to disk; otherwise run a dry run');
  console.log('  --help, -h          show this help');
}
