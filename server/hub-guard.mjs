import { timingSafeEqual, randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function sameSecret(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  if (!a.length || a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function sessionFilePath() {
  if (process.env.HUB_SESSION_PATH) return process.env.HUB_SESSION_PATH;
  if (process.env.ASSISTANT_CONFIG_PATH) return path.join(path.dirname(process.env.ASSISTANT_CONFIG_PATH), 'hub-session');
  return path.join(root, 'server/secrets/hub-session');
}

export function listenAddress(env = process.env) {
  if (env.HUB_EXPOSURE !== 'remote') return '127.0.0.1';
  return env.HUB_BIND || '127.0.0.1';
}

export function remoteOptionsFromEnv(env = process.env) {
  if (env.HUB_EXPOSURE !== 'remote') return { exposure: 'loopback' };
  const token = env.HUB_ADMIN_TOKEN || '';
  const origin = env.HUB_PUBLIC_ORIGIN || '';
  const allowedHosts = (env.HUB_ALLOWED_HOSTS || '').split(',').map((item) => item.trim().toLowerCase()).filter(Boolean);
  if (token.length < 32) throw new Error('HUB_EXPOSURE=remote 需要 HUB_ADMIN_TOKEN，至少 32 个字符。不会启动公开入口。');
  let url;
  try {
    url = new URL(origin);
  } catch {
    throw new Error('HUB_PUBLIC_ORIGIN 必须是 https 源。');
  }
  if (url.protocol !== 'https:' || url.origin !== origin || url.username || url.password) {
    throw new Error('HUB_PUBLIC_ORIGIN 必须是不含路径、账号和查询的 https 源。');
  }
  if (!allowedHosts.includes(url.host.toLowerCase())) throw new Error('HUB_ALLOWED_HOSTS 必须包含公开源的主机。');
  if (env.HUB_TRUST_PROXY !== '1') throw new Error('HUB_EXPOSURE=remote 需要 HUB_TRUST_PROXY=1，由 HTTPS 反向代理终止 TLS。');
  return { exposure: 'remote', adminToken: token, publicOrigin: origin, allowedHosts, trustProxy: true };
}

export function createGuard(options = {}) {
  const exposure = options.exposure === 'remote' ? 'remote' : 'loopback';
  const token = exposure === 'remote' ? options.adminToken : randomBytes(32).toString('base64url');
  if (!token || token.length < 32) throw new Error('管理会话无法建立。');
  const file = sessionFilePath();
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${token}\n`, { mode: 0o600 });
  return {
    exposure,
    token,
    publicOrigin: options.publicOrigin || '',
    allowedHosts: new Set(options.allowedHosts || []),
    trustProxy: Boolean(options.trustProxy),
    file,
  };
}

function headerHost(request) {
  return String(request.headers.host || '').trim().toLowerCase();
}

export function requestBoundaryOk(guard, request) {
  const host = headerHost(request);
  if (guard.exposure === 'loopback') {
    const name = host.replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
    return name === '127.0.0.1' || name === 'localhost' || name === '::1';
  }
  if (!guard.allowedHosts.has(host.replace(/:\d+$/, ''))) return false;
  const forwardedHost = String(request.headers['x-forwarded-host'] || '').split(',')[0].trim().toLowerCase();
  if (forwardedHost && forwardedHost !== host) return false;
  const proto = String(request.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  if (guard.trustProxy) return proto === 'https';
  return Boolean(request.socket?.encrypted);
}

export function originOk(guard, request) {
  const site = String(request.headers['sec-fetch-site'] || '');
  if (site === 'cross-site') return false;
  const origin = request.headers.origin;
  if (!origin) return true;
  if (guard.exposure === 'remote') return origin === guard.publicOrigin;
  try {
    const url = new URL(origin);
    return url.protocol === 'http:' && url.host.toLowerCase() === headerHost(request);
  } catch {
    return false;
  }
}

export function bootstrapOk(guard, token) {
  return sameSecret(guard.token, token);
}

export function sessionOk(guard, request) {
  const header = request.headers['x-hub-session'];
  const cookie = String(request.headers.cookie || '').split(';').map((part) => part.trim()).find((part) => part.startsWith('hub_session='));
  const presented = header || (cookie ? decodeURIComponent(cookie.slice('hub_session='.length)) : '');
  return sameSecret(guard.token, presented);
}

export function sessionCookie(guard) {
  const secure = guard.exposure === 'remote' ? '; Secure' : '';
  return `hub_session=${encodeURIComponent(guard.token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${secure}`;
}

export function browserNavigation(request) {
  return request.method === 'GET' && request.headers['sec-fetch-dest'] === 'document' && request.headers['sec-fetch-mode'] === 'navigate' && request.headers['sec-fetch-site'] !== 'cross-site';
}
