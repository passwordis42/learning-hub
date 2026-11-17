import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { createServer, request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { GAME_UPSTREAM, createHubServer, normalizeHubBase } from './hub.mjs';
import { listenAddress, remoteOptionsFromEnv } from './hub-guard.mjs';

const marker = 'LEAK_MARKER_should_not_be_served';

async function listen(server, host = '127.0.0.1', port = 0) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  return server.address().port;
}

async function fixture(hubBase) {
  const directory = await mkdtemp(path.join(tmpdir(), 'learning-hub-'));
  const dist = path.join(directory, 'dist');
  await mkdir(path.join(dist, 'ai'), { recursive: true });
  await mkdir(path.join(dist, 'nmr-from-zero', 'assets'), { recursive: true });
  await mkdir(path.join(dist, 'game'), { recursive: true });
  await writeFile(path.join(directory, 'leak.txt'), marker);
  await writeFile(path.join(dist, '.hub-base'), hubBase);
  await writeFile(path.join(dist, 'index.html'), '<h1>统一学习入口</h1><a href="ai/">AI Learn</a><a href="nmr-from-zero/">NMR Learn</a><a href="game/">Game Learn</a>');
  await writeFile(path.join(dist, 'ai', 'index.html'), '<h1>AI 学习图谱</h1>');
  await writeFile(path.join(dist, 'ai', 'app.js'), 'console.log("ai")');
  await writeFile(path.join(dist, 'nmr-from-zero', 'index.html'), '<h1>从零看懂核磁共振</h1>');
  await writeFile(path.join(dist, 'nmr-from-zero', 'assets', 'katex.woff2'), Buffer.from('font-bytes'));
  await writeFile(path.join(dist, 'game', 'index.html'), '<h1>游戏设计学习图谱</h1>');
  await writeFile(path.join(dist, 'game', '.nojekyll'), '');
  return { directory, dist };
}

test('loopback stays the listen address unless remote bind is explicit', () => {
  assert.equal(listenAddress({}), '127.0.0.1');
  assert.equal(listenAddress({ HUB_EXPOSURE: 'remote' }), '127.0.0.1');
  assert.equal(listenAddress({ HUB_EXPOSURE: 'remote', HUB_BIND: '0.0.0.0' }), '0.0.0.0');
  assert.throws(() => remoteOptionsFromEnv({ HUB_EXPOSURE: 'remote' }), /HUB_ADMIN_TOKEN/);
  assert.throws(() => remoteOptionsFromEnv({ HUB_EXPOSURE: 'remote', HUB_ADMIN_TOKEN: 'x'.repeat(32), HUB_PUBLIC_ORIGIN: 'http://learn.example' }), /https/);
  assert.equal(remoteOptionsFromEnv({
    HUB_EXPOSURE: 'remote',
    HUB_ADMIN_TOKEN: 'x'.repeat(32),
    HUB_PUBLIC_ORIGIN: 'https://learn.hub.test:8443',
    HUB_ALLOWED_HOSTS: 'learn.hub.test',
    HUB_TRUST_PROXY: '1',
  }).publicOrigin, 'https://learn.hub.test:8443');
});

test('hub base accepts only safe prefixes', () => {
  assert.equal(normalizeHubBase(undefined), '/');
  assert.equal(normalizeHubBase(''), '/');
  assert.equal(normalizeHubBase('/'), '/');
  assert.equal(normalizeHubBase('/learning-hub'), '/learning-hub/');
  assert.equal(normalizeHubBase('/learning-hub/'), '/learning-hub/');
  for (const value of ['/../', '/learning-hub/../../', 'https://evil.example/', '/learning-hub/%2e%2e/', '/a//b/']) {
    assert.throws(() => normalizeHubBase(value), value);
  }
});

test('static prefix, redirects, 404, traversal, and local assistant config', async () => {
  const root = await fixture('/');
  const nested = await fixture('/learning-hub/');
  process.env.ASSISTANT_CONFIG_PATH = path.join(root.directory, 'assistant-config.json');
  const hits = [];
  const stub = createServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      hits.push({
        method: request.method,
        url: request.url,
        host: request.headers.host,
        authorization: request.headers.authorization,
        origin: request.headers.origin,
        cookie: request.headers.cookie,
        type: request.headers['content-type'],
        body: Buffer.concat(chunks).toString('utf8'),
      });
      response.writeHead(200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Set-Cookie': 'session=secret',
      });
      response.end(JSON.stringify({ providers: [{ id: 'openai', configured: false }] }));
    });
  });
  const rootServer = createHubServer({ distDir: root.dist, hubBase: '/' });
  const nestedServer = createHubServer({ distDir: nested.dist, hubBase: '/learning-hub/' });
  let stubPort = 0;
  try {
    stubPort = await listen(stub, '127.0.0.1', 4173);
    assert.equal(stubPort, 4173);
    assert.equal(GAME_UPSTREAM, 'http://127.0.0.1:4173');
    const rootPort = await listen(rootServer);
    const nestedPort = await listen(nestedServer);
    const rootUrl = `http://127.0.0.1:${rootPort}`;
    const nestedUrl = `http://127.0.0.1:${nestedPort}`;
    const session = { 'X-Hub-Session': rootServer.hubSession };
    const nestedSession = { 'X-Hub-Session': nestedServer.hubSession };

    const home = await fetch(`${rootUrl}/`);
    assert.equal(home.status, 200);
    assert.equal(home.headers.get('set-cookie'), null);
    assert.match(await home.text(), /统一学习入口/);
    const navigated = await rawRequest(rootPort, {
      path: '/',
      headers: { Host: `127.0.0.1:${rootPort}`, 'Sec-Fetch-Dest': 'document', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Site': 'none' },
    });
    const cookie = String(navigated.headers['set-cookie'] || '');
    assert.equal(navigated.status, 200);
    assert.match(cookie, /hub_session=/);
    assert.match(cookie, /HttpOnly/);
    assert.equal(navigated.body.includes(rootServer.hubSession), false);
    const fromCookie = await fetch(`${rootUrl}/api/assistant-config`, { headers: { cookie: cookie.split(';')[0] } });
    assert.equal(fromCookie.status, 200);

    const slash = await fetch(`${rootUrl}/ai`, { redirect: 'manual' });
    assert.equal(slash.status, 308);
    assert.equal(slash.headers.get('location'), '/ai/');
    const nestedSlash = await fetch(`${nestedUrl}/learning-hub/nmr-from-zero`, { redirect: 'manual' });
    assert.equal(nestedSlash.status, 308);
    assert.equal(nestedSlash.headers.get('location'), '/learning-hub/nmr-from-zero/');
    const baseSlash = await fetch(`${nestedUrl}/learning-hub`, { redirect: 'manual' });
    assert.equal(baseSlash.status, 308);
    assert.equal(baseSlash.headers.get('location'), '/learning-hub/');

    const ai = await fetch(`${nestedUrl}/learning-hub/ai/`);
    assert.equal(ai.status, 200);
    assert.match(await ai.text(), /AI 学习图谱/);
    const font = await fetch(`${nestedUrl}/learning-hub/nmr-from-zero/assets/katex.woff2`);
    assert.equal(font.status, 200);
    assert.equal(font.headers.get('content-type'), 'font/woff2');
    assert.equal(Buffer.from(await font.arrayBuffer()).toString(), 'font-bytes');
    const outsidePrefix = await fetch(`${nestedUrl}/nmr-from-zero/assets/katex.woff2`);
    assert.equal(outsidePrefix.status, 404);

    const missing = await fetch(`${rootUrl}/ai/missing.js`);
    assert.equal(missing.status, 404);
    const missingBody = await missing.text();
    assert.equal(missingBody.includes('统一学习入口'), false);
    assert.equal(missingBody.includes(marker), false);
    const unknown = await fetch(`${rootUrl}/other`);
    assert.equal(unknown.status, 404);

    for (const target of [
      `${rootUrl}/ai/../leak.txt`,
      `${rootUrl}/ai/%2e%2e/leak.txt`,
      `${rootUrl}/ai/%2e%2e%2fleak.txt`,
      `${rootUrl}/ai/%252e%252e/leak.txt`,
      `${nestedUrl}/learning-hub/game/%2f..%2f..%2fleak.txt`,
      `${rootUrl}/.hub-base`,
    ]) {
      const response = await fetch(target, { redirect: 'manual' });
      const body = await response.text();
      assert.equal(body.includes(marker), false, target);
      assert.notEqual(response.status, 200, target);
    }

    const unsigned = await fetch(`${rootUrl}/api/assistant-config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ save: true, vendors: { openai: { apiKey: 'sk-unsigned', model: 'gpt-test' } } }),
    });
    assert.equal(unsigned.status, 401);
    const crossSite = await fetch(`${rootUrl}/api/assistant-config`, { headers: { ...session, Origin: 'https://evil.example' } });
    assert.equal(crossSite.status, 403);

    const status = await fetch(`${rootUrl}/api/status`, { headers: { ...session, Authorization: 'Bearer SUPER_SECRET_TOKEN', Cookie: 'a=b' } });
    assert.equal(status.status, 200);
    assert.equal(status.headers.get('access-control-allow-origin'), null);
    assert.equal(status.headers.get('set-cookie'), null);
    const statusBody = await status.json();
    assert.equal(statusBody.providers.every((item) => item.configured === false), true);
    assert.equal(JSON.stringify(statusBody).includes('SUPER_SECRET_TOKEN'), false);
    assert.equal(hits.length, 0);

    const assist = await fetch(`${rootUrl}/api/assist`, {
      method: 'POST',
      headers: { ...session, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: 'openai', mode: 'coach', week: 1, title: '检查',
        draft: '玩家选择一条路线。', rationale: '确认未配置时不会外呼。', evidence: '没有保存密钥。',
      }),
    });
    assert.equal(assist.status, 503);
    assert.match(await assist.text(), /还未在本地配置/);
    assert.equal(hits.length, 0);

    const wrongMethod = await fetch(`${rootUrl}/api/status`, { method: 'POST', headers: session });
    assert.equal(wrongMethod.status, 405);
    const query = await fetch(`${rootUrl}/api/status?next=http://evil.example`);
    assert.equal(query.status, 404);
    const tutor = await fetch(`${rootUrl}/api/tutor`, { headers: session });
    const tutorBody = await tutor.json();
    assert.equal(tutor.status, 200);
    assert.equal(tutorBody.providers.every((item) => item.configured === false), true);
    assert.equal(JSON.stringify(tutorBody).includes('apiKey'), false);

    const secret = 'sk-test-value-that-must-never-leak';
    const denied = await fetch(`${rootUrl}/api/assistant-config`, {
      method: 'PUT',
      headers: { ...session, 'Content-Type': 'application/json' },
      body: JSON.stringify({ vendors: { openai: { apiKey: secret, model: 'gpt-test' } } }),
    });
    assert.equal(denied.status, 400);
    const saved = await fetch(`${rootUrl}/api/assistant-config`, {
      method: 'PUT',
      headers: { ...session, 'Content-Type': 'application/json' },
      body: JSON.stringify({ save: true, vendors: { openai: { apiKey: secret, protocols: { ai: { model: 'ai-only-model' } } } } }),
    });
    const savedBody = await saved.json();
    assert.equal(saved.status, 200);
    assert.equal(JSON.stringify(savedBody).includes(secret), false);
    assert.equal(savedBody.vendors.find((item) => item.id === 'openai').protocols.ai.model, 'ai-only-model');
    const viewed = await (await fetch(`${rootUrl}/api/assistant-config`, { headers: session })).json();
    assert.equal(JSON.stringify(viewed).includes(secret), false);
    const statusAfter = await (await fetch(`${rootUrl}/api/status`, { headers: session })).json();
    assert.equal(statusAfter.providers.find((item) => item.id === 'openai').configured, false);
    assert.equal(JSON.stringify(statusAfter).includes(secret), false);
    const unclear = await fetch(`${rootUrl}/api/assistant-config/clear`, {
      method: 'POST',
      headers: { ...session, 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm: 'no' }),
    });
    const unclearBody = await unclear.json();
    assert.equal(unclear.status, 400);
    assert.match(unclearBody.effect, /不会读取或迁移旧的 .env/);
    assert.equal((await (await fetch(`${rootUrl}/api/assistant-config`, { headers: session })).json()).vendors.find((item) => item.id === 'openai').apiKeyConfigured, true);
    const nestedStatus = await fetch(`${nestedUrl}/learning-hub/api/status`, { headers: nestedSession });
    assert.equal(nestedStatus.status, 200);
    const statusTest = await fetch(`${nestedUrl}/learning-hub/api/assistant-config/test`, {
      method: 'POST',
      headers: { ...nestedSession, 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope: 'status', vendor: 'openai' }),
    });
    const statusTestBody = await statusTest.json();
    assert.equal(statusTest.status, 200);
    assert.equal(statusTestBody.ai.code, 'configured');
    assert.match(statusTestBody.ai.message, /没有向上游发送请求/);
    assert.equal(statusTestBody.ai.message.startsWith('服务可达'), false);
    assert.equal(statusTestBody.game.code, 'unconfigured');
    assert.equal(JSON.stringify(statusTestBody).includes(secret), false);
    const blockedModel = await fetch(`${rootUrl}/api/assistant-config/test`, {
      method: 'POST',
      headers: { ...session, 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope: 'model', vendor: 'openai' }),
    });
    assert.equal(blockedModel.status, 400);
    assert.match(await blockedModel.text(), /模型调用尚未执行/);
    const vendorClear = await fetch(`${rootUrl}/api/assistant-config/clear`, {
      method: 'POST',
      headers: { ...session, 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm: 'clear-vendor-configuration', vendor: 'deepseek' }),
    });
    assert.equal(vendorClear.status, 200);
    assert.equal((await (await fetch(`${rootUrl}/api/assistant-config`, { headers: session })).json()).vendors.find((item) => item.id === 'openai').apiKeyConfigured, true);
    const cleared = await fetch(`${rootUrl}/api/assistant-config/clear`, {
      method: 'POST',
      headers: { ...session, 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm: 'clear-assistant-configuration' }),
    });
    assert.equal(cleared.status, 200);
    assert.equal((await (await fetch(`${rootUrl}/api/assistant-config`, { headers: session })).json()).vendors.every((item) => item.apiKeyConfigured === false), true);
    await fetch(`${rootUrl}/api/assistant-config`, {
      method: 'PUT',
      headers: { ...session, 'Content-Type': 'application/json' },
      body: JSON.stringify({ save: true, vendors: { openai: { apiKey: secret, model: 'bound-model' } } }),
    });
    const rebound = await fetch(`${rootUrl}/api/assistant-config`, {
      method: 'PUT',
      headers: { ...session, 'Content-Type': 'application/json' },
      body: JSON.stringify({ save: true, vendors: { openai: { baseUrl: 'https://example.com/v1' } } }),
    });
    const reboundBody = await rebound.json();
    assert.equal(rebound.status, 409);
    assert.equal(reboundBody.code, 'upstream-key-rebinding');
    assert.equal(JSON.stringify(reboundBody).includes(secret), false);
    const kept = await (await fetch(`${rootUrl}/api/assistant-config`, { headers: session })).json();
    assert.equal(kept.vendors.find((item) => item.id === 'openai').enteredBaseUrl, '');
    assert.equal(kept.vendors.find((item) => item.id === 'openai').apiKeyConfigured, true);
  } finally {
    stub.close();
    rootServer.close();
    nestedServer.close();
    await rm(root.directory, { recursive: true, force: true });
    await rm(nested.directory, { recursive: true, force: true });
  }
});

function rawRequest(port, { method = 'GET', path: requestPath = '/api/status', headers = {}, body = '' } = {}) {
  return new Promise((resolve, reject) => {
    const request = httpRequest({ host: '127.0.0.1', port, method, path: requestPath, headers }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    request.on('error', reject);
    if (body) request.write(body);
    request.end();
  });
}

test('remote mode does not serve an anonymous key-bearing proxy', async () => {
  const root = await fixture('/');
  process.env.ASSISTANT_CONFIG_PATH = path.join(root.directory, 'assistant-config.json');
  const token = 'r'.repeat(40);
  const server = createHubServer({
    distDir: root.dist,
    hubBase: '/',
    exposure: 'remote',
    adminToken: token,
    publicOrigin: 'https://learn.example',
    allowedHosts: ['learn.example'],
    trustProxy: true,
  });
  try {
    const port = await listen(server);
    const base = { Host: 'learn.example', 'X-Forwarded-Proto': 'https', Origin: 'https://learn.example' };
    const anonymous = await rawRequest(port, { method: 'POST', path: '/api/assist', headers: { ...base, 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(anonymous.status, 401);
    assert.equal(anonymous.body.includes('sk-'), false);
    const plainHttp = await rawRequest(port, { headers: { ...base, 'X-Forwarded-Proto': 'http', 'X-Hub-Session': token } });
    assert.equal(plainHttp.status, 403);
    const otherHost = await rawRequest(port, { headers: { ...base, Host: 'evil.example', 'X-Hub-Session': token } });
    assert.equal(otherHost.status, 403);
    const otherOrigin = await rawRequest(port, { headers: { ...base, Origin: 'https://evil.example', 'X-Hub-Session': token } });
    assert.equal(otherOrigin.status, 403);
    const saved = await rawRequest(port, {
      method: 'PUT',
      path: '/api/assistant-config',
      headers: { ...base, 'X-Hub-Session': token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ save: true, vendors: { openai: { apiKey: 'sk-remote-test-value', model: 'remote-model' } } }),
    });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.includes('sk-remote-test-value'), false);
  } finally {
    server.close();
    await rm(root.directory, { recursive: true, force: true });
  }
});
