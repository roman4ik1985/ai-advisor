import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { evaluateSlo } from '../readiness-slo.mjs';

const samplePath = process.argv.find((item) => item.startsWith('--samples='))?.split('=')[1];
const samples = samplePath ? JSON.parse(await readFile(resolve(samplePath), 'utf8')) : [];
const report = evaluateSlo(samples);
console.log(JSON.stringify(report, null, 2));
if (report.status === 'BREACHED') process.exitCode = 1;
