import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readConfig } from './src/config.mjs';
import { buildAssistantInput, buildAssistantPrompt, sanitizeMessages, trustedInstructions } from './src/prompt.mjs';
import { searchKnowledge } from './src/knowledge.mjs';
import { appendLearningRecord } from './src/learning-log.mjs';
import { askViaCli } from './src/providers/cli-provider.mjs';
import { askViaApi } from './src/providers/api-provider.mjs';
import { askViaTest } from './src/providers/test-provider.mjs';
import { BackpressureError, ConcurrencyLimiter, FixedWindowRateLimiter } from './src/runtime-guards.mjs';
import { getRateLimitClientId } from './src/client-identity.mjs';
import { executeRequestPipeline } from './request-pipeline.mjs';
import { createSalesdriveYmlClient } from './salesdrive-yml.mjs';
import { createSalesdriveApiClient } from './salesdrive-api.mjs';
import { createTelegramOrderRuntime } from './telegram-order-runtime.mjs';
import { loadProductSpecificationEvidence } from './product-specification-evidence.mjs';
import { createProductAnalytics } from './product-analytics.mjs';
import { buildReadinessSnapshot } from './readiness-slo.mjs';
import { decideRateLimitStrategy } from './rate-limit-strategy.mjs';

const config = readConfig();
const publicDir = fileURLToPath(new URL('./public/', import.meta.url));
const safetySalt = randomBytes(24).toString('hex');
const rateLimiter = new FixedWindowRateLimiter({ limit: config.rateLimitPerMinute });
const aiLimiter = new ConcurrencyLimiter({
  maxConcurrent: config.aiMaxConcurrent,
  maxQueue: config.aiMaxQueue,
});
const sockets = new Set();
let shuttingDown = false;
const salesdriveYml = createSalesdriveYmlClient();
const salesdriveApi = createSalesdriveApiClient();
const productSpecificationEvidence = await loadProductSpecificationEvidence(
  fileURLToPath(new URL('./knowledge/product-specifications.json', import.meta.url)),
);
const rateLimitStrategy = decideRateLimitStrategy({
  instanceCount: Number.parseInt(process.env.BACKEND_INSTANCE_COUNT || '1', 10),
  distributedConfigured: false,
});
if (rateLimitStrategy.status !== 'READY') {
  console.error('Distributed rate limiting is required before multi-instance startup.');
  process.exit(1);
}
const productAnalytics = createProductAnalytics({
  enabled: ['1', 'true', 'yes', 'on'].includes(String(process.env.PRODUCT_ANALYTICS_ENABLED || '').toLowerCase()),
  path: fileURLToPath(new URL('./logs/product-analytics.jsonl', import.meta.url)),
});
let telegramOrderRuntime = null;

if (config.provider === 'api' && !config.apiKey) {
  console.error('OPENAI_API_KEY is required for API mode.');
  process.exit(1);
}

try {
  telegramOrderRuntime = await createTelegramOrderRuntime({
    config: {
      ...config,
      telegramOrderBotUsername: String(process.env.TELEGRAM_ORDER_BOT_USERNAME || ''),
      telegramOrderManagerChatId: String(process.env.TELEGRAM_ORDER_MANAGER_CHAT_ID || ''),
    },
  });
} catch {
  console.error('Telegram order runtime configuration failed.');
  process.exit(1);
}

const server = createServer(async (request, response) => {
  const requestId = randomUUID();
  response.setHeader('X-Request-Id', requestId);
  setSecurityHeaders(response);
  const requestUrl = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);

  if (request.method === 'OPTIONS') {
    if (!applyCors(request, response)) {
      return sendError(response, 403, 'Origin is not allowed.', 'ORIGIN_NOT_ALLOWED', requestId);
    }
    response.writeHead(204);
    return response.end();
  }

  if (requestUrl.pathname === '/health') {
    return json(response, 200, { ok: true, provider: config.provider });
  }

  if (requestUrl.pathname === '/ready') {
    const readiness = buildReadinessSnapshot({
      shuttingDown,
      providerConfigured: config.provider !== 'api' || Boolean(config.apiKey),
      queueActive: aiLimiter.active,
      queueQueued: aiLimiter.queued,
      maxConcurrent: config.aiMaxConcurrent,
      maxQueue: config.aiMaxQueue,
      rateLimitStrategy,
      telegramEnabled: config.telegramOrderEnabled,
      telegramReady: !config.telegramOrderEnabled || Boolean(telegramOrderRuntime),
    });
    return json(response, readiness.ready ? 200 : 503, readiness);
  }

  if (
    requestUrl.pathname === '/api/analytics/product'
    && request.method === 'POST'
    && productAnalytics.enabled
  ) {
    if (!applyCors(request, response)) {
      return sendError(response, 403, 'Origin is not allowed.', 'ORIGIN_NOT_ALLOWED', requestId);
    }
    const clientId = getRateLimitClientId(request);
    const rate = rateLimiter.consume(`product-analytics:${clientId}`);
    if (!rate.allowed) {
      return sendError(response, 429, 'Too many requests.', 'RATE_LIMITED', requestId, rate.retryAfterSeconds);
    }
    try {
      const accepted = await productAnalytics.record(await readJsonBody(request));
      return accepted
        ? json(response, 202, { ok: true })
        : sendError(response, 400, 'Invalid analytics event.', 'INVALID_ANALYTICS_EVENT', requestId);
    } catch (error) {
      if (error.code === 'INVALID_JSON') return sendError(response, 400, 'Invalid JSON body.', error.code, requestId);
      if (error.code === 'BODY_TOO_LARGE') return sendError(response, 413, 'Request body is too large.', error.code, requestId);
      if (error.code === 'UNSUPPORTED_MEDIA_TYPE') return sendError(response, 415, 'Content-Type must be application/json.', error.code, requestId);
      return sendError(response, 503, 'Analytics is temporarily unavailable.', 'ANALYTICS_UNAVAILABLE', requestId);
    }
  }

  if (
    requestUrl.pathname === '/api/telegram/order-link'
    && request.method === 'POST'
    && telegramOrderRuntime
  ) {
    if (!applyCors(request, response)) {
      return sendError(response, 403, 'Origin is not allowed.', 'ORIGIN_NOT_ALLOWED', requestId);
    }
    const clientId = getRateLimitClientId(request);
    const rateLimit = rateLimiter.consume(`telegram-link:${clientId}`);
    if (!rateLimit.allowed) {
      return sendError(response, 429, 'Too many requests.', 'RATE_LIMITED', requestId, rateLimit.retryAfterSeconds);
    }
    try {
      const body = await readJsonBody(request);
      const link = await telegramOrderRuntime.provision({ orderReference: body.orderReference });
      return json(response, 200, link);
    } catch (error) {
      if (error.code === 'INVALID_JSON') return sendError(response, 400, 'Invalid JSON body.', error.code, requestId);
      if (error.code === 'BODY_TOO_LARGE') return sendError(response, 413, 'Request body is too large.', error.code, requestId);
      if (error.code === 'UNSUPPORTED_MEDIA_TYPE') return sendError(response, 415, 'Content-Type must be application/json.', error.code, requestId);
      return sendError(response, 503, 'Telegram verification is temporarily unavailable.', 'TELEGRAM_LINK_UNAVAILABLE', requestId);
    }
  }

  if (
    requestUrl.pathname === config.telegramOrderWebhookPath
    && request.method === 'POST'
    && telegramOrderRuntime
  ) {
    try {
      const update = await readJsonBody(request);
      const result = await telegramOrderRuntime.handle({
        secretHeader: request.headers['x-telegram-bot-api-secret-token'],
        update,
      });
      return json(response, result.httpStatus, result.body);
    } catch (error) {
      if (error.code === 'INVALID_JSON') return json(response, 400, { ok: false });
      if (error.code === 'BODY_TOO_LARGE') return json(response, 413, { ok: false });
      if (error.code === 'UNSUPPORTED_MEDIA_TYPE') return json(response, 415, { ok: false });
      return json(response, 503, { ok: false });
    }
  }

  if (requestUrl.pathname === '/api/chat' && request.method === 'POST') {
    if (shuttingDown) {
      return sendError(response, 503, 'The server is shutting down.', 'SERVER_SHUTTING_DOWN', requestId, 1);
    }
    if (!applyCors(request, response)) {
      return sendError(response, 403, 'Origin is not allowed.', 'ORIGIN_NOT_ALLOWED', requestId);
    }
    const clientId = getRateLimitClientId(request);
    const rateLimit = rateLimiter.consume(clientId);
    if (!rateLimit.allowed) {
      return sendError(
        response,
        429,
        'Too many requests. Please try again later.',
        'RATE_LIMITED',
        requestId,
        rateLimit.retryAfterSeconds,
      );
    }

    try {
      const body = await readJsonBody(request);
      const messages = sanitizeMessages(body.messages);
      const latestQuestion = [...messages].reverse().find((item) => item.role === 'user')?.content || '';
      if (!latestQuestion) {
        return sendError(response, 400, 'Message is required.', 'MESSAGE_REQUIRED', requestId);
      }

      const safetyIdentifier = createHash('sha256')
        .update(`${safetySalt}:${clientId}:${request.headers['user-agent'] || ''}`)
        .digest('hex')
        .slice(0, 32);
      const result = await aiLimiter.run(async () => {
        const pipeline = await executeRequestPipeline({
          question: latestQuestion,
          messages,
          page: body.page,
          queryCatalog: async () => config.provider === 'test'
            ? { products: [], diagnostics: { code: 'TEST_PROVIDER', message: 'Catalog lookup skipped in test mode.' } }
            : salesdriveYml.search(latestQuestion),
          querySalesdriveCatalog: config.provider === 'test'
            ? undefined
            : (question) => salesdriveYml.search(question),
          querySalesdriveDelivery: config.provider === 'test'
            ? undefined
            : () => salesdriveApi.listDeliveryMethods(),
          querySalesdrivePayment: config.provider === 'test'
            ? undefined
            : () => salesdriveApi.listPaymentMethods(),
          productSpecificationEvidence,
          queryKnowledge: () => searchKnowledge({ messages, page: body.page }),
          buildPrompt: buildAssistantPrompt,
          askSupport: (input) => askAssistant({ ...input, safetyIdentifier }),
          askVerifier: (evidence) => verifyAnswer(evidence, safetyIdentifier),
        });
        console.info(`[route:${requestId}] route=${pipeline.route.route} intent=${pipeline.route.intent} risk=${pipeline.route.riskLevel} resolvers=${pipeline.route.requiredResolvers.join('|') || 'NONE'}`);
        console.info(`[validation:${requestId}] action=${pipeline.validation.action} accepted=${pipeline.validation.accepted} reasons=${pipeline.validation.reasons.join(',') || 'NONE'} verification=${pipeline.verification.status}`);
        if (pipeline.catalog.length === 0 && config.provider !== 'test' && pipeline.catalogDiagnostics.code !== 'SKIPPED_BY_ROUTE') {
          console.warn(`[catalog:${requestId}] ${pipeline.catalogDiagnostics.code}`, pipeline.catalogDiagnostics);
        }
        return pipeline;
      });

      if (config.learningLogEnabled) {
        try {
          await appendLearningRecord(config.learningLogPath, {
            requestId,
            messages,
            answer: result.answer,
            knowledge: result.knowledge,
            catalogDiagnostics: result.catalogDiagnostics,
            provider: config.provider,
          });
        } catch (error) {
          console.warn(`[learning:${requestId}] ${error.message}`);
        }
      }

      return json(response, 200, {
        answer: result.answer,
        catalog: result.catalog,
        catalogDiagnostics: result.catalogDiagnostics,
        knowledge: result.knowledge,
        provider: config.provider,
      });
    } catch (error) {
      console.error(`[chat:${config.provider}:${requestId}]`, error.message);
      if (error.code === 'CLI_USAGE_LIMIT' || error.code === 'CLI_AUTH_REQUIRED') {
        return sendError(response, 503, error.message, error.code, requestId);
      }
      if (error.code === 'INVALID_JSON') return sendError(response, 400, 'Invalid JSON body.', error.code, requestId);
      if (error.code === 'BODY_TOO_LARGE') return sendError(response, 413, 'Request body is too large.', error.code, requestId);
      if (error.code === 'UNSUPPORTED_MEDIA_TYPE') {
        return sendError(response, 415, 'Content-Type must be application/json.', error.code, requestId);
      }
      if (error instanceof BackpressureError) {
        return sendError(response, 503, error.message, error.code, requestId, 1);
      }
      return sendError(
        response,
        500,
        'Консультант временно недоступен. Попробуйте ещё раз.',
        'INTERNAL_ERROR',
        requestId,
      );
    }
  }

  if (request.method === 'GET') return serveStatic(requestUrl.pathname, response);
  return sendError(response, 404, 'Not found.', 'NOT_FOUND', requestId);
});

server.on('connection', (socket) => {
  sockets.add(socket);
  socket.on('close', () => sockets.delete(socket));
});

server.listen(config.port, config.host, () => {
  console.log(`LedProjector AI assistant: http://${config.host}:${config.port}`);
  console.log(`Provider: ${config.provider}`);
  if (config.provider === 'cli') console.log('CLI mode is restricted to this computer.');
});

const rateLimitCleanupTimer = setInterval(() => rateLimiter.cleanup(), 60_000);
rateLimitCleanupTimer.unref();

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => void shutdown(signal));
}

function applyCors(request, response) {
  const origin = request.headers.origin;
  if (!origin) return true;
  const localOrigins = [`http://127.0.0.1:${config.port}`, `http://localhost:${config.port}`];
  const allowed = [...config.allowedOrigins, ...localOrigins].includes(origin);
  if (allowed) {
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Vary', 'Origin');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  }
  return allowed;
}

async function readJsonBody(request) {
  if (!String(request.headers['content-type'] || '').toLowerCase().startsWith('application/json')) {
    const error = new Error('Content-Type must be application/json.');
    error.code = 'UNSUPPORTED_MEDIA_TYPE';
    throw error;
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 64 * 1024) {
      const error = new Error('Request body is too large.');
      error.code = 'BODY_TOO_LARGE';
      throw error;
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    const error = new Error('Invalid JSON body.');
    error.code = 'INVALID_JSON';
    throw error;
  }
}

async function serveStatic(pathname, response) {
  const relative = pathname === '/' ? 'demo.html' : pathname.replace(/^\/+/, '');
  const safePath = normalize(relative).replace(/^(\.\.(\\|\/|$))+/, '');
  const filePath = join(publicDir, safePath);
  const requestId = response.getHeader('X-Request-Id');
  if (!filePath.startsWith(publicDir)) {
    return sendError(response, 403, 'Forbidden.', 'FORBIDDEN', requestId);
  }

  try {
    const info = await stat(filePath);
    if (!info.isFile()) throw new Error('Not a file');
    response.writeHead(200, {
      'Content-Type': mimeType(extname(filePath)),
      'Cache-Control': filePath.endsWith('demo.html') ? 'no-store' : 'public, max-age=300',
    });
    createReadStream(filePath).pipe(response);
  } catch {
    sendError(response, 404, 'Not found.', 'NOT_FOUND', requestId);
  }
}

function mimeType(extension) {
  return ({
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
  })[extension] || 'application/octet-stream';
}

function setSecurityHeaders(response) {
  response.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https://ledprojector.com.ua https://www.ledprojector.com.ua data:; connect-src 'self'",
  );
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
}

function json(response, status, payload) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload));
}

function sendError(response, status, error, code, requestId, retryAfterSeconds) {
  if (retryAfterSeconds) response.setHeader('Retry-After', String(retryAfterSeconds));
  return json(response, status, { error, code, requestId });
}

async function askAssistant({ prompt, messages, page, catalog, knowledge, safetyIdentifier }) {
  if (config.provider === 'cli') return askViaCli(prompt, config);
  if (config.provider === 'api') {
    return askViaApi({
      instructions: trustedInstructions(),
      input: buildAssistantInput({ messages, page, catalog, knowledge }),
    }, config, safetyIdentifier);
  }
  const testAnswer = String(process.env.AI_TEST_PROVIDER_RESPONSE || '').trim();
  return testAnswer || askViaTest(config);
}

async function verifyAnswer(evidence, safetyIdentifier) {
  if (config.provider === 'test') return { approved: true };

  const instructions = [
    trustedInstructions(),
    'You are the independent verification agent. Check whether the draft is supported by the supplied evidence and avoids unsupported commercial promises.',
    'Return exactly ALLOW when the draft is safe. Return ESCALATE when any material claim is unsupported, ambiguous, or risky.',
  ].join('\n');
  const rawVerdict = config.provider === 'cli'
    ? await askViaCli(`${instructions}\nUNTRUSTED_EVIDENCE_START\n${JSON.stringify(evidence)}\nUNTRUSTED_EVIDENCE_END`, config)
    : await askViaApi({ instructions, input: { evidence } }, config, safetyIdentifier);
  return {
    approved: /^ALLOW\b/iu.test(String(rawVerdict || '').trim()),
    reason: String(rawVerdict || '').trim().slice(0, 120) || 'VERIFIER_EMPTY_RESPONSE',
  };
}

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[shutdown] ${signal}: draining requests for up to ${config.shutdownTimeoutMs}ms.`);
  clearInterval(rateLimitCleanupTimer);
  try {
    await telegramOrderRuntime?.close();
  } catch {
    console.warn('[shutdown] Telegram order state close failed.');
  }
  rateLimiter.clear();
  aiLimiter.close();

  const forceTimer = setTimeout(() => {
    console.error('[shutdown] Grace period expired; closing active connections.');
    for (const socket of sockets) socket.destroy();
    process.exit(1);
  }, config.shutdownTimeoutMs);
  forceTimer.unref();

  server.close((error) => {
    clearTimeout(forceTimer);
    if (error) {
      console.error('[shutdown] Server close failed.', error);
      process.exitCode = 1;
    } else {
      console.log('[shutdown] Complete.');
    }
  });
  server.closeIdleConnections?.();
}
