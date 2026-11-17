import { lookup } from 'node:dns/promises';

const loopbackHosts = new Set(['localhost', '127.0.0.1', '::1']);
const resolutions = new Map();

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

export async function assertResolvedUpstream(raw) {
  const normalized = assertSafeUpstream(raw);
  const host = new URL(normalized).hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (ipv4(host) || host.includes(':') || loopbackHosts.has(host)) return normalized;
  const now = Date.now();
  const cached = resolutions.get(host);
  if (cached && cached.expires > now) {
    if (cached.blocked) throw new Error('上游地址解析到了内网。');
    return normalized;
  }
  let records;
  try {
    records = await lookup(host, { all: true, verbatim: true });
  } catch {
    throw new Error('上游地址无法确认不是内网。');
  }
  const blocked = records.length === 0 || records.some((record) => blockedAddress(record.address));
  resolutions.set(host, { blocked, expires: now + 30_000 });
  if (blocked) throw new Error('上游地址解析到了内网。');
  return normalized;
}
