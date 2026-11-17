import http from 'node:http';
import https from 'node:https';
import { BlockList, isIP } from 'node:net';
import { lookup as dnsLookup } from 'node:dns/promises';

const loopbackHosts = new Set(['localhost', '127.0.0.1', '::1']);
const blocked = new BlockList();

function block4(address, prefix) {
  blocked.addSubnet(address, prefix, 'ipv4');
}
function block6(address, prefix) {
  blocked.addSubnet(address, prefix, 'ipv6');
}

block4('0.0.0.0', 8);
block4('10.0.0.0', 8);
block4('100.64.0.0', 10);
block4('127.0.0.0', 8);
block4('169.254.0.0', 16);
block4('172.16.0.0', 12);
block4('192.0.0.0', 24);
block4('192.0.2.0', 24);
block4('192.168.0.0', 16);
block4('198.18.0.0', 15);
block4('198.51.100.0', 24);
block4('203.0.113.0', 24);
block4('224.0.0.0', 4);
block4('240.0.0.0', 4);
block6('::', 128);
block6('::1', 128);
block6('fe80::', 10);
block6('fc00::', 7);
block6('fec0::', 10);
block6('ff00::', 8);
block6('2001:db8::', 32);
block6('64:ff9b:1::', 48);

function parseV4(host) {
  const parts = host.split('.');
  if (parts.length !== 4) return null;
  const bytes = new Uint8Array(4);
  for (let index = 0; index < 4; index += 1) {
    const part = parts[index];
    if (!/^\d{1,3}$/.test(part) || (part.length > 1 && part.startsWith('0'))) return null;
    const value = Number(part);
    if (value > 255) return null;
    bytes[index] = value;
  }
  return bytes;
}

function parseV6(host) {
  let text = host;
  const lastColon = text.lastIndexOf(':');
  if (text.includes('.')) {
    const tail = parseV4(text.slice(lastColon + 1));
    if (!tail || lastColon < 0) return null;
    const high = ((tail[0] << 8) | tail[1]).toString(16);
    const low = ((tail[2] << 8) | tail[3]).toString(16);
    text = `${text.slice(0, lastColon + 1)}${high}:${low}`;
  }
  if ((text.match(/::/g) || []).length > 1) return null;
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const read = (side) => {
    if (!side) return [];
    return side.split(':').map((part) => {
      if (!/^[0-9a-f]{1,4}$/.test(part)) return Number.NaN;
      return Number.parseInt(part, 16);
    });
  };
  const left = read(halves[0]);
  const right = halves.length === 2 ? read(halves[1]) : [];
  if (left.some((part) => Number.isNaN(part)) || right.some((part) => Number.isNaN(part))) return null;
  if (halves.length === 1 && left.length !== 8) return null;
  if (halves.length === 2 && left.length + right.length > 7) return null;
  const groups = halves.length === 1
    ? left
    : [...left, ...Array(8 - left.length - right.length).fill(0), ...right];
  if (groups.length !== 8) return null;
  const bytes = new Uint8Array(16);
  groups.forEach((group, index) => {
    bytes[index * 2] = (group >> 8) & 255;
    bytes[index * 2 + 1] = group & 255;
  });
  return bytes;
}

function isMappedOrCompatible(bytes) {
  for (let index = 0; index < 10; index += 1) if (bytes[index] !== 0) return false;
  const mapped = bytes[10] === 255 && bytes[11] === 255;
  const compatible = bytes[10] === 0 && bytes[11] === 0;
  if (!mapped && !compatible) return false;
  const last = bytes.slice(12);
  if (compatible && last.every((part) => part === 0)) return false;
  if (compatible && last[0] === 0 && last[1] === 0 && last[2] === 0 && last[3] === 1) return false;
  return true;
}

function formatV6(bytes) {
  const groups = [];
  for (let index = 0; index < 16; index += 2) groups.push((bytes[index] << 8) | bytes[index + 1]);
  let start = -1;
  let length = 0;
  for (let index = 0; index < groups.length;) {
    if (groups[index] !== 0) {
      index += 1;
      continue;
    }
    let end = index;
    while (end < groups.length && groups[end] === 0) end += 1;
    if (end - index > length) {
      start = index;
      length = end - index;
    }
    index = end;
  }
  const hex = (group) => group.toString(16);
  if (length < 2) return groups.map(hex).join(':');
  return `${groups.slice(0, start).map(hex).join(':')}::${groups.slice(start + length).map(hex).join(':')}`;
}

export function canonicalAddress(raw) {
  const host = String(raw || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!host || host.includes('%') || host.includes('/') || isIP(host) === 0) return null;
  const v4 = parseV4(host);
  if (v4) return { family: 4, bytes: v4, text: [...v4].join('.') };
  const v6 = parseV6(host);
  if (!v6) return null;
  if (isMappedOrCompatible(v6)) {
    const bytes = v6.slice(12);
    return { family: 4, bytes, text: [...bytes].join('.') };
  }
  if (v6.every((part, index) => part === (index === 15 ? 1 : 0))) {
    return { family: 6, bytes: v6, text: '::1' };
  }
  return { family: 6, bytes: v6, text: formatV6(v6) };
}

function embeddedV4(bytes) {
  if (bytes[0] === 0x20 && bytes[1] === 0x02) return bytes.slice(2, 6);
  const nat64 = [0x00, 0x64, 0xff, 0x9b, 0, 0, 0, 0, 0, 0, 0, 0];
  if (nat64.every((part, index) => bytes[index] === part)) return bytes.slice(12);
  return null;
}

function v4Denied(bytes) {
  return blocked.check([...bytes].join('.'), 'ipv4');
}

export function addressDenied(raw, explicitLoopback = false) {
  const canonical = canonicalAddress(raw);
  if (!canonical) return true;
  if (explicitLoopback && canonical.family === 4 && canonical.text === '127.0.0.1') return false;
  if (explicitLoopback && canonical.family === 6 && canonical.text === '::1') return false;
  if (canonical.family === 4) return v4Denied(canonical.bytes);
  const embedded = embeddedV4(canonical.bytes);
  if (embedded && v4Denied(embedded)) return true;
  if ((canonical.bytes[0] & 0xe0) !== 0x20) return true;
  return blocked.check(canonical.text, 'ipv6');
}

export function sameAddress(left, right) {
  const a = canonicalAddress(left);
  const b = canonicalAddress(right);
  if (!a || !b || a.family !== b.family || a.bytes.length !== b.bytes.length) return false;
  return a.bytes.every((part, index) => part === b.bytes[index]);
}

function hostOf(url) {
  return url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
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
  const host = hostOf(url);
  const loopback = loopbackHosts.has(host);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new Error('非本机上游必须使用 HTTPS。');
  }
  if (host.includes('%') || host.includes('..') || host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.localhost')) {
    throw new Error('上游地址不能指向内网或元数据服务。');
  }
  if (isIP(host) !== 0 && addressDenied(host, loopback)) throw new Error('上游地址不能使用内网 IP。');
  if (url.port && (!/^\d+$/.test(url.port) || Number(url.port) < 1 || Number(url.port) > 65535)) {
    throw new Error('上游端口无效。');
  }
  if (url.pathname.split('/').some((part) => part === '..' || part === '.')) throw new Error('上游路径无效。');
  return url.toString().replace(/\/$/, '');
}

export async function resolvePinned(raw, lookupFn = dnsLookup) {
  const href = assertSafeUpstream(raw);
  const url = new URL(href);
  const host = hostOf(url);
  const explicitLoopback = loopbackHosts.has(host);
  let records;
  if (host === 'localhost') {
    records = [{ address: '127.0.0.1', family: 4 }];
  } else if (explicitLoopback || isIP(host) !== 0) {
    const canonical = canonicalAddress(host);
    if (!canonical || addressDenied(host, explicitLoopback)) throw new Error('上游地址不能使用内网 IP。');
    records = [{ address: canonical.text, family: canonical.family }];
  } else {
    try {
      records = await lookupFn(host, { all: true, verbatim: true });
    } catch {
      throw new Error('上游地址无法确认不是内网。');
    }
  }
  if (!records?.length || records.some((record) => addressDenied(record.address, explicitLoopback))) {
    throw new Error('上游地址解析到了内网。');
  }
  const chosen = canonicalAddress(records[0].address);
  return {
    href,
    host,
    address: chosen.text,
    family: chosen.family,
    explicitLoopback,
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
  if (addressDenied(plan.address, plan.explicitLoopback)) throw new Error('上游地址解析到了内网。');
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
    const verifySocket = (socket) => {
      const verify = () => {
        if (!sameAddress(socket.remoteAddress, plan.address)) {
          request.destroy(Object.assign(new Error('上游连接地址与校验结果不一致。'), { code: 'pin-mismatch' }));
        }
      };
      if (socket.connecting) socket.once('connect', verify);
      else verify();
    };
    request.on('socket', verifySocket);
    const abort = () => request.destroy(Object.assign(new Error('请求已取消。'), { name: 'AbortError' }));
    init.signal?.addEventListener('abort', abort, { once: true });
    request.on('timeout', () => request.destroy(Object.assign(new Error('上游响应超时。'), { name: 'TimeoutError' })));
    request.on('error', reject);
    if (body) request.write(body);
    request.end();
  });
  return response;
}
