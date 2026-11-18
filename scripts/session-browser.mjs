import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
process.stderr.write('已废弃：scripts/session-browser.mjs 仍按旧的托管设置和 #settings-test 文案编写。它不能当作当前设置区的通过结果，也不计入本 PR 的测试计数。\n');
process.exit(2);
const rootUnused = root;
const outDir = '/opt/cursor/artifacts';
const secret = 'sk-session-browser-not-real';
const shots = [];
const checks = [];

function run(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, env, stdio: 'inherit' });
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`))));
  });
}

function start(command, args, env) {
  return spawn(command, args, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
}

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

async function waitFor(url) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).ok) return;
    } catch { /* retry */ }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`timeout ${url}`);
}

async function shot(page, name) {
  const file = path.join(outDir, `session_${name}.png`);
  await page.screenshot({ path: file });
  shots.push(file);
}

function record(name, ok, detail = '') {
  checks.push({ name, ok, detail });
  if (!ok) throw new Error(`${name}: ${detail}`);
}

const upstream = [];
const mock = createServer((request, response) => {
  const chunks = [];
  request.on('data', (chunk) => chunks.push(chunk));
  request.on('end', () => {
    upstream.push({
      url: request.url,
      method: request.method,
      authorization: request.headers.authorization || '',
      cookie: request.headers.cookie || '',
      session: request.headers['x-hub-session'] || '',
    });
    const body = request.url.includes('responses')
      ? { output: [{ type: 'message', content: [{ type: 'output_text', text: '模拟回复' }] }] }
      : { choices: [{ message: { content: '模拟游戏回复' } }] };
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(body));
  });
});
const mockPort = await listen(mock);
const mockBase = `http://127.0.0.1:${mockPort}/v1`;

function cleanEnv(extra) {
  const env = { ...process.env, ...extra };
  for (const key of Object.keys(env)) if (/KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL/i.test(key)) delete env[key];
  return env;
}

const browser = await chromium.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const servers = [];
try {
  for (const [base, port] of [['/', 8095], ['/learning-hub/', 8096]]) {
    await run(process.execPath, ['scripts/build.mjs'], cleanEnv({ HUB_BASE: base }));
    const configPath = path.join(tmpdir(), `session-browser-${port}.json`);
    const hub = start(process.execPath, ['server/hub.mjs'], cleanEnv({
      HUB_BASE: base,
      PORT: String(port),
      ASSISTANT_CONFIG_PATH: configPath,
    }));
    servers.push(hub);
    const origin = `http://127.0.0.1:${port}`;
    await waitFor(`${origin}${base}`);
    const label = base === '/' ? 'root' : 'nested';
    const context = await browser.newContext();
    const page = await context.newPage();
    const hubCalls = [];
    page.on('request', (request) => {
      const url = request.url();
      if (url.startsWith(origin) && url.includes('/api/')) {
        hubCalls.push({ url, cookie: request.headers().cookie || '' });
      }
    });
    await page.route('https://evil.example/**', (route) => {
      const cookie = route.request().headers().cookie || '';
      hubCalls.push({ url: route.request().url(), cookie, external: true });
      return route.fulfill({ status: 400, contentType: 'application/json', body: '{"error":"external"}' });
    });

    if (label === 'root') {
      const before = upstream.length;
      await page.goto(`${origin}/?view=settings`, { waitUntil: 'domcontentloaded' });
      await page.getByText('高级设置').click();
      await page.locator('#settings-token').fill('too-short');
      await page.locator('#settings-save').click();
      await page.getByText('访问口令至少需要 32 个字符').waitFor();
      if (await page.locator('#settings-save').isDisabled()) throw new Error('save stayed disabled after short token');
      await shot(page, 'short_token');
      await page.locator('#settings-token').fill('');
      await page.locator('#settings-model').fill('hub-browser-model');
      await page.locator('#settings-key').fill(secret);
      await page.locator('#settings-address').fill(mockBase);
      await page.locator('#settings-save').click();
      await page.getByText('配置已保存').waitFor();
      await page.locator('#settings-test').click();
      await page.getByText('AI 学伴：只核对已保存的密钥和模型。没有向上游发送请求，不能当作服务可达。').waitFor();
      await page.getByText('游戏助手：只核对已保存的密钥和模型。没有向上游发送请求，不能当作服务可达。').waitFor();
      if (upstream.length !== before) throw new Error(`status test contacted upstream ${upstream.length - before} times`);
      await shot(page, 'status_config_only');
      record('short token returns 400 and can be retried', true);
      record('status check does not contact the mock', true);
    } else {
      await page.goto(`${origin}${base}?view=settings`, { waitUntil: 'domcontentloaded' });
      await page.locator('#settings-model').fill('hub-browser-model');
      await page.locator('#settings-key').fill(secret);
      await page.locator('#settings-address').fill(mockBase);
      await page.locator('#settings-save').click();
      await page.getByText('配置已保存').waitFor();
    }

    await page.goto(origin + base, { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      localStorage.setItem('learning-atlas:day-one-reflection', JSON.stringify({ rows: '3', reason: '重复行只留一条', evidence: '样本前两行' }));
      localStorage.setItem('learning-atlas:day-one-scope', 'true');
    });
    await page.goto(new URL(`${base}?view=reader&course=ai&module=ai-tutor`, origin).href, { waitUntil: 'domcontentloaded' });
    const tutor = page.frameLocator('#lesson-frame');
    await tutor.getByText('已使用本机统一入口').waitFor();
    const tutorCall = hubCalls.find((item) => item.url.includes('/api/tutor'));
    if (!tutorCall?.cookie.includes('hub_session=')) throw new Error(`tutor call missed session ${JSON.stringify(tutorCall)}`);
    const mark = upstream.length;
    await tutor.locator('textarea').first().fill('请只回复模拟二字。');
    await tutor.getByRole('button', { name: '向导师提问' }).click();
    await tutor.getByText('模拟回复').waitFor({ timeout: 20000 });
    const aiHit = upstream.slice(mark).find((item) => item.url.includes('/responses'));
    if (!aiHit) throw new Error('mock did not receive the AI request');
    if (aiHit.cookie.includes('hub_session') || aiHit.session) throw new Error(`upstream saw the hub session ${JSON.stringify(aiHit)}`);
    if (!aiHit.authorization.includes(secret)) throw new Error('upstream did not receive the saved key');
    await shot(page, `ai_mock_${label}`);
    record(`${label} AI iframe reaches the mock with a session and without leaking it`, true);

    hubCalls.length = 0;
    await page.goto(new URL(`${base}?view=reader&course=game&module=game-coach`, origin).href, { waitUntil: 'domcontentloaded' });
    const game = page.frameLocator('#lesson-frame');
    await game.locator('#coach-draft').waitFor();
    const statusCall = hubCalls.find((item) => item.url.includes('/api/status'));
    if (!statusCall?.cookie.includes('hub_session=')) throw new Error(`game status missed session ${JSON.stringify(statusCall)}`);
    if (label === 'root') {
      const gameMark = upstream.length;
      await game.locator('#coach-draft').fill('玩家先选一条路，再看电量够不够。');
      await game.locator('#coach-rationale').fill('这条规则让玩家用有限电量做选择。');
      await game.locator('#coach-evidence').fill('试了一次主通道，电量在第五格耗尽。');
      await game.locator('#checkpoint-form').getByRole('button', { name: '确认是我的设计并保存' }).click();
      await game.locator('#coach-provider').selectOption('openai');
      await game.locator('#ask-ai').click();
      let gameHit;
      const gameDeadline = Date.now() + 20000;
      while (Date.now() < gameDeadline) {
        gameHit = upstream.slice(gameMark).find((item) => item.url.includes('/chat/completions'));
        if (gameHit) break;
        await page.waitForTimeout(200);
      }
      if (!gameHit) throw new Error('mock did not receive the game request');
      if (gameHit.cookie.includes('hub_session') || gameHit.session) throw new Error('game upstream saw the hub session');
      await shot(page, 'game_mock_root');
      record('root game iframe reaches the mock without leaking the session', true);
    } else {
      record('nested game status uses the hub session', true);
    }

    if (label === 'root') {
      await page.goto(`${origin}/ai/#tutor`, { waitUntil: 'domcontentloaded' });
      await page.getByText('设置模型连接').click();
      await page.locator('input[placeholder*="8787"]').fill('https://evil.example/api/tutor');
      await page.getByRole('button', { name: '检查连接' }).click();
      await page.getByText('external').waitFor();
      const external = hubCalls.find((item) => item.external);
      if (!external) throw new Error('standalone did not call the external tutor');
      if (external.cookie.includes('hub_session')) throw new Error(`external tutor received the hub session ${external.cookie}`);
      await shot(page, 'standalone_external');
      record('standalone external tutor does not receive the hub session', true);

      const anonymous = await fetch(`${origin}/api/assistant-config`);
      if (anonymous.status !== 401) throw new Error(`missing session status ${anonymous.status}`);
      const navigated = await fetch(`${origin}/`, { headers: { 'Sec-Fetch-Dest': 'document', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Site': 'none' } });
      const cookie = navigated.headers.get('set-cookie') || '';
      const denied = await fetch(`${origin}/api/assist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example', cookie: cookie.split(';')[0] },
        body: '{}',
      });
      if (denied.status !== 403) throw new Error(`cross origin status ${denied.status}`);
      record('missing session and cross-origin calls stay rejected', true);

      await page.goto(`${origin}/?view=settings`, { waitUntil: 'domcontentloaded' });
      await page.locator('#settings-address').fill('http://127.0.0.1:9/v1');
      await page.locator('#settings-save').click();
      await page.locator('#settings-rebind-dialog').waitFor({ state: 'visible' });
      await page.locator('#settings-rebind-clear').click();
      await page.getByText('配置已保存').waitFor();
      const after = upstream.length;
      await page.goto(new URL(`${base}?view=reader&course=ai&module=ai-tutor`, origin).href, { waitUntil: 'domcontentloaded' });
      await page.frameLocator('#lesson-frame').locator('textarea').first().fill('清除后不应再把旧密钥送出。');
      await page.frameLocator('#lesson-frame').getByRole('button', { name: '向导师提问' }).click();
      await page.waitForTimeout(1000);
      if (upstream.length !== after) throw new Error('cleared key was still sent upstream');
      await shot(page, 'rebind_cleared');
      record('changing the upstream clears the key instead of reusing it', true);
    }
    await context.close();
  }
} finally {
  await browser.close();
  for (const server of servers) server.kill('SIGTERM');
  mock.close();
}

const report = [
  '# Browser session regression',
  '',
  'Simulated local upstream only. No real vendor and no external model call.',
  '',
  ...checks.map((item) => `- ${item.ok ? 'PASS' : 'FAIL'} ${item.name}`),
  '',
  '## Screenshots',
  '',
  ...shots.map((file) => `- \`${file}\``),
  '',
  `Mock requests recorded: ${upstream.length}. None included a hub session cookie.`,
].join('\n');
await mkdir(outDir, { recursive: true });
await writeFile(path.join(outDir, 'session-browser-report.md'), report);
process.stdout.write(`${report}\n`);
if (checks.some((item) => !item.ok)) process.exit(1);
