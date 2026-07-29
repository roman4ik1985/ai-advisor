import { readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { retainProductAnalytics } from '../product-analytics.mjs';

const path = resolve(process.argv.find((item) => item.startsWith('--path='))?.split('=')[1]
  || 'logs/product-analytics.jsonl');
let text = '';
try { text = await readFile(path, 'utf8'); } catch {}
const result = retainProductAnalytics(text);
const temporary = `${path}.${process.pid}.tmp`;
await writeFile(temporary, result.retained.map(JSON.stringify).join('\n') + (result.retained.length ? '\n' : ''), 'utf8');
await rename(temporary, path);
console.log(JSON.stringify({ path, retained: result.retained.length, dropped: result.dropped }, null, 2));
