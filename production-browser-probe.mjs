import { access, mkdtemp, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { PRODUCTION_WIDGET_ROUTES } from './production-widget-monitor.mjs';

export const DEFAULT_BROWSER_PATHS = Object.freeze([
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
]);

export function parseDevToolsEndpoint(text) {
  return String(text || '').match(/DevTools listening on (ws:\/\/[^\s]+)/u)?.[1] || '';
}

export function assessBrowserProbe({
  routes = [],
  mobile = null,
  errors = [],
  expectedRoutes = PRODUCTION_WIDGET_ROUTES,
} = {}) {
  const violations = [];
  if (routes.length !== expectedRoutes.length) violations.push('ROUTE_COVERAGE_INCOMPLETE');
  for (const route of routes) {
    if (!route.mounted || !route.loaded || route.rootCount !== 1) {
      violations.push(`MOUNT:${route.route}`);
    }
  }
  if (!mobile?.mounted || !mobile?.interaction?.focusContract) violations.push('MOBILE_INTERACTION');
  if (errors.length) violations.push('BROWSER_ERRORS');
  return Object.freeze({
    status: violations.length ? 'FAIL' : 'PASS',
    routes: Object.freeze(routes),
    mobile,
    errors: Object.freeze(errors),
    violations: Object.freeze(violations),
  });
}

export async function resolveBrowserExecutable(explicitPath = '') {
  const candidates = [explicitPath, process.env.AI_ADVISOR_BROWSER_EXECUTABLE, ...DEFAULT_BROWSER_PATHS]
    .filter(Boolean);
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Continue through the fixed allow-list.
    }
  }
  throw new Error('Chrome or Edge executable was not found');
}

export async function runBrowserProbe({
  baseUrl = 'https://ledprojector.com.ua/',
  routes = PRODUCTION_WIDGET_ROUTES,
  timeoutMs = 30_000,
  browserExecutable = '',
} = {}) {
  const base = new URL(baseUrl);
  if (base.protocol !== 'https:' || base.hostname !== 'ledprojector.com.ua') {
    throw new Error('Browser probe is restricted to https://ledprojector.com.ua');
  }
  const executable = await resolveBrowserExecutable(browserExecutable);
  const profileDir = await mkdtemp(join(tmpdir(), 'ai-advisor-p6-browser-'));
  const child = spawn(executable, [
    '--headless=new',
    '--disable-gpu',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-default-apps',
    '--disable-extensions',
    '--no-default-browser-check',
    '--no-first-run',
    '--remote-debugging-port=0',
    `--user-data-dir=${profileDir}`,
    'about:blank',
  ], {
    windowsHide: true,
    stdio: ['ignore', 'ignore', 'pipe'],
  });

  let client;
  try {
    const endpoint = await waitForDevToolsEndpoint(child, timeoutMs);
    client = await CdpClient.connect(endpoint, timeoutMs);
    const { targetId } = await client.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await client.send('Target.attachToTarget', { targetId, flatten: true });
    await Promise.all([
      client.send('Page.enable', {}, sessionId),
      client.send('Runtime.enable', {}, sessionId),
      client.send('Log.enable', {}, sessionId),
      client.send('Network.enable', {}, sessionId),
    ]);
    await client.send('Page.addScriptToEvaluateOnNewDocument', {
      source: vitalsBootstrapSource(),
    }, sessionId);

    const errors = [];
    client.onEvent((event) => {
      if (event.sessionId !== sessionId) return;
      if (event.method === 'Runtime.exceptionThrown') {
        errors.push('RUNTIME_EXCEPTION');
      } else if (event.method === 'Log.entryAdded' && event.params?.entry?.level === 'error') {
        errors.push('LOG_ERROR');
      } else if (event.method === 'Network.loadingFailed' && !event.params?.canceled) {
        errors.push('NETWORK_FAILURE');
      }
    });

    await client.send('Emulation.setDeviceMetricsOverride', {
      width: 1280,
      height: 720,
      deviceScaleFactor: 1,
      mobile: false,
    }, sessionId);
    const routeReports = [];
    for (const route of routes) {
      const url = new URL(route, base).toString();
      await navigateAndWait(client, sessionId, url, timeoutMs);
      const state = await evaluate(client, sessionId, `({
        rootCount: document.querySelectorAll('.lp-agent-root').length,
        loaded: window.__ledProjectorAgentLoaded === true,
        title: document.title,
        finalUrl: location.href
      })`);
      routeReports.push(Object.freeze({
        route,
        url,
        finalUrl: state.finalUrl,
        title: state.title,
        rootCount: state.rootCount,
        loaded: state.loaded,
        mounted: state.rootCount === 1 && state.loaded,
      }));
    }

    await client.send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      screenWidth: 390,
      screenHeight: 844,
      deviceScaleFactor: 1,
      mobile: true,
    }, sessionId);
    await navigateAndWait(client, sessionId, new URL('/', base).toString(), timeoutMs);
    await delay(1_500);
    const interaction = await runInteraction(client, sessionId);
    await delay(500);
    const mobileState = await evaluate(client, sessionId, `(() => {
      const nav = performance.getEntriesByType('navigation')[0];
      const vitals = window.__aiAdvisorP6Vitals || {};
      return {
        mounted: document.querySelectorAll('.lp-agent-root').length === 1
          && window.__ledProjectorAgentLoaded === true,
        viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
        webVitals: {
          lcpMs: Number(vitals.lcpMs || 0),
          cls: Number(vitals.cls || 0),
          inpMs: Number(vitals.inpMs || 0)
        },
        navigation: nav ? {
          ttfbMs: nav.responseStart,
          domContentLoadedMs: nav.domContentLoadedEventEnd,
          loadMs: nav.loadEventEnd,
          transferBytes: nav.transferSize
        } : null
      };
    })()`);
    return assessBrowserProbe({
      routes: routeReports,
      mobile: Object.freeze({ ...mobileState, interaction }),
      errors: [...new Set(errors)],
      expectedRoutes: routes,
    });
  } finally {
    client?.close();
    if (!child.killed) child.kill();
    await Promise.race([
      new Promise((resolve) => child.once('exit', resolve)),
      delay(2_000),
    ]);
    if (!child.killed) child.kill('SIGKILL');
    await rm(profileDir, { recursive: true, force: true });
  }
}

class CdpClient {
  constructor(socket, timeoutMs) {
    this.socket = socket;
    this.timeoutMs = timeoutMs;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Set();
    socket.addEventListener('message', (event) => this.#handleMessage(event.data));
    socket.addEventListener('close', () => this.#rejectAll(new Error('CDP socket closed')));
    socket.addEventListener('error', () => this.#rejectAll(new Error('CDP socket error')));
  }

  static async connect(endpoint, timeoutMs) {
    const socket = new WebSocket(endpoint);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('CDP connection timeout')), timeoutMs);
      socket.addEventListener('open', () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
      socket.addEventListener('error', () => {
        clearTimeout(timer);
        reject(new Error('CDP connection failed'));
      }, { once: true });
    });
    return new CdpClient(socket, timeoutMs);
  }

  send(method, params = {}, sessionId = undefined) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP command timeout: ${method}`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }

  waitForEvent(method, sessionId, timeoutMs = this.timeoutMs) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.listeners.delete(listener);
        reject(new Error(`CDP event timeout: ${method}`));
      }, timeoutMs);
      const listener = (event) => {
        if (event.method !== method || (sessionId && event.sessionId !== sessionId)) return;
        clearTimeout(timer);
        this.listeners.delete(listener);
        resolve(event.params || {});
      };
      this.listeners.add(listener);
    });
  }

  onEvent(listener) {
    this.listeners.add(listener);
  }

  close() {
    try {
      this.socket.close();
    } catch {
      // Best-effort cleanup.
    }
  }

  #handleMessage(raw) {
    const message = JSON.parse(String(raw));
    if (message.id) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message || 'CDP command failed'));
      else pending.resolve(message.result || {});
      return;
    }
    for (const listener of [...this.listeners]) listener(message);
  }

  #rejectAll(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}

async function waitForDevToolsEndpoint(child, timeoutMs) {
  return await new Promise((resolve, reject) => {
    let stderr = '';
    const timer = setTimeout(() => reject(new Error('Browser startup timeout')), timeoutMs);
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-8_192);
      const endpoint = parseDevToolsEndpoint(stderr);
      if (!endpoint) return;
      clearTimeout(timer);
      resolve(endpoint);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Browser exited before CDP startup (${code})`));
    });
  });
}

async function navigateAndWait(client, sessionId, url, timeoutMs) {
  const navigation = await client.send('Page.navigate', { url }, sessionId);
  if (navigation.errorText) throw new Error(`Browser navigation failed: ${navigation.errorText}`);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const state = await evaluate(client, sessionId, `({
        ready: document.readyState,
        url: location.href
      })`);
      if (
        state?.url
        && state.url !== 'about:blank'
        && (state.ready === 'interactive' || state.ready === 'complete')
      ) {
        await delay(750);
        return;
      }
    } catch {
      // The execution context is replaced during navigation; retry until deadline.
    }
    await delay(250);
  }
  throw new Error(`Browser navigation timeout: ${url}`);
}

async function evaluate(client, sessionId, expression) {
  const result = await client.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  }, sessionId);
  if (result.exceptionDetails) throw new Error('Browser evaluation failed');
  return result.result?.value;
}

async function runInteraction(client, sessionId) {
  const openRect = await evaluate(client, sessionId, `(() => {
    const button = document.querySelector('.lp-agent-mascot-button');
    if (!button) return null;
    const rect = button.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  if (!openRect) return Object.freeze({ focusContract: false });
  await clickPoint(client, sessionId, openRect);
  await delay(250);
  const opened = await evaluate(client, sessionId, `({
    open: document.querySelector('.lp-agent-root')?.dataset.open,
    focus: document.activeElement?.id
  })`);
  const closeRect = await evaluate(client, sessionId, `(() => {
    const button = document.querySelector('[data-action="close"]');
    if (!button) return null;
    const rect = button.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  if (!closeRect) return Object.freeze({ focusContract: false, opened });
  await clickPoint(client, sessionId, closeRect);
  await delay(250);
  const closed = await evaluate(client, sessionId, `({
    open: document.querySelector('.lp-agent-root')?.dataset.open,
    focusClass: document.activeElement?.className
  })`);
  return Object.freeze({
    opened,
    closed,
    focusContract: opened.open === 'true'
      && opened.focus === 'lp-agent-input'
      && closed.open === 'false'
      && String(closed.focusClass || '').includes('lp-agent-mascot-button'),
  });
}

async function clickPoint(client, sessionId, point) {
  await client.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: point.x,
    y: point.y,
    button: 'left',
    clickCount: 1,
  }, sessionId);
  await client.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: point.x,
    y: point.y,
    button: 'left',
    clickCount: 1,
  }, sessionId);
}

function vitalsBootstrapSource() {
  return `(() => {
    window.__aiAdvisorP6Vitals = { lcpMs: 0, cls: 0, inpMs: 0 };
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          window.__aiAdvisorP6Vitals.lcpMs = Math.max(
            window.__aiAdvisorP6Vitals.lcpMs,
            entry.startTime
          );
        }
      }).observe({ type: 'largest-contentful-paint', buffered: true });
    } catch {}
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (!entry.hadRecentInput) window.__aiAdvisorP6Vitals.cls += entry.value;
        }
      }).observe({ type: 'layout-shift', buffered: true });
    } catch {}
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.interactionId) {
            window.__aiAdvisorP6Vitals.inpMs = Math.max(
              window.__aiAdvisorP6Vitals.inpMs,
              entry.duration
            );
          }
        }
      }).observe({ type: 'event', buffered: true, durationThreshold: 16 });
    } catch {}
  })();`;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
