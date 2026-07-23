import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readConfig } from './src/config.mjs';
import { buildAssistantInput, buildAssistantPrompt, sanitizeMessages, trustedInstructions } from './src/prompt.mjs';
import { searchCatalog } from './src/catalog.mjs';
import { searchKnowledge } from './src/knowledge.mjs';
import { appendLearningRecord } from './src/learning-log.mjs';
import { askViaCli } from './src/providers/cli-provider.mjs';
import { askViaApi } from './src/providers/api-provider.mjs';
import { askViaTest } from './src/providers/test-provider.mjs';
import { BackpressureError, ConcurrencyLimiter, FixedWindowRateLimiter } from './src/runtime-guards.mjs';
import { getRateLimitClientId } from './src/client-identity.mjs';

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

if (config.provider === 'api' && !config.apiKey) {
  console.error('OPENAI_API_KEY is required for API mode.');
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

      const result = await aiLimiter.run(async () => {
        const { products: catalog, diagnostics: catalogDiagnostics } = config.provider === 'test'
          ? { products: [], diagnostics: { code: 'TEST_PROVIDER', message: 'Catalog lookup skipped in test mode.' } }
          : await searchCatalog(config.storeUrl, latestQuestion);
        const knowledge = await searchKnowledge({ messages, page: body.page });
        const prompt = buildAssistantPrompt({ messages, page: body.page, catalog, knowledge });
        const safetyIdentifier = createHash('sha256')
          .update(`${safetySalt}:${clientId}:${request.headers['user-agent'] || ''}`)
          .digest('hex')
          .slice(0, 32);
        const answer = config.provider === 'cli'
          ? await askViaCli(prompt, config)
          : config.provider === 'api'
            ? await askViaApi({
              instructions: trustedInstructions(),
              input: buildAssistantInput({ messages, page: body.page, catalog, knowledge }),
            }, config, safetyIdentifier)
            : await askViaTest(config);
        if (catalog.length === 0 && config.provider !== 'test') {
          console.warn(`[catalog:${requestId}] ${catalogDiagnostics.code}`, catalogDiagnostics);
        }
        return { answer, catalog, catalogDiagnostics, knowledge };
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

      return json(response, 200, { ...result, provider: config.provider });
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

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[shutdown] ${signal}: draining requests for up to ${config.shutdownTimeoutMs}ms.`);
  clearInterval(rateLimitCleanupTimer);
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
