import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

export function dispatchManaged(request, response, sourceIp) {
  return new Promise((resolve) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      const event = {
        version: 'v1',
        rawPath: new URL(request.url, 'http://127.0.0.1').pathname.replace(/\/api\/ai\/.*/, (match) => match.startsWith('/learning-hub/') ? match.slice('/learning-hub'.length) : match),
        body,
        isBase64Encoded: false,
        headers: {
          'content-type': request.headers['content-type'] || 'application/json',
          'idempotency-key': request.headers['idempotency-key'] || '',
          'x-learning-session': request.headers['x-learning-session'] || '',
        },
        requestContext: { http: { method: request.method, path: pathOnly(request), sourceIp: sourceIp || request.socket.remoteAddress || '', protocol: 'HTTP/1.1' } },
      };
      const child = spawn('python3', ['-m', 'fc.managed_quota'], { cwd: root, stdio: ['pipe', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => { stdout += chunk; });
      child.stderr.on('data', (chunk) => { stderr += chunk; });
      child.on('error', () => {
        response.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        response.end(JSON.stringify({ code: 'runtime_unavailable', message: '托管助手没有启动。课程仍可阅读。', reading: true }));
        resolve();
      });
      child.on('close', () => {
        let parsed = null;
        try { parsed = JSON.parse(stdout); } catch { parsed = null; }
        const status = parsed?.statusCode || 503;
        const responseBody = parsed?.body || JSON.stringify({ code: 'runtime_unavailable', message: '托管助手没有返回可核对的结果。课程仍可阅读。', reading: true });
        if (stderr.includes('sk-') || responseBody.includes('MANAGED_QWEN_KEY')) {
          response.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
          response.end(JSON.stringify({ code: 'redacted', message: '托管助手没有返回可核对的结果。课程仍可阅读。', reading: true }));
          resolve();
          return;
        }
        response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        response.end(responseBody);
        resolve();
      });
      child.stdin.end(JSON.stringify(event));
    });
  });
}

function pathOnly(request) {
  const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
  return pathname.replace(/^\/learning-hub(?=\/api\/ai\/)/, '');
}
