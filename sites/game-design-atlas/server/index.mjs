import { createServer } from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assist, CoachError, getProviderStatus } from './coach.mjs';

const docsRoot = fileURLToPath(new URL('../docs/', import.meta.url));
const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
};

function json(response, status, data) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(JSON.stringify(data));
}

function normalizedOrigin(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.origin : null;
  } catch {
    return null;
  }
}

const validHost = /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/i;

function originAllowed(request, response, trustedOrigin) {
  const sentOrigin = request.headers.origin;
  if (!sentOrigin || sentOrigin === `http://${request.headers.host}`) return true;
  if (sentOrigin !== trustedOrigin) return false;

  response.setHeader('Access-Control-Allow-Origin', trustedOrigin);
  response.setHeader('Vary', 'Origin');
  return true;
}

async function readSubmission(request) {
  const maxBytes = 52 * 1024;
  const declaredLength = Number(request.headers['content-length']);
  if (declaredLength > maxBytes) {
    request.resume();
    throw new CoachError(413, '提交内容太长。');
  }

  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > maxBytes) throw new CoachError(413, '提交内容太长。');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new CoachError(400, '无法读取设计记录。');
  }
}

async function serveDocument(request, response, pathname) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return json(response, 405, { error: '该路径只支持读取。' });

  const namedFile = pathname === '/' ? '/index.html' : pathname;
  let pieces;
  try {
    pieces = decodeURIComponent(namedFile).slice(1).split('/');
  } catch {
    return json(response, 400, { error: '无效地址。' });
  }
  if (pieces.some((piece) => !piece || piece.startsWith('.') || /[\\:%\x00]/u.test(piece))) {
    return json(response, 404, { error: '页面不存在。' });
  }

  const type = contentTypes[path.extname(pieces.at(-1)).toLowerCase()];
  if (!type) return json(response, 404, { error: '页面不存在。' });

  try {
    const root = await realpath(docsRoot);
    const file = await realpath(path.join(root, ...pieces));
    const relative = path.relative(root, file);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      return json(response, 404, { error: '页面不存在。' });
    }
    const content = await readFile(file);
    response.writeHead(200, { 'Content-Type': type, 'Content-Length': content.length, 'Cache-Control': 'no-cache' });
    response.end(request.method === 'HEAD' ? undefined : content);
  } catch {
    return json(response, 404, { error: '页面不存在。' });
  }
}

export function createLearningServer({ env = process.env, fetcher = fetch } = {}) {
  const trustedOrigin = normalizedOrigin(env.TRUSTED_SITE_ORIGIN);
  let activeAssists = 0;

  return createServer({ requestTimeout: 15_000, headersTimeout: 10_000 }, async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('X-Frame-Options', 'DENY');

    if (!validHost.test(request.headers.host || '')) {
      return json(response, 403, { error: '本地助手只接受本机地址。' });
    }

    try {
      if (!request.url || !request.url.startsWith('/') || request.url.startsWith('//')) {
        return json(response, 400, { error: '无效地址。' });
      }
      const pathname = new URL(request.url, 'http://localhost').pathname;
      if (!pathname.startsWith('/api/')) return serveDocument(request, response, pathname);
      if (!originAllowed(request, response, trustedOrigin)) {
        return json(response, 403, { error: '此页面未获准连接本地助手。' });
      }

      if (request.method === 'OPTIONS') {
        response.writeHead(204, {
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
          ...(request.headers['access-control-request-private-network'] === 'true' && trustedOrigin === request.headers.origin
            ? { 'Access-Control-Allow-Private-Network': 'true' } : {}),
        });
        return response.end();
      }
      if (pathname === '/api/status' && request.method === 'GET') {
        return json(response, 200, getProviderStatus(env));
      }
      if (pathname !== '/api/assist' || request.method !== 'POST') {
        return json(response, 404, { error: '这个接口不存在。' });
      }
      if (!/^application\/json(?:\s*;.*)?$/i.test(request.headers['content-type'] || '')) {
        return json(response, 415, { error: '请以 JSON 提交设计记录。' });
      }
      if (activeAssists >= 2) return json(response, 429, { error: '已有两个请求正在处理。请稍后重试。' });

      activeAssists += 1;
      try {
        const input = await readSubmission(request);
        const result = await assist(input, { env, fetcher });
        return json(response, 200, result);
      } finally {
        activeAssists -= 1;
      }
    } catch (error) {
      if (response.destroyed || response.writableEnded) return;
      if (error instanceof CoachError) {
        return json(response, error.status, { error: error.message, ...(error.field && { field: error.field }) });
      }
      return json(response, 500, { error: '本地助手无法完成此请求。' });
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT || 4173);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    process.stderr.write('PORT 必须为 1–65535 之间的整数。\n');
    process.exitCode = 1;
  } else {
    const server = createLearningServer();
    server.on('error', (error) => {
      const message = error.code === 'EADDRINUSE' ? '端口已在使用。请改用其他 PORT。' : '无法启动本地助手。';
      process.stderr.write(`${message}\n`);
      process.exitCode = 1;
    });
    server.listen(port, '127.0.0.1', () => {
      process.stdout.write(`在浏览器打开 http://127.0.0.1:${port}/\n`);
    });
  }
}
