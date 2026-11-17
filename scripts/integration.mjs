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
let hubSessionFile = '';

async function sessionHeaders() {
  const token = hubSessionFile ? (await readFile(hubSessionFile, 'utf8')).trim() : '';
  return token ? { 'X-Hub-Session': token } : {};
}

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

async function frameBody(page) {
  return page.frameLocator('#lesson-frame').locator('body');
}

async function readerMetrics(page) {
  return page.evaluate(() => {
    const frame = document.querySelector('#lesson-frame');
    const doc = frame?.contentDocument?.documentElement;
    const sidebar = frame?.contentDocument?.querySelector('.sidebar, .site-header, .topbar');
    return {
      sidebar: sidebar ? getComputedStyle(sidebar).display : 'none',
      frameHeight: frame ? frame.getBoundingClientRect().height : 0,
      docHeight: doc ? doc.scrollHeight : 0,
      nested: doc ? doc.scrollHeight - doc.clientHeight : 0,
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      tocs: document.querySelectorAll('#lesson-nav').length,
    };
  });
}

async function openReader(page, origin, base, course, moduleId, text) {
  await page.goto(new URL(`${base}?view=reader&course=${course}&module=${moduleId}`, origin).href, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction((needle) => {
    const frame = document.querySelector('#lesson-frame');
    return frame && !frame.hidden && frame.contentDocument?.body?.innerText.includes(needle);
  }, text, { timeout: 20000 });
}

async function features(browser, origin, base, viewport, label) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const tutorCalls = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/tutor')) tutorCalls.push(request.url());
  });
  try {
    if (label !== 'narrow') {
      await openReader(page, origin, base, 'nmr', 'nmr-1-1', '仪器里有什么');
      const lesson = await frameBody(page);
      await lesson.getByRole('button', { name: '切换为阅读全文' }).click();
      await lesson.locator('input[type="radio"]').first().click();
      await lesson.getByText(/理解正确|再想一步/).waitFor();
      await lesson.getByRole('button', { name: '我理解了，标记本版完成' }).click();
      await page.waitForFunction(() => {
        const saved = JSON.parse(localStorage.getItem('nmr-from-zero.progress.v2') || '{}');
        return Array.isArray(saved.completed) && saved.completed.includes('1-1');
      });
      const metrics = await readerMetrics(page);
      if (metrics.sidebar !== 'none') throw new Error(`course chrome visible: ${metrics.sidebar}`);
      if (metrics.tocs !== 1) throw new Error(`expected one outer TOC, saw ${metrics.tocs}`);
      if (metrics.frameHeight + 16 < metrics.docHeight) throw new Error(`iframe cropped content ${metrics.frameHeight} < ${metrics.docHeight}`);
      if (metrics.nested > 24) throw new Error(`nested scroll ${metrics.nested}`);
      if (metrics.overflow > 1) throw new Error(`horizontal overflow ${metrics.overflow}`);
      if (label === 'desktop') await shot(page, 'reader_quiz_desktop.png');
      if (label === 'phone') await shot(page, 'reader_quiz_phone.png');
      await page.evaluate(() => {
        document.documentElement.style.scrollBehavior = 'auto';
        document.body.style.minHeight = '4000px';
        window.scrollTo({ top: 640, behavior: 'instant' });
      });
      await page.waitForFunction(() => window.scrollY === 640);
      await page.evaluate(() => document.getElementById('open-settings').click());
      await page.waitForFunction(() => document.body.dataset.view === 'settings' && document.querySelector('#settings-vendor')?.textContent);
      await page.evaluate(() => document.getElementById('settings-back').click());
      await page.waitForFunction(() => location.search.includes('module=nmr-1-1') && document.body.dataset.view === 'reader' && Math.abs(window.scrollY - 640) <= 2);

      await openReader(page, origin, base, 'nmr', 'nmr-lab-waves', '波');
      const opposed = (await frameBody(page)).getByRole('button', { name: '反相 · 180°' });
      await opposed.click();
      await page.waitForFunction(() => document.querySelector('#lesson-frame')?.contentDocument?.querySelector('button[aria-pressed="true"]')?.textContent?.includes('180'));
      if (label === 'desktop') await shot(page, 'reader_lab_desktop.png');
      if (label === 'phone') await shot(page, 'reader_lab_phone.png');

      await openReader(page, origin, base, 'game', 'game-w01', '周');
      const game = await frameBody(page);
      await game.getByRole('link', { name: '交互实验' }).click();
      await game.locator('#lab-prediction').fill('我预测主通道能回到基地，因为耗电更稳定。');
      await game.getByRole('button', { name: '锁定预测，开始实验' }).click();
      await game.getByRole('button', { name: '走主通道' }).click();
      await game.getByText('需要 5 格电').waitFor();
      if (label === 'desktop') await shot(page, 'reader_game_lab_desktop.png');

      await page.evaluate(() => {
        localStorage.setItem('learning-atlas:day-one-reflection', JSON.stringify({ rows: 2, reason: '因为示例里有重复。', evidence: '第 1 行和第 2 行。' }));
        localStorage.setItem('learning-atlas:day-one-scope', 'true');
      });
      await openReader(page, origin, base, 'ai', 'ai-tutor', 'AI 学伴');
      const tutor = await frameBody(page);
      await tutor.getByText('已使用本机统一入口').waitFor();
      if (await tutor.locator('input[placeholder*="8787"]').count()) throw new Error('embed tutor still asks for a service address');
      if ((await tutor.innerText()).includes('模型调用成功')) throw new Error('tutor claimed a model call');
      const expected = `${origin}${base}api/tutor`.replace(/([^:]\/)\/+/g, '$1');
      if (!tutorCalls.some((url) => url.startsWith(expected))) throw new Error(`tutor did not use ${expected}: ${tutorCalls.join(' ')}`);
      if (label === 'desktop') await shot(page, 'reader_tutor_desktop.png');
    }

    await page.goto(new URL(`${base}?view=reader&course=nmr&module=nmr-1-1`, origin).href, { waitUntil: 'domcontentloaded' });
    await page.locator('#open-settings').click();
    await page.locator('#settings-model').fill('hub-test-model');
    await page.locator('#settings-key').fill('sk-browser-test-not-a-real-key');
    await page.locator('#settings-address').fill(`https://example.com/${'a'.repeat(48)}`);
    await page.locator('[data-settings-vendor="anthropic"]').click();
    await page.locator('#settings-unsaved-dialog').waitFor({ state: 'visible' });
    const focused = await page.evaluate(() => document.activeElement?.id);
    if (focused !== 'settings-unsaved-keep') throw new Error(`unsaved focus ${focused}`);
    await page.locator('#settings-unsaved-keep').click();
    if (await page.locator('#settings-model').inputValue() !== 'hub-test-model') throw new Error('vendor switch dropped the draft');
    await page.locator('#settings-save').click();
    await page.getByText('配置已保存').waitFor();
    if (await page.locator('#settings-key').inputValue() !== '') throw new Error('key was read back into the form');
    if ((await page.locator('body').innerText()).includes('sk-browser-test-not-a-real-key')) throw new Error('key leaked into the page');
    await page.locator('#settings-test').click();
    await page.locator('#settings-result').getByText('AI 学伴：服务可达，模型调用尚未验证。').waitFor();
    await page.locator('#settings-result').getByText('游戏助手：服务可达，模型调用尚未验证。').waitFor();
    if ((await page.locator('#settings-result').innerText()).includes('模型调用成功')) throw new Error('status test claimed a model call');
    await page.route(/\/api\/assistant-config$/, (route) => route.abort());
    await page.locator('#settings-model').fill('another-model');
    await page.locator('#settings-save').click();
    await page.getByText('后端不可达').waitFor();
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await page.locator('#settings-clear').click();
    await page.locator('#settings-clear-dialog').waitFor({ state: 'visible' });
    const cancelFocused = await page.evaluate(() => document.activeElement?.id);
    if (cancelFocused !== 'settings-clear-cancel') throw new Error(`clear focus ${cancelFocused}`);
    await page.locator('#settings-clear-cancel').click();
    await page.locator('#settings-clear').click();
    await page.locator('#settings-clear-confirm').click();
    await page.getByText('此厂商配置已清除').waitFor();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (overflow > 1) throw new Error(`settings overflow ${overflow}`);
    if (label === 'desktop') await shot(page, 'settings_desktop.png');
    if (label === 'phone') await shot(page, 'settings_phone.png');
    if (label === 'narrow') await shot(page, 'settings_narrow.png');
    await page.locator('#settings-back').click();
    await page.waitForFunction(() => location.search.includes('module=nmr-1-1'));
  } finally {
    await fetch(`${origin}${base}api/assistant-config/clear`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await sessionHeaders()) },
      body: JSON.stringify({ confirm: 'clear-assistant-configuration' }),
    }).catch(() => {});
    await context.close();
  }
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
    const configPath = path.join(tmpdir(), `learning-hub-assistant-${process.pid}-${port}.json`);
    hubSessionFile = path.join(path.dirname(configPath), 'hub-session');
    const server = start(process.execPath, ['server/hub.mjs'], {
      cwd: root,
      env: cleanEnv({
        HUB_BASE: base,
        PORT: String(port),
        ASSISTANT_CONFIG_PATH: configPath,
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
        const status = await fetch(`${origin}/api/status`, { headers: await sessionHeaders() });
        const body = await status.json();
        if (status.status !== 200 || body.providers.some((item) => item.configured || item.key)) throw new Error(JSON.stringify(body));
        const started = Date.now();
        const assist = await fetch(`${origin}/api/assist`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(await sessionHeaders()) },
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
        const proxiedTutor = await fetch(`${origin}/api/tutor`, { headers: await sessionHeaders() });
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
    await record(base === '/' ? 'desktop course features' : 'nested course features', () => features(browser, origin, base, { width: 1280, height: 800 }, base === '/' ? 'desktop' : 'nested'));
    await record(base === '/' ? 'phone course features' : 'nested phone features', () => features(browser, origin, base, { width: 390, height: 844 }, base === '/' ? 'phone' : 'nested-phone'));
    if (base === '/') await record('narrow settings', () => features(browser, origin, base, { width: 360, height: 780 }, 'narrow'));
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
