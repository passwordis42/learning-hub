import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { GAME_UPSTREAM, createHubServer, normalizeHubBase } from './hub.mjs';

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

test('static prefix, redirects, 404, traversal, and fixed game API proxy', async () => {
  const root = await fixture('/');
  const nested = await fixture('/learning-hub/');
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

    const home = await fetch(`${rootUrl}/`);
    assert.equal(home.status, 200);
    assert.match(await home.text(), /统一学习入口/);

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

    const status = await fetch(`${rootUrl}/api/status`, { headers: { Authorization: 'Bearer SUPER_SECRET_TOKEN', Origin: 'https://evil.example', Cookie: 'a=b' } });
    assert.equal(status.status, 200);
    assert.equal(status.headers.get('access-control-allow-origin'), null);
    assert.equal(status.headers.get('set-cookie'), null);
    const statusBody = await status.json();
    assert.equal(statusBody.providers[0].configured, false);
    assert.equal(JSON.stringify(statusBody).includes('SUPER_SECRET_TOKEN'), false);
    assert.equal(hits.at(-1).url, '/api/status');
    assert.equal(hits.at(-1).host, '127.0.0.1:4173');
    assert.equal(hits.at(-1).authorization, undefined);
    assert.equal(hits.at(-1).origin, undefined);
    assert.equal(hits.at(-1).cookie, undefined);

    const assist = await fetch(`${rootUrl}/api/assist`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer SUPER_SECRET_TOKEN' },
      body: JSON.stringify({ provider: 'openai' }),
    });
    assert.equal(assist.status, 200);
    assert.equal(hits.at(-1).method, 'POST');
    assert.equal(hits.at(-1).url, '/api/assist');
    assert.equal(hits.at(-1).authorization, undefined);
    assert.equal(hits.at(-1).body.includes('openai'), true);

    const wrongMethod = await fetch(`${rootUrl}/api/status`, { method: 'POST' });
    assert.equal(wrongMethod.status, 405);
    assert.equal(wrongMethod.headers.get('allow'), 'GET');
    const query = await fetch(`${rootUrl}/api/status?next=http://evil.example`);
    assert.equal(query.status, 404);
    const tutor = await fetch(`${rootUrl}/api/tutor`);
    assert.equal(tutor.status, 404);
    assert.equal(hits.some((hit) => hit.url !== '/api/status' && hit.url !== '/api/assist'), false);

    stub.close();
    const down = await fetch(`${rootUrl}/api/status`);
    assert.equal(down.status, 503);
    assert.match(await down.text(), /127\.0\.0\.1:4173/);
  } finally {
    stub.close();
    rootServer.close();
    nestedServer.close();
    await rm(root.directory, { recursive: true, force: true });
    await rm(nested.directory, { recursive: true, force: true });
  }
});
