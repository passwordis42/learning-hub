import { spawn } from 'node:child_process';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = '/opt/cursor/artifacts';
const shots = [];
const checks = [];

function assertNode() {
  const major = Number(process.versions.node.split('.')[0]);
  if (major !== 24) {
    process.stderr.write(`learning-hub 需要 Node 24，当前是 ${process.versions.node}。\n`);
    process.exit(1);
  }
}

function cleanEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  for (const key of Object.keys(env)) {
    if (/KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL/i.test(key)) delete env[key];
  }
  return env;
}

function run(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, stdio: 'inherit' });
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${command} ${args.join(' ')} exited ${code}`))));
  });
}

function start(command, args, options) {
  const child = spawn(command, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', (chunk) => { log += chunk; });
  child.stderr.on('data', (chunk) => { log += chunk; });
  return { child, output: () => log };
}

async function waitFor(url, proc) {
  const deadline = Date.now() + 15000;
  let last = '';
  while (Date.now() < deadline) {
    if (proc.child.exitCode != null) throw new Error(proc.output());
    try {
      const response = await fetch(url);
      if (response.ok) return;
      last = `${response.status}`;
    } catch (error) {
      last = error.message;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`timeout ${url}: ${last}\n${proc.output()}`);
}

async function record(name, fn) {
  try {
    await fn();
    checks.push({ name, ok: true });
  } catch (error) {
    checks.push({ name, ok: false, error: error.message });
  }
}

async function shot(page, name) {
  const file = path.join(artifacts, name);
  await page.screenshot({ path: file });
  shots.push(file);
}

async function fontUrls(dist, base) {
  const directory = path.join(dist, 'nmr-from-zero', 'assets');
  const names = await readdir(directory);
  const urls = [];
  for (const name of names.filter((item) => item.endsWith('.css'))) {
    const css = await readFile(path.join(directory, name), 'utf8');
    for (const match of css.matchAll(/url\(([^)]+)\)/g)) {
      const value = match[1].replace(/["']/g, '');
      if (!/\.(?:woff2?|ttf)(?:$|\?)/.test(value)) continue;
      const absolute = value.startsWith('/')
        ? value.split('?')[0]
        : new URL(value, `http://127.0.0.1${base}nmr-from-zero/assets/${name}`).pathname;
      urls.push(absolute);
    }
  }
  return urls;
}

async function exercise(browser, origin, base, viewport, label) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const requests = [];
  page.on('request', (request) => requests.push(request.url()));
  const home = new URL(base, origin).href;
  await page.goto(home, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('h1');
  if (label === 'desktop-root') await shot(page, 'hub_home_desktop.png');
  if (label === 'phone-root') await shot(page, 'hub_home_phone.png');
  if (label === 'desktop-nested') await shot(page, 'hub_home_nested_desktop.png');

  await page.waitForFunction(() => document.querySelectorAll('[role="img"][aria-label*="待开发"]').length === 4);
  await page.goto(new URL(`${base}?view=reader&course=nmr&module=nmr-1-1`, origin).href, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => {
    const frame = document.querySelector('#lesson-frame');
    return frame && !frame.hidden && frame.contentDocument?.body?.innerText.includes('仪器里有什么');
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => location.search.includes('module=nmr-1-1') && document.querySelector('#lesson-frame')?.contentDocument?.body?.innerText.includes('仪器里有什么'));
  const chromeHidden = await page.evaluate(() => {
    const frame = document.querySelector('#lesson-frame').contentDocument;
    const sidebar = frame.querySelector('.sidebar');
    return !sidebar || getComputedStyle(sidebar).display === 'none';
  });
  if (!chromeHidden) throw new Error('embedded lesson still shows its own sidebar');
  if (label === 'desktop-root' || label === 'phone-root') await shot(page, label === 'phone-root' ? 'reader_nmr_phone.png' : 'reader_nmr_desktop.png');
  await page.locator('#return-islands').click();
  await page.waitForFunction(() => document.body.innerText.includes('向好奇的方向'));
  if (label === 'desktop-root') await shot(page, 'hub_back_desktop.png');

  requests.length = 0;
  await page.goto(new URL(`${base}ai/#week-01`, origin).href, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.title.includes('第 1 周') && !document.body.innerText.includes('正在打开站内课程'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.title.includes('第 1 周') && location.hash === '#week-01' && !document.body.innerText.includes('正在打开站内课程'));
  const aiRequests = requests.filter((url) => url.startsWith(origin));
  if (aiRequests.some((url) => url.includes('/game/') || url.includes('/nmr-from-zero/'))) {
    throw new Error(`AI page requested another site: ${aiRequests.join(' ')}`);
  }
  if (label === 'desktop-root') await shot(page, 'ai_week_refresh_desktop.png');

  requests.length = 0;
  await page.goto(new URL(`${base}nmr-from-zero/#/learn/1-1`, origin).href, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.title.includes('·') && document.title.includes('从零看懂核磁共振'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => location.hash.startsWith('#/learn/1-1') && document.title.includes('·'));
  if (label === 'phone-root') await shot(page, 'nmr_lesson_phone.png');
  if (viewport.width < 800) {
    await page.locator('.menu-toggle').click();
    await page.waitForSelector('.sidebar.mobile-open');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.sidebar.mobile-open'));
  }
  if (label === 'desktop-nested') await shot(page, 'nmr_lesson_nested_desktop.png');

  await page.goto(new URL(`${base}game/#plan/01`, origin).href, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => location.hash.startsWith('#plan/01') && document.body.innerText.includes('周'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => location.hash.startsWith('#plan/01') && document.querySelector('#lesson h2'));
  if (label === 'desktop-root') await shot(page, 'game_plan_refresh_desktop.png');

  await page.goto(new URL(`${base}ai/`, origin).href);
  await page.evaluate(() => localStorage.setItem('learning-atlas:chapters', '[1]'));
  await page.goto(new URL(`${base}nmr-from-zero/`, origin).href);
  await page.evaluate(() => localStorage.setItem('nmr-from-zero.progress.v2', '{"version":2}'));
  await page.goto(new URL(`${base}game/`, origin).href);
  await page.evaluate(() => {
    localStorage.setItem('game-design-atlas:learning:v1', '{}');
    localStorage.setItem('game-design-atlas:resume:v1', '1');
    localStorage.setItem('game-design-atlas:experiments:v1', '[]');
  });
  const stored = await page.evaluate(async () => ({
    keys: Object.keys(localStorage).sort(),
    databases: 'databases' in indexedDB ? (await indexedDB.databases()).map((item) => item.name) : [],
    caches: await caches.keys(),
  }));
  const foreign = stored.keys.filter((key) => !key.startsWith('learning-atlas:') && !key.startsWith('nmr-from-zero.') && !key.startsWith('game-design-atlas:'));
  if (foreign.length || !stored.keys.includes('learning-atlas:chapters') || !stored.keys.includes('nmr-from-zero.progress.v2') || !stored.keys.includes('game-design-atlas:learning:v1')) {
    throw new Error(`storage keys ${stored.keys.join(',')}`);
  }
  if (stored.databases.length || stored.caches.length) {
    throw new Error(`unexpected web storage ${JSON.stringify(stored)}`);
  }
  await context.close();
}

assertNode();
await mkdir(artifacts, { recursive: true });
await mkdir(path.join(root, 'test-results'), { recursive: true });

const browser = await chromium.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const processes = [];
try {
  const game = start(process.execPath, ['server/index.mjs'], {
    cwd: path.join(root, 'sites/game-design-atlas'),
    env: cleanEnv({ PORT: '4173' }),
  });
  processes.push(game);
  await waitFor('http://127.0.0.1:4173/api/status', game);
  const tutor = start(process.execPath, ['server/index.mjs'], {
    cwd: path.join(root, 'sites/ai-learning-atlas'),
    env: cleanEnv({ TUTOR_HOST: '127.0.0.1', TUTOR_PORT: '8787' }),
  });
  processes.push(tutor);
  await waitFor('http://127.0.0.1:8787/api/tutor', tutor);

  for (const [base, port, labels] of [
    ['/', 8091, [['desktop /', { width: 1280, height: 800 }, 'desktop-root'], ['phone /', { width: 390, height: 844 }, 'phone-root']]],
    ['/learning-hub/', 8092, [['desktop /learning-hub/', { width: 1280, height: 800 }, 'desktop-nested'], ['phone /learning-hub/', { width: 390, height: 844 }, 'phone-nested']]],
  ]) {
    await run(process.execPath, ['scripts/build.mjs'], { cwd: root, env: cleanEnv({ HUB_BASE: base }) });
    const urls = await fontUrls(path.join(root, 'dist'), base);
    if (!urls.length) throw new Error(`no font urls for ${base}`);
    for (const url of urls) {
      if (!url.includes(`${base}nmr-from-zero/`)) throw new Error(`font ${url} is outside ${base}`);
    }
    const server = start(process.execPath, ['server/hub.mjs'], {
      cwd: root,
      env: cleanEnv({
        HUB_BASE: base,
        PORT: String(port),
        ASSISTANT_CONFIG_PATH: path.join(tmpdir(), `learning-hub-assistant-${process.pid}-${port}.json`),
      }),
    });
    processes.push(server);
    const origin = `http://127.0.0.1:${port}`;
    await waitFor(`${origin}${base}`, server);
    for (const url of urls) {
      const response = await fetch(`${origin}${url}`);
      if (!response.ok) throw new Error(`font ${url} returned ${response.status}`);
      const type = response.headers.get('content-type') || '';
      if (!type.startsWith('font/')) throw new Error(`font ${url} type ${type}`);
    }
    const missing = await fetch(`${origin}${base}ai/does-not-exist.js`);
    if (missing.status !== 404) throw new Error(`expected real 404, got ${missing.status}`);
    const slash = await fetch(`${origin}${base.replace(/\/$/, '')}/game`.replace('//game', '/game'), { redirect: 'manual' });
    if (slash.status !== 308 || slash.headers.get('location') !== `${base}game/`) {
      throw new Error(`slash redirect ${slash.status} ${slash.headers.get('location')}`);
    }
    for (const [name, viewport, label] of labels) {
      await record(name, () => exercise(browser, origin, base, viewport, label));
    }
    if (base === '/') {
      await record('game API stays honest without keys', async () => {
        const status = await fetch(`${origin}/api/status`);
        const body = await status.json();
        if (status.status !== 200 || body.providers.some((item) => item.configured || item.key)) throw new Error(JSON.stringify(body));
        const started = Date.now();
        const assist = await fetch(`${origin}/api/assist`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            provider: 'openai', mode: 'coach', week: 1, title: '入口检查',
            draft: '玩家选择一条路线。', rationale: '用来确认本地助手未配置。', evidence: '这次不连接外部模型。',
          }),
        });
        const assistBody = await assist.json();
        if (assist.status !== 503 || assistBody.error !== '这个 AI 服务还未在本地配置。' || Date.now() - started > 2000) {
          throw new Error(`${assist.status} ${JSON.stringify(assistBody)}`);
        }
        const directTutor = await fetch('http://127.0.0.1:8787/api/tutor');
        const tutorBody = await directTutor.json();
        if (!tutorBody.providers?.every((item) => item.configured === false)) throw new Error(JSON.stringify(tutorBody));
        const proxiedTutor = await fetch(`${origin}/api/tutor`);
        const proxiedBody = await proxiedTutor.json();
        if (proxiedTutor.status !== 200 || proxiedBody.providers?.some((item) => item.configured || item.key)) {
          throw new Error(`tutor seam ${proxiedTutor.status} ${JSON.stringify(proxiedBody)}`);
        }
      });
      await record('game page reports assistant unconfigured', async () => {
        const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
        const page = await context.newPage();
        await page.goto(`${origin}/game/#coach/01`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => document.body.innerText.includes('本地助手在线') && document.body.innerText.includes('API 密钥'), null, { timeout: 8000 });
        await shot(page, 'game_assistant_unconfigured_desktop.png');
        await context.close();
      });
    }
    server.child.kill('SIGTERM');
  }
} finally {
  await browser.close();
  for (const proc of processes) {
    if (proc.child.exitCode == null) proc.child.kill('SIGTERM');
  }
}

const failed = checks.filter((item) => !item.ok);
const summary = { checks, shots, failed: failed.length };
await writeFile(path.join(root, 'test-results/integration.json'), JSON.stringify(summary, null, 2));
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
if (failed.length) process.exit(1);
