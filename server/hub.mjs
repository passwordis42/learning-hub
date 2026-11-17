import { createReadStream, readFileSync } from 'node:fs';
import { stat, realpath } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const GAME_UPSTREAM = 'http://127.0.0.1:4173';
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

async function proxyGame(request, response, pathname) {
  const method = GAME_ROUTES.get(pathname);
  if (request.method !== method) {
    return json(response, 405, { error: '此入口只转发课程原有的固定方法。' }, { Allow: method });
  }
  let body;
  try {
    body = request.method === 'POST' ? await readBody(request) : null;
    if (request.method !== 'POST') request.resume();
  } catch (error) {
    return json(response, error.status || 400, { error: '提交内容太长。' });
  }

  const headers = {};
  if (request.method === 'POST') {
    const type = request.headers['content-type'];
    if (typeof type === 'string' && type.length <= 80 && /^application\/json(?:\s*;.*)?$/i.test(type)) {
      headers['content-type'] = type;
    }
  }

  let upstream;
  try {
    upstream = await fetch(GAME_UPSTREAM + pathname, {
      method: request.method,
      headers,
      body,
      redirect: 'error',
      signal: AbortSignal.timeout(request.method === 'GET' ? 5000 : 50_000),
    });
  } catch (error) {
    const status = error.name === 'TimeoutError' ? 504 : 503;
    return json(response, status, {
      error: status === 504
        ? '本地游戏助手没有及时响应。'
        : '本地游戏助手未在 127.0.0.1:4173 运行。课程页面仍可学习；模型协助需要单独启动游戏目录中的助手。',
    });
  }

  const bytes = Buffer.from(await upstream.arrayBuffer());
  const type = upstream.headers.get('content-type') || '';
  if (!type.includes('application/json') || bytes.length > RESPONSE_LIMIT) {
    return json(response, 502, { error: '本地游戏助手返回了无法显示的响应。' });
  }
  response.writeHead(upstream.status, {
    'Content-Type': type.includes('charset') ? type : 'application/json; charset=utf-8',
    'Content-Length': bytes.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(bytes);
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

  return createServer({ requestTimeout: 80_000, headersTimeout: 10_000 }, async (request, response) => {
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

    if (GAME_ROUTES.has(pathname)) {
      if (url.search) return json(response, 404, { error: '接口不存在。' });
      return proxyGame(request, response, pathname);
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
    if (!SITES.includes(site)) return text(response, 404, '页面不存在。');
    if (segments.length === 1 && !remainder.endsWith('/')) return redirect(response, `${base}${site}/`);
    const fileParts = segments.slice(1);
    if (!fileParts.length) fileParts.push('index.html');
    return serveStatic(response, distDir, site, fileParts, request.method);
  });
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
