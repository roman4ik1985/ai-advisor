import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runQualityBenchmark } from '../quality-benchmark.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const scenarioPath = process.argv.find((item) => item.startsWith('--scenarios='))?.split('=')[1]
  || 'test/fixtures/p4-quality-scenarios.json';
const scenarios = JSON.parse(await readFile(resolve(root, scenarioPath), 'utf8'));
const report = runQualityBenchmark(scenarios);
console.log(JSON.stringify(report, null, 2));
if (report.status !== 'PASS') process.exitCode = 1;
