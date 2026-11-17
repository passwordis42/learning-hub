import http from 'node:http';
import https from 'node:https';
import { lookup as dnsLookup } from 'node:dns/promises';

const loopbackHosts = new Set(['localhost', '127.0.0.1', '::1']);

function ipv4(host) {
  const parts = host.split('.');
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return null;
  const numbers = parts.map(Number);
  if (numbers.some((number) => number > 255)) return null;
  return numbers;
}

export function assertSafeUpstream(raw) {
  if (typeof raw !== 'string' || raw.length > 300) throw new Error('上游地址无效。');
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('上游地址必须是完整的 URL。');
  }
  if (url.username || url.password) throw new Error('上游地址不能包含账号或密码。');
  if (url.search || url.hash) throw new Error('上游地址不能包含查询或片段。');
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const loopback = loopbackHosts.has(host);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new Error('非本机上游必须使用 HTTPS。');
  }
  if (host.includes('%') || host.includes('..') || host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.localhost')) {
    throw new Error('上游地址不能指向内网或元数据服务。');
  }
  const address = ipv4(host);
  if (address) {
    const [a, b] = address;
    const privateAddress = a === 10 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
    if (!loopback || privateAddress) throw new Error('上游地址不能使用内网 IP。');
  } else if (host.includes(':') && !loopback) {
    throw new Error('上游地址不能使用非本机 IP。');
  }
  if (url.port && (!/^\d+$/.test(url.port) || Number(url.port) < 1 || Number(url.port) > 65535)) {
    throw new Error('上游端口无效。');
  }
  if (url.pathname.split('/').some((part) => part === '..' || part === '.')) throw new Error('上游路径无效。');
  return url.toString().replace(/\/$/, '');
}

function blockedAddress(host) {
  const lower = host.toLowerCase();
  if (lower === '::1') return false;
  if (lower === '::') return true;
  if (lower.startsWith('::ffff:')) {
    const rest = lower.slice(7);
    if (rest.includes('.')) return blockedAddress(rest);
    const parts = rest.split(':');
    if (parts.length !== 2) return true;
    const value = (Number.parseInt(parts[0], 16) << 16) + Number.parseInt(parts[1], 16);
    if (!Number.isFinite(value)) return true;
    return blockedAddress([(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255].join('.'));
  }
  const address = ipv4(lower);
  if (address) {
    const [a, b] = address;
    if (a === 127) return false;
    return a === 10 || a === 0 || a >= 224 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
  }
  if (!lower.includes(':')) return false;
  return lower.startsWith('fe80:') || lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('ff');
}

function resolutionBlocked(address, explicitLoopback) {
  const lower = String(address || '').toLowerCase();
  const mapped = ipv4(lower);
  if (explicitLoopback && (lower === '::1' || mapped?.[0] === 127)) return false;
  if (lower === '::1' || mapped?.[0] === 127) return true;
  return blockedAddress(lower);
}

export async function resolvePinned(raw, lookupFn = dnsLookup) {
  const href = assertSafeUpstream(raw);
  const url = new URL(href);
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const explicitLoopback = loopbackHosts.has(host);
  let records;
  if (host === 'localhost') {
    records = [{ address: '127.0.0.1', family: 4 }];
  } else if (explicitLoopback || ipv4(host) || host.includes(':')) {
    records = [{ address: host, family: host.includes(':') && !ipv4(host) ? 6 : 4 }];
  } else {
    try {
      records = await lookupFn(host, { all: true, verbatim: true });
    } catch {
      throw new Error('上游地址无法确认不是内网。');
    }
  }
  if (!records?.length || records.some((record) => resolutionBlocked(record.address, explicitLoopback))) {
    throw new Error('上游地址解析到了内网。');
  }
  const chosen = records[0];
  return {
    href,
    host,
    address: chosen.address,
    family: chosen.family,
    protocol: url.protocol,
    port: Number(url.port || (url.protocol === 'https:' ? 443 : 80)),
    path: `${url.pathname}${url.search}`,
  };
}

export async function assertResolvedUpstream(raw) {
  return (await resolvePinned(raw)).href;
}

function headerEntries(headers) {
  const output = {};
  if (!headers) return output;
  if (typeof headers.forEach === 'function' && !Array.isArray(headers)) {
    headers.forEach((value, key) => { output[key] = value; });
    return output;
  }
  for (const [key, value] of Object.entries(headers)) {
    if (value != null) output[key] = value;
  }
  return output;
}

export async function pinnedFetch(raw, init = {}, dependencies = {}) {
  const plan = await resolvePinned(raw, dependencies.lookup || dnsLookup);
  if (dependencies.transport) return dependencies.transport(plan, init);
  const headers = headerEntries(init.headers);
  delete headers.host;
  headers.host = plan.host;
  const body = init.body == null ? undefined : Buffer.from(init.body);
  const transport = plan.protocol === 'https:' ? https : http;
  const response = await new Promise((resolve, reject) => {
    const request = transport.request({
      host: plan.address,
      family: plan.family,
      servername: plan.protocol === 'https:' ? plan.host : undefined,
      port: plan.port,
      path: plan.path,
      method: init.method || 'GET',
      headers,
      timeout: 20_000,
    }, (incoming) => {
      if (incoming.statusCode >= 300 && incoming.statusCode < 400) {
        incoming.resume();
        reject(Object.assign(new Error('上游重定向已被拒绝。'), { code: 'redirect-blocked' }));
        return;
      }
      const chunks = [];
      let size = 0;
      incoming.on('data', (chunk) => {
        size += chunk.length;
        if (size > 1024 * 1024) {
          request.destroy();
          reject(new Error('上游响应过长。'));
          return;
        }
        chunks.push(chunk);
      });
      incoming.on('end', () => {
        resolve(new Response(Buffer.concat(chunks), {
          status: incoming.statusCode,
          headers: { 'content-type': incoming.headers['content-type'] || 'application/octet-stream' },
        }));
      });
    });
    const abort = () => request.destroy(Object.assign(new Error('请求已取消。'), { name: 'AbortError' }));
    init.signal?.addEventListener('abort', abort, { once: true });
    request.on('timeout', () => request.destroy(Object.assign(new Error('上游响应超时。'), { name: 'TimeoutError' })));
    request.on('error', reject);
    if (body) request.write(body);
    request.end();
  });
  return response;
}
