import { runBrowserProbe } from '../production-browser-probe.mjs';
import { runProductionMonitor } from '../production-widget-monitor.mjs';

const httpOnly = process.argv.includes('--http-only');
const browserExecutable = process.argv
  .find((item) => item.startsWith('--browser='))
  ?.slice('--browser='.length) || '';
const timeoutMs = Number(process.argv
  .find((item) => item.startsWith('--timeout-ms='))
  ?.slice('--timeout-ms='.length) || 30_000);

const report = await runProductionMonitor({
  timeoutMs,
  browserProbe: httpOnly
    ? undefined
    : (options) => runBrowserProbe({ ...options, browserExecutable }),
});
console.log(JSON.stringify(report, null, 2));
if (report.status !== 'PASS') process.exitCode = 1;
