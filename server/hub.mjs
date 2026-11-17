import { createReadStream, readFileSync } from 'node:fs';
import { stat, realpath } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createTutorServer } from '../sites/ai-learning-atlas/server/index.mjs';
import { CoachError, assist, getProviderStatus } from '../sites/game-design-atlas/server/coach.mjs';
import { clearConfig, loadConfig, publicConfig, saveConfig, toAiEnv, toGameEnv } from './assistant-config.mjs';
import { probeVendor, statusReport } from './assistant-probe.mjs';

export const GAME_UPSTREAM = 'http://127.0.0.1:4173';
export const TUTOR_UPSTREAM = 'http://127.0.0.1:8787';
export const GAME_ROUTES = new Map([
  ['/api/status', 'GET'],
  ['/api/assist', 'POST'],
]);
const SITES = ['ai', 'nmr-from-zero', 'game'];
const BODY_LIMIT = 52 * 1024;
const RESPONSE_LIMIT = 1024 * 1024;

const contentTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.webp', 'image/webp'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.ico', 'image/x-icon'],
  ['.woff2', 'font/woff2'],
  ['.woff', 'font/woff'],
  ['.ttf', 'font/ttf'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.md', 'text/plain; charset=utf-8'],
  ['.map', 'application/json; charset=utf-8'],
]);

export function normalizeHubBase(raw = '/') {
  if (raw == null || raw === '' || raw === '/') return '/';
  if (typeof raw !== 'string' || raw.includes('\\') || raw.includes('\0') || raw.includes('?') || raw.includes('#') || raw.includes('://') || raw.includes('%')) {
    throw new Error('HUB_BASE must be a path prefix.');
  }
  const value = raw.startsWith('/') ? raw : `/${raw}`;
  const withSlash = value.endsWith('/') ? value : `${value}/`;
  const parts = withSlash.split('/').filter(Boolean);
  if (!withSlash.startsWith('/') || withSlash.includes('//') || !parts.length || parts.some((part) => part === '.' || part === '..' || !/^[A-Za-z0-9._-]+$/.test(part))) {
    throw new Error('HUB_BASE must be /, or a slash-bounded prefix such as /learning-hub/.');
  }
  return withSlash;
}

function text(response, status, message, headers = {}) {
  const body = message.endsWith('\n') ? message : `${message}\n`;
  response.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  response.end(body);
}

function json(response, status, payload, headers = {}) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  response.end(body);
}

function redirect(response, location) {
  if (!location.startsWith('/') || location.startsWith('//') || location.includes('\\') || location.includes('://')) {
    return text(response, 400, '无法重定向。');
  }
  response.writeHead(308, {
    Location: location,
    'Content-Length': 0,
    'Cache-Control': 'no-store',
  });
  response.end();
}

async function readBody(request) {
  const declared = Number(request.headers['content-length'] || 0);
  if (Number.isFinite(declared) && declared > BODY_LIMIT) {
    request.resume();
    const error = new Error('too large');
    error.status = 413;
    throw error;
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > BODY_LIMIT) {
      const error = new Error('too large');
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function loopbackRequest(request) {
  const host = String(request.headers.host || '').replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
  return host === '127.0.0.1' || host === 'localhost' || host === '::1';
}

async function readJson(request) {
  const type = request.headers['content-type'] || '';
  if (!/^application\/json(?:\s*;.*)?$/i.test(type)) {
    request.resume();
    throw Object.assign(new Error('请使用 JSON。'), { status: 415 });
  }
  const body = await readBody(request);
  try {
    return JSON.parse(body.toString('utf8') || '{}');
  } catch {
    throw Object.assign(new Error('请求格式有误。'), { status: 400 });
  }
}

function rememberTutor(runtime, server) {
  runtime.tutor?.close();
  runtime.tutor = server;
  runtime.revision += 1;
}

async function tutorResponse(runtime, request, response) {
  const config = await loadConfig();
  if (runtime.revision !== config.revision || !runtime.port) {
    const created = createTutorServer({ env: toAiEnv(config) });
    await new Promise((resolve, reject) => {
      created.server.once('error', reject);
      created.server.listen(0, '127.0.0.1', resolve);
    });
    rememberTutor(runtime, created.server);
    runtime.port = created.server.address().port;
    runtime.revision = config.revision;
  }
  const headers = {};
  if (request.headers.authorization) headers.authorization = request.headers.authorization;
  else if (config.accessToken) headers.authorization = `Bearer ${config.accessToken}`;
  if (request.method === 'POST') headers['content-type'] = 'application/json';
  const body = request.method === 'POST' ? await readBody(request) : undefined;
  const upstream = await fetch(`http://127.0.0.1:${runtime.port}/api/tutor`, {
    method: request.method,
    headers,
    body,
    redirect: 'error',
  });
  if (request.method !== 'POST') request.resume();
  const bytes = Buffer.from(await upstream.arrayBuffer());
  const type = upstream.headers.get('content-type') || 'application/json; charset=utf-8';
  response.writeHead(upstream.status, {
    'Content-Type': type,
    'Content-Length': bytes.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(bytes);
}

async function handleAssistants(runtime, request, response, pathname) {
  if (!loopbackRequest(request)) return json(response, 403, { error: '助手配置只接受本机地址。' });
  try {
    if (pathname === '/api/assistant-config' && request.method === 'GET') {
      return json(response, 200, publicConfig(await loadConfig()));
    }
    if (pathname === '/api/assistant-config' && request.method === 'PUT') {
      const saved = await saveConfig(await readJson(request));
      runtime.revision = -1;
      return json(response, 200, saved);
    }
    if (pathname === '/api/assistant-config/clear' && request.method === 'POST') {
      const cleared = await clearConfig(await readJson(request));
      runtime.revision = -1;
      return json(response, 200, cleared);
    }
    if (pathname === '/api/assistant-config/test' && request.method === 'POST') {
      const body = await readJson(request);
      if (body?.scope === 'status') return json(response, 200, statusReport(await loadConfig(), body.vendor));
      if (body?.scope === 'model') {
        if (body.confirm !== 'test-model-usage') {
          return json(response, 400, { error: '模型调用尚未执行。该测试会产生模型用量，需要明确确认。', effect: '未向模型服务发送请求。' });
        }
        return json(response, 200, await probeVendor(await loadConfig(), body.vendor));
      }
      return json(response, 400, { error: '请选择状态测试或模型调用测试。' });
    }
    if (pathname === '/api/status' && request.method === 'GET') {
      request.resume();
      return json(response, 200, getProviderStatus(toGameEnv(await loadConfig())));
    }
    if (pathname === '/api/assist' && request.method === 'POST') {
      const result = await assist(await readJson(request), { env: toGameEnv(await loadConfig()) });
      return json(response, 200, result);
    }
    if (pathname === '/api/tutor' && (request.method === 'GET' || request.method === 'POST')) {
      return tutorResponse(runtime, request, response);
    }
    if (pathname === '/api/assistant-config' || pathname === '/api/assistant-config/clear' || pathname === '/api/assistant-config/test' || pathname === '/api/status' || pathname === '/api/assist' || pathname === '/api/tutor') {
      return json(response, 405, { error: '此接口不支持该请求方式。' });
    }
    return json(response, 404, { error: '接口不存在。' });
  } catch (error) {
    request.resume();
    if (error instanceof CoachError) return json(response, error.status, { error: error.message, ...(error.field ? { field: error.field } : {}) });
    const raw = String(error.message || '');
    const leaked = /https?:\/\/\S+|Bearer\s+\S+|sk-[A-Za-z0-9_-]+/i.test(raw);
    return json(response, error.status || 500, {
      error: leaked ? '请求未能完成。请检查已保存的配置。' : (raw.slice(0, 180) || '助手配置未能处理这次请求。'),
      ...(error.effect ? { effect: error.effect } : {}),
      ...(error.field ? { field: error.field } : {}),
    });
  }
  return false;
}

function safeSegments(pathname) {
  if (pathname.includes('\\') || pathname.includes('\0') || pathname.includes('%')) return null;
  const parts = pathname.split('/');
  if (parts.some((part) => part === '.' || part === '..')) return null;
  return parts.filter(Boolean);
}

async function serveStatic(response, distDir, site, fileParts, method) {
  if (method !== 'GET' && method !== 'HEAD') {
    return text(response, 405, '该路径只支持读取。', { Allow: 'GET, HEAD' });
  }
  if (fileParts.some((part) => part.startsWith('.') && part !== '.nojekyll')) {
    return text(response, 404, '页面不存在。');
  }
  const root = path.resolve(distDir, site);
  let rootReal;
  let fileReal;
  try {
    rootReal = await realpath(root);
    fileReal = await realpath(path.resolve(rootReal, ...fileParts));
  } catch {
    return text(response, 404, '页面不存在。');
  }
  const relative = path.relative(rootReal, fileReal);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    return text(response, 404, '页面不存在。');
  }
  const info = await stat(fileReal);
  if (!info.isFile()) return text(response, 404, '页面不存在。');
  const name = path.basename(fileReal);
  const type = name === '.nojekyll' ? 'text/plain; charset=utf-8' : contentTypes.get(path.extname(name).toLowerCase());
  if (!type) return text(response, 404, '页面不存在。');
  response.writeHead(200, {
    'Content-Type': type,
    'Content-Length': info.size,
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
  });
  if (method === 'HEAD') return response.end();
  createReadStream(fileReal).pipe(response);
}

export function createHubServer({ distDir, hubBase }) {
  const base = normalizeHubBase(hubBase);
  let recorded = '';
  try {
    recorded = readFileSync(path.join(distDir, '.hub-base'), 'utf8').trim();
  } catch {
    throw new Error('dist/.hub-base is missing. Run npm run build with the same HUB_BASE.');
  }
  if (recorded !== base) {
    throw new Error(`This dist was built for ${recorded} and cannot be served at ${base}. Rebuild with the same HUB_BASE.`);
  }

  const runtime = { tutor: null, port: 0, revision: -1 };
  const httpServer = createServer({ requestTimeout: 80_000, headersTimeout: 10_000 }, async (request, response) => {
    if (!request.url || !request.url.startsWith('/') || request.url.startsWith('//')) {
      return text(response, 400, '无效地址。');
    }
    let url;
    try {
      url = new URL(request.url, 'http://127.0.0.1');
    } catch {
      return text(response, 400, '无效地址。');
    }
    const pathname = url.pathname;
    if (pathname.includes('\\') || pathname.includes('\0')) return text(response, 400, '无效地址。');
    if (pathname.includes('%')) {
      try {
        const decoded = decodeURIComponent(pathname);
        if (decoded.includes('..') || decoded.includes('\\') || decoded.includes('\0') || decoded.includes('%')) {
          return text(response, 400, '无效地址。');
        }
      } catch {
        return text(response, 400, '无效地址。');
      }
      return text(response, 400, '无效地址。');
    }

    const assistantPath = pathname.startsWith('/api/')
      ? pathname
      : (base !== '/' && pathname.startsWith(`${base}api/`) ? `/${pathname.slice(base.length)}` : '');
    if (assistantPath) {
      if (url.search) return json(response, 404, { error: '接口不存在。' });
      return handleAssistants(runtime, request, response, assistantPath);
    }

    const bareBase = base === '/' ? '' : base.slice(0, -1);
    if (bareBase && pathname === bareBase) return redirect(response, base);
    if (base !== '/' && !pathname.startsWith(base)) return text(response, 404, '页面不存在。');

    const remainder = base === '/' ? pathname.slice(1) : pathname.slice(base.length);
    if (remainder === '') {
      return serveStatic(response, distDir, '.', ['index.html'], request.method);
    }
    const segments = safeSegments(`/${remainder}`);
    if (!segments) return text(response, 400, '无效地址。');
    const site = segments[0];
    if (!SITES.includes(site)) return serveStatic(response, distDir, '.', segments, request.method);
    if (segments.length === 1 && !remainder.endsWith('/')) return redirect(response, `${base}${site}/`);
    const fileParts = segments.slice(1);
    if (!fileParts.length) fileParts.push('index.html');
    return serveStatic(response, distDir, site, fileParts, request.method);
  });
  httpServer.on('close', () => runtime.tutor?.close());
  return httpServer;
}

function assertNode() {
  const major = Number(process.versions.node.split('.')[0]);
  if (major !== 24) {
    process.stderr.write(`learning-hub 需要 Node 24，当前是 ${process.versions.node}。\n`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  assertNode();
  const hubBase = normalizeHubBase(process.env.HUB_BASE ?? '/');
  const port = Number(process.env.PORT || 8080);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    process.stderr.write('PORT 必须为 1–65535 之间的整数。\n');
    process.exit(1);
  }
  const distDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
  const server = createHubServer({ distDir, hubBase });
  server.listen(port, '127.0.0.1', () => {
    const display = hubBase === '/' ? '/' : hubBase;
    process.stdout.write(`统一学习入口 http://127.0.0.1:${port}${display}\n`);
  });
}
