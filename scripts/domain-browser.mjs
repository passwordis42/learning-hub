import { spawn } from 'node:child_process';
import http from 'node:http';
import https from 'node:https';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
process.stderr.write('已废弃：scripts/domain-browser.mjs 仍按旧的托管管理口令和设置保存文案编写。它不能当作当前设置区的通过结果，也不计入本 PR 的测试计数。\n');
process.exit(2);
const rootUnused = root;
const outDir = '/opt/cursor/artifacts';
const hostName = 'learn.hub.test';
const adminToken = `domain-admin-${'a'.repeat(24)}`;
const vendorKey = 'sk-domain-browser-not-real';
const shots = [];
const checks = [];
const browserCalls = [];
const mockCalls = [];

function run(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, env, stdio: 'inherit' });
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`))));
  });
}

function hubEnv(extra) {
  const env = { ...process.env, ...extra, HUB_ADMIN_TOKEN: adminToken };
  for (const key of Object.keys(env)) {
    if (key === 'HUB_ADMIN_TOKEN') continue;
    if (/KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL/i.test(key)) delete env[key];
  }
  env.HUB_ADMIN_TOKEN = adminToken;
  return env;
}

function listen(server, port = 0) {
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server.address().port)));
}

const mock = http.createServer((request, response) => {
  const chunks = [];
  request.on('data', (chunk) => chunks.push(chunk));
  request.on('end', () => {
    mockCalls.push({
      origin: `http://127.0.0.1:${mockPort}`,
      path: request.url.split('?')[0],
      session: Boolean(request.headers.cookie?.includes('hub_session') || request.headers['x-hub-session']),
    });
    const finding = JSON.stringify({ findings: [{ focus: 'test', anchor: '' }] });
    const answer = request.url.includes('responses')
      ? { output: [{ type: 'message', content: [{ type: 'output_text', text: finding }] }] }
      : { choices: [{ message: { content: finding } }] };
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(answer));
  });
});
const mockPort = await listen(mock);

const certDir = path.join(tmpdir(), 'learn-hub-test-cert');
await mkdir(certDir, { recursive: true });
await new Promise((resolve, reject) => {
  const child = spawn('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
    '-keyout', path.join(certDir, 'key.pem'),
    '-out', path.join(certDir, 'cert.pem'),
    '-subj', `/CN=${hostName}`,
    '-addext', `subjectAltName=DNS:${hostName}`,
  ], { stdio: 'inherit' });
  child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`openssl exited ${code}`))));
});
const tls = {
  key: await readFile(path.join(certDir, 'key.pem')),
  cert: await readFile(path.join(certDir, 'cert.pem')),
};

function startHub(env) {
  const child = spawn(process.execPath, ['server/hub.mjs'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stderr.on('data', (chunk) => { child.hubLog = `${child.hubLog || ''}${chunk}`; });
  child.stdout.on('data', (chunk) => { child.hubLog = `${child.hubLog || ''}${chunk}`; });
  return child;
}

function proxyTo(hubPort) {
  return https.createServer(tls, (request, response) => {
    const headers = { ...request.headers, 'x-forwarded-proto': 'https' };
    delete headers['transfer-encoding'];
    const upstream = http.request({
      host: '127.0.0.1',
      port: hubPort,
      method: request.method,
      path: request.url,
      headers,
    }, (incoming) => {
      for (const [key, value] of Object.entries(incoming.headers)) {
        if (value !== undefined) response.setHeader(key, value);
      }
      response.writeHead(incoming.statusCode);
      incoming.pipe(response);
    });
    upstream.on('error', () => {
      if (!response.headersSent) response.writeHead(502);
      response.end();
    });
    request.pipe(upstream);
  });
}

async function waitFor(url) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { headers: { 'X-Forwarded-Proto': 'https', Host: hostName } });
      if (response.status < 500) return;
    } catch { /* retry */ }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`timeout ${url}`);
}

const browser = await chromium.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', `--host-resolver-rules=MAP ${hostName} 127.0.0.1`],
});
const processes = [];
const proxies = [];
try {
  for (const [base, hubPort, tlsPort] of [['/', 8101, 8443], ['/learning-hub/', 8102, 8444]]) {
    const label = base === '/' ? 'root' : 'nested';
    await run(process.execPath, ['scripts/build.mjs'], hubEnv({ HUB_BASE: base, HUB_EXPOSURE: 'loopback' }));
    const origin = `https://${hostName}:${tlsPort}`;
    const configPath = path.join(tmpdir(), `domain-browser-${hubPort}.json`);
    await rm(configPath, { force: true });
    const hub = startHub(hubEnv({
      HUB_BASE: base,
      PORT: String(hubPort),
      HUB_EXPOSURE: 'remote',
      HUB_TRUST_PROXY: '1',
      HUB_PUBLIC_ORIGIN: origin,
      HUB_ALLOWED_HOSTS: hostName,
      ASSISTANT_CONFIG_PATH: configPath,
    }));
    processes.push(hub);
    try {
      await waitFor(`http://127.0.0.1:${hubPort}${base}`);
    } catch (error) {
      throw new Error(`${error.message}\n${hub.hubLog || ''}`);
    }
    const proxy = proxyTo(hubPort);
    await listen(proxy, tlsPort);
    proxies.push(proxy);

    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (!url.pathname.includes('/api/') && url.host !== '127.0.0.1:4173') return;
      const entry = { label, origin: url.origin, path: url.pathname, session: false };
      browserCalls.push(entry);
      request.allHeaders().then((headers) => {
        entry.session = (headers.cookie || '').includes('hub_session=');
      }).catch(() => {});
    });

    await page.goto(`${origin}${base}?view=settings`, { waitUntil: 'domcontentloaded' });
    await page.locator('#settings-admin-dialog').waitFor({ state: 'visible' });
    await page.locator('#settings-admin-token').fill(adminToken);
    await page.locator('#settings-admin-submit').click();
    await page.locator('#settings-admin-dialog').waitFor({ state: 'hidden' });
    await page.waitForFunction(() => !document.getElementById('settings-save').disabled);
    if (await page.locator('#settings-rebind-dialog').isVisible()) await page.locator('#settings-rebind-cancel').click();
    await page.locator('#settings-model').fill('domain-browser-model');
    await page.locator('#settings-key').fill(vendorKey);
    await page.locator('#settings-address').fill(`http://127.0.0.1:${mockPort}/v1`);
    await page.locator('#settings-save').click();
    try {
      await page.getByText('配置已保存').waitFor();
    } catch (error) {
      const status = await page.locator('#settings-status').innerText().catch(() => '');
      const result = await page.locator('#settings-result').innerText().catch(() => '');
      throw new Error(`${error.message}\nstatus=${status}\nresult=${result}`);
    }

    const before = mockCalls.length;
    await page.goto(`${origin}${base}?view=reader&course=game&module=game-coach`, { waitUntil: 'domcontentloaded' });
    const frame = page.frameLocator('#lesson-frame');
    await frame.locator('#coach-draft').waitFor();
    let status;
    const statusDeadline = Date.now() + 5000;
    while (Date.now() < statusDeadline) {
      status = browserCalls.find((item) => item.label === label && item.path.endsWith('/api/status') && item.session);
      if (status) break;
      await page.waitForTimeout(100);
    }
    if (!status || status.origin !== origin) throw new Error(`status ${JSON.stringify(browserCalls.filter((item) => item.path.endsWith('/api/status')))}`);
    await frame.locator('#coach-draft').fill('玩家先选一条路，再看电量够不够走回去。');
    await frame.locator('#coach-rationale').fill('这条规则让玩家用有限电量做选择。');
    await frame.locator('#coach-evidence').fill('试了一次主通道，电量在第五格耗尽。');
    await frame.locator('#checkpoint-form').getByRole('button', { name: '确认是我的设计并保存' }).click();
    await frame.locator('#coach-provider').selectOption('openai');
    await frame.locator('#ask-ai').click();
    await frame.getByText('试玩时你准备记录什么？').waitFor({ timeout: 20000 });
    let assist;
    const assistDeadline = Date.now() + 5000;
    while (Date.now() < assistDeadline) {
      assist = browserCalls.find((item) => item.label === label && item.path.endsWith('/api/assist') && item.session);
      if (assist) break;
      await page.waitForTimeout(100);
    }
    if (!assist || assist.origin !== origin) throw new Error(`assist ${JSON.stringify(browserCalls.filter((item) => item.path.endsWith('/api/assist')))}`);
    await page.screenshot({ path: path.join(outDir, `domain_game_ask_${label}.png`) });
    shots.push(path.join(outDir, `domain_game_ask_${label}.png`));

    const gameFrame = page.frames().find((item) => item.url().includes('/game/'));
    await gameFrame.evaluate(() => { location.hash = '#plan/01?step=check'; });
    await frame.locator('#reason-judgment').waitFor();
    await frame.locator('#reason-judgment').fill('玩家会先选看起来更短的那条路。');
    await frame.locator('#reason-evidence').fill('纸面规则里主通道格子更少。');
    await frame.locator('#reason-verification').fill('如果电量不够，他们会改走另一条。');
    await frame.locator('.reasoning-form').getByRole('button', { name: '提交我的判断' }).click();
    await frame.getByText('用我的首答请 AI 追问').click();
    await frame.getByRole('button', { name: '检查本地模型连接' }).click();
    await frame.locator('.followup-form select').waitFor();
    await frame.locator('.followup-form select').selectOption('openai');
    const followMark = mockCalls.length;
    await frame.locator('.followup-form').getByRole('button', { name: '发送我的记录，请 AI 追问' }).click();
    await frame.locator('.followup-questions').getByText('试玩时你准备记录什么？').waitFor({ timeout: 20000 });
    const follow = mockCalls.slice(followMark).find((item) => item.path.includes('/chat/completions'));
    if (!follow || follow.session) throw new Error(`follow-up mock ${JSON.stringify(mockCalls.slice(followMark))}`);
    await page.screenshot({ path: path.join(outDir, `domain_game_followup_${label}.png`) });
    shots.push(path.join(outDir, `domain_game_followup_${label}.png`));
    if (mockCalls.slice(before).some((item) => item.session)) throw new Error('mock saw a hub session');
    checks.push({ name: `${label} public-host game status, answer, and follow-up`, ok: true });
    await context.close();
  }
} finally {
  await browser.close();
  for (const proxy of proxies) proxy.close();
  for (const child of processes) child.kill('SIGTERM');
  mock.close();
}

const leaked = [...browserCalls, ...mockCalls].filter((item) => item.origin?.includes('127.0.0.1:4173') || (item.path?.startsWith('http://127.0.0.1:4173')));
const report = [
  '# Simulated public-host browser regression',
  '',
  'This is not a public deployment. Chrome mapped `learn.hub.test` to 127.0.0.1 with `--host-resolver-rules`. TLS was a one-day self-signed certificate for that name, and the browser was started with `ignoreHTTPSErrors`. A local HTTPS reverse proxy added `X-Forwarded-Proto: https` and forwarded to the hub on 127.0.0.1. The hub ran with `HUB_EXPOSURE=remote`, an admin token only in the test process, and `HUB_PUBLIC_ORIGIN` set to the test origin. The model upstream was a local HTTP mock, not a vendor.',
  '',
  ...checks.map((item) => `- ${item.ok ? 'PASS' : 'FAIL'} ${item.name}`),
  '',
  '## Browser requests',
  '',
  ...browserCalls.filter((item) => item.path.endsWith('/api/status') || item.path.endsWith('/api/assist')).map((item) => `- \`${item.origin}${item.path}\` session cookie ${item.session ? 'present' : 'absent'}`),
  '',
  '## Mock upstream requests',
  '',
  ...mockCalls.map((item) => `- \`${item.origin}${item.path}\` hub session ${item.session ? 'LEAKED' : 'absent'}`),
  '',
  leaked.length ? `Unexpected 4173 targets: ${leaked.length}` : 'No browser or mock request targeted 127.0.0.1:4173.',
  '',
  '## Screenshots',
  '',
  ...shots.map((file) => `- \`${file}\``),
].join('\n');
await mkdir(outDir, { recursive: true });
await writeFile(path.join(outDir, 'domain-browser-report.md'), report);
await writeFile(path.join(outDir, 'domain-browser-requests.json'), JSON.stringify({ browserCalls, mockCalls }, null, 2));
process.stdout.write(`${report}\n`);
if (!checks.length || checks.some((item) => !item.ok) || mockCalls.some((item) => item.session)) process.exit(1);
