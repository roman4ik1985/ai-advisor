import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assessPerformanceBudget } from '../performance-budget.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const vitalsPath = process.argv.find((item) => item.startsWith('--vitals='))?.split('=')[1];
const [widgetJs, widgetCss] = await Promise.all([
  stat(resolve(root, 'public/widget.js')),
  stat(resolve(root, 'public/widget.css')),
]);
const webVitals = vitalsPath ? JSON.parse(await readFile(resolve(root, vitalsPath), 'utf8')) : null;
const report = assessPerformanceBudget({
  assets: { widgetJsBytes: widgetJs.size, widgetCssBytes: widgetCss.size },
  webVitals,
});
console.log(JSON.stringify(report, null, 2));
if (report.status !== 'PASS') process.exitCode = 1;
