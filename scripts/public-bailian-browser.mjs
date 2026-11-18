import { spawn } from 'node:child_process';
import http from 'node:http';
import { mkdir, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = '/opt/cursor/artifacts/public-bailian';
const mockKey = 'sk-public-mock-not-real';
const checks = [];

function assertNode() {
  const major = Number(process.versions.node.split('.')[0]);
  if (major !== 24) {
    process.stderr.write(`需要 Node 24，当前 ${process.version}\n`);
    process.exit(1);
  }
}

function check(name, ok, detail = '') {
  checks.push({ name, ok: Boolean(ok), detail: String(detail) });
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}\n`);
}

function run(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, env, stdio: 'inherit' });
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`))));
  });
}

assertNode();
await mkdir(outDir, { recursive: true });
const buildEnv = { ...process.env, HUB_BASE: '/' };
delete buildEnv.LEARNING_HUB_PUBLIC_BAILIAN_KEY;
await run(process.execPath, ['scripts/build.mjs'], buildEnv);
const tutorBundle = (await readdir(path.join(root, 'dist/ai/assets'))).find((name) => name.startsWith('Tutor-') && name.endsWith('.js'));
const tutorBuilt = await readFile(path.join(root, 'dist/ai/assets', tutorBundle), 'utf8');
check('构建产物的学伴请求关闭千问思考', /enable_thinking\s*:\s*(?:!1|false)/.test(tutorBuilt), tutorBundle);

const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf' };
const site = http.createServer(async (request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  const file = path.normalize(path.join(root, 'dist', decodeURIComponent(url.pathname)));
  const base = path.join(root, 'dist');
  if (!file.startsWith(base)) {
    response.writeHead(403);
    response.end();
    return;
  }
  for (const candidate of [file, path.join(file, 'index.html')]) {
    try {
      const body = await readFile(candidate);
      response.writeHead(200, { 'content-type': types[path.extname(candidate)] || 'application/octet-stream' });
      response.end(body);
      return;
    } catch { /* next */ }
  }
  response.writeHead(404);
  response.end('missing');
});
const port = await new Promise((resolve) => site.listen(0, '127.0.0.1', () => resolve(site.address().port)));
const origin = `http://127.0.0.1:${port}`;

function configScript(value) {
  return `globalThis.LEARNING_HUB_PUBLIC_BAILIAN = ${JSON.stringify(value)};\n`;
}

const browser = await chromium.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

async function openPage(value) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const outbound = [];
  page.on('request', (request) => {
    if (!request.url().startsWith(origin)) outbound.push(`${request.method} ${request.url()}`);
  });
  await page.route('**/assets/public-bailian-config.js', (route) => route.fulfill({
    contentType: 'text/javascript',
    body: configScript(value),
  }));
  await page.goto(`${origin}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#wTitle');
  await page.waitForFunction(() => window.ATLAS_ASSISTANT);
  return { page, outbound };
}

async function hidden(page) {
  const text = await page.locator('body').innerText();
  const stored = await page.evaluate(() => JSON.stringify(localStorage));
  return !text.includes(mockKey) && !stored.includes(mockKey) && !text.includes('API 密钥');
}

async function closed(page) {
  return page.evaluate(() => {
    const assist = document.getElementById('assist');
    return !document.body.classList.contains('assist-open')
      && document.body.dataset.view !== 'settings'
      && getComputedStyle(assist).display === 'none'
      && document.getElementById('btnAssist').hidden
      && document.getElementById('open-settings').hidden;
  });
}

try {
  const ready = { key: mockKey, region: '', model: '', workspaceId: '' };
  {
    const { page, outbound } = await openPage(ready);
    const state = await page.evaluate(() => {
      const item = window.ATLAS_ASSISTANT.view().vendors.find((vendor) => vendor.id === 'qwen');
      return {
        model: item.enteredModel,
        region: item.region,
        url: item.protocols.ai.url,
        configured: item.protocols.ai.configured && item.protocols.game.configured,
        key: window.ATLAS_ASSISTANT.peekKey('qwen'),
      };
    });
    const prepared = await page.evaluate(() => window.ATLAS_ASSISTANT.prepare('ai', 'qwen'));
    check('未写地区时使用北京官方地址并用于 AI 和游戏', state.region === 'beijing' && state.model === 'qwen3.7-flash' && state.configured && state.key === mockKey && state.url === 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions' && prepared.ok === true && prepared.config.model === 'qwen3.7-flash', state.url);
    check('自动配置没有发起联网', outbound.length === 0, outbound.join(' '));
    check('首页没有打开配置页', await closed(page));
    check('首页画面没有密钥', await hidden(page));
    await page.screenshot({ path: path.join(outDir, 'home_closed_1280.png') });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.ATLAS_ASSISTANT?.peekKey('qwen') === 'sk-public-mock-not-real');
    check('刷新后重新载入北京预设', await closed(page));
    await page.goto(`${origin}/?demo=assist`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(700);
    await page.keyboard.press('Escape');
    await page.evaluate(() => {
      document.getElementById('btnAssist').click();
      document.getElementById('open-settings').click();
    });
    check('没有入口、快捷键或演示参数能打开配置页', await closed(page) && outbound.length === 0, outbound.join(' '));
    await page.screenshot({ path: path.join(outDir, 'no_entry_1280.png') });
    await page.close();
  }

  {
    const { page, outbound } = await openPage(null);
    const key = await page.evaluate(() => window.ATLAS_ASSISTANT.peekKey('qwen'));
    const unavailable = await page.evaluate(() => window.ATLAS_ASSISTANT.prepare('ai', 'qwen'));
    check('没有公开密钥时不放入内存', key === '' && unavailable.ok === false);
    check('无预设文案是助手暂不可用', /助手暂不可用/.test(unavailable.error) && !/地区|设置填写|助手设置/.test(unavailable.error), unavailable.error);
    check('缺失配置时不探测', outbound.length === 0, outbound.join(' '));
    await page.evaluate(() => {
      localStorage.setItem('learning-atlas:day-one-reflection', JSON.stringify({ rows: 2, reason: '因为示例里有重复。', evidence: '第 1 行和第 2 行。' }));
      localStorage.setItem('learning-atlas:day-one-scope', 'true');
    });
    await page.goto(`${origin}/?view=reader&course=ai&module=ai-tutor`, { waitUntil: 'domcontentloaded' });
    const tutor = page.frameLocator('#lesson-frame');
    await tutor.getByText('没有可用预设时助手暂不可用，不会打开配置页').waitFor();
    const stayed = await page.evaluate(() => location.search.includes('module=ai-tutor') && !document.body.classList.contains('assist-open'));
    check('助手不可用时留在课程页', stayed);
    await page.screenshot({ path: path.join(outDir, 'unavailable_1280.png') });
    await page.close();
  }

  {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.route('**/assets/public-bailian-config.js', (route) => route.fulfill({
      contentType: 'text/javascript',
      body: configScript(ready),
    }));
    await page.goto(`${origin}/?view=reader&course=nmr&module=nmr-2-1`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelector('#lesson-frame')?.contentDocument?.body?.innerText.includes('振幅'));
    const text = await page.locator('body').innerText();
    check('课程阅读页仍打开核磁正文', text.includes('振幅') && !text.includes(mockKey) && !text.includes('API 密钥'));
    check('课程页没有打开配置页', await closed(page));
    await page.screenshot({ path: path.join(outDir, 'course_390.png') });
    await page.close();
  }
} finally {
  await browser.close();
  site.close();
}

const failed = checks.filter((item) => !item.ok).length;
process.stdout.write(`public-bailian ${checks.length - failed} pass ${failed} fail\n`);
if (failed) process.exit(1);
