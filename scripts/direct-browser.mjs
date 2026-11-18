import { spawn } from 'node:child_process';
import http from 'node:http';
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = '/opt/cursor/artifacts';
const firstKey = 'sk-direct-first-not-real';
const secondKey = 'sk-direct-second-not-real';
const calls = [];
const checks = [];
const shots = [];

function check(name, ok, detail = '') {
  checks.push({ name, ok: Boolean(ok), detail });
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}\n`);
}

function run(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, env, stdio: 'inherit' });
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`))));
  });
}

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

const mock = http.createServer((request, response) => {
  const chunks = [];
  request.on('data', (chunk) => chunks.push(chunk));
  request.on('end', () => {
    const raw = Buffer.concat(chunks).toString('utf8');
    const authorization = request.headers.authorization || '';
    const key = authorization === `Bearer ${firstKey}` ? 'first' : authorization === `Bearer ${secondKey}` ? 'second' : authorization ? 'other' : 'absent';
    calls.push({
      method: request.method,
      origin: `http://127.0.0.1:${request.socket.localPort}`,
      path: request.url.split('?')[0],
      cookie: Boolean(request.headers.cookie),
      key,
      hasCourse: raw.includes('课程资料'),
      hasDraft: raw.includes('玩家先选一条路'),
    });
    const origin = request.headers.origin || '*';
    const headers = {
      'access-control-allow-origin': origin,
      vary: 'Origin',
      'access-control-allow-headers': 'authorization,content-type,anthropic-version,x-api-key',
      'access-control-allow-methods': 'POST,OPTIONS',
      'content-type': 'application/json',
    };
    if (request.method === 'OPTIONS') {
      response.writeHead(204, headers);
      response.end();
      return;
    }
    const finding = JSON.stringify({ findings: [{ focus: 'test', anchor: '' }] });
    const body = request.url.includes('/responses')
      ? { output: [{ type: 'message', content: [{ type: 'output_text', text: '模拟回复：课程上下文已收到' }] }] }
      : { choices: [{ message: { content: finding } }] };
    response.writeHead(200, headers);
    response.end(JSON.stringify(body));
  });
});
const mockPort = await listen(mock);
const mock2 = http.createServer(mock.listeners('request')[0]);
const mockPort2 = await listen(mock2);

async function scan(dist, base) {
  const bad = [];
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (/\.(html|css|js|mjs)$/.test(entry.name)) {
        const text = await readFile(full, 'utf8');
        const refs = text.match(/(?:src|href|url)\((['"])\/(?!\/)[^'")]+/g) || [];
        const attrs = text.match(/(?:src|href)=['"]\/(?!\/)[^'"]+/g) || [];
        for (const ref of [...refs, ...attrs]) {
          const value = ref.slice(ref.indexOf('/'));
          if (base === '/' && value.startsWith('/learning-hub/')) bad.push(`${path.relative(dist, full)} ${value}`);
          if (base !== '/' && !value.startsWith(base) && !value.startsWith('/learning-hub/')) bad.push(`${path.relative(dist, full)} ${value}`);
        }
      }
    }
  }
  await walk(dist);
  return bad;
}

async function save(page, address, key) {
  await page.locator('#settings-model').fill('direct-browser-model');
  await page.locator('#settings-key').fill(key);
  await page.locator('#settings-address').fill(address);
  await page.locator('#settings-save').click();
  await page.getByText('只保存在这次打开的页面内存里').waitFor();
}

const browser = await chromium.launch({ executablePath: '/usr/local/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
try {
  for (const base of ['/', '/learning-hub/']) {
    const label = base === '/' ? 'root' : 'nested';
    await run(process.execPath, ['scripts/build.mjs'], { ...process.env, HUB_BASE: base });
    const bad = await scan(path.join(root, 'dist'), base);
    check(`${label} 构建资源没有脱离 ${base}`, bad.length === 0, bad.slice(0, 8).join(' | '));
    const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json' };
    const site = http.createServer((request, response) => {
      const url = new URL(request.url, 'http://127.0.0.1');
      let pathname = decodeURIComponent(url.pathname);
      if (base !== '/' && pathname.startsWith(base)) pathname = `/${pathname.slice(base.length)}`;
      const file = path.normalize(path.join(root, 'dist', pathname));
      if (!file.startsWith(path.join(root, 'dist'))) {
        response.writeHead(403);
        response.end();
        return;
      }
      const send = (body, target) => {
        response.writeHead(200, { 'content-type': types[path.extname(target)] || 'application/octet-stream' });
        response.end(body);
      };
      readFile(file).then((body) => send(body, file)).catch(() => {
        const index = path.join(file, 'index.html');
        readFile(index).then((body) => send(body, index)).catch(() => {
          response.writeHead(404);
          response.end('missing');
        });
      });
    });
    const port = await listen(site);
    const origin = `http://127.0.0.1:${port}`;
    const page = await browser.newPage();
    const seen = [];
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.port !== String(mockPort) && url.port !== String(mockPort2)) return;
      request.allHeaders().then((headers) => {
        seen.push({ path: url.pathname, cookie: Boolean(headers.cookie), origin: url.origin });
      });
    });
    await page.addInitScript(() => {
      localStorage.setItem('learning-atlas:day-one-reflection', JSON.stringify({ rows: 2, reason: '因为示例里有重复。', evidence: '第 1 行和第 2 行。' }));
      localStorage.setItem('learning-atlas:day-one-scope', 'true');
    });
    await page.goto(`${origin}${base}?view=reader&course=ai&module=ai-tutor`, { waitUntil: 'domcontentloaded' });
    await page.locator('#open-settings').click();
    const before = calls.length;
    await save(page, `http://127.0.0.1:${mockPort}/v1`, firstKey);
    await page.locator('#settings-test').click();
    await page.getByText('不能当作已经连通').first().waitFor();
    check(`${label} 配置核对没有请求供应商`, calls.length === before);
    await page.screenshot({ path: path.join(outDir, `direct_settings_${label}.png`) });
    shots.push(path.join(outDir, `direct_settings_${label}.png`));
    await page.locator('#settings-back').click();
    await page.waitForFunction(() => document.body.dataset.view === 'reader');
    const tutor = page.frameLocator('#lesson-frame');
    await tutor.getByText('配置来自统一入口这次打开的页面内存').waitFor();
    await tutor.locator('textarea').first().fill('请解释这一课的数据流。');
    await tutor.getByRole('button', { name: '向导师提问' }).click();
    await tutor.getByText('托管助手未接通').waitFor({ timeout: 20000 });
    const tutorCall = calls.slice(before).find((item) => item.method === 'POST');
    check(`${label} AI 受管入口没有直连供应商`, !tutorCall, JSON.stringify(tutorCall || null));
    await page.screenshot({ path: path.join(outDir, `direct_tutor_${label}.png`) });
    shots.push(path.join(outDir, `direct_tutor_${label}.png`));

    const gameBefore = calls.length;
    await page.locator('#switcher a[data-course="game"]').click();
    await page.locator('a[data-lesson-module="game-coach"]').click();
    const game = page.frameLocator('#lesson-frame');
    await game.locator('#coach-draft').waitFor();
    await game.locator('#coach-draft').fill('玩家先选一条路，再看电量够不够走回去。');
    await game.locator('#coach-rationale').fill('这条规则让玩家用有限电量做选择。');
    await game.locator('#coach-evidence').fill('试了一次主通道，电量在第五格耗尽。');
    await game.locator('#checkpoint-form').getByRole('button', { name: '确认是我的设计并保存' }).click();
    await game.locator('#coach-provider').selectOption('openai');
    await game.locator('#ask-ai').click();
    await game.getByText('托管助手未接通').waitFor({ timeout: 20000 });
    const gameCall = calls.slice(gameBefore).find((item) => item.method === 'POST');
    check(`${label} 游戏受管入口没有直连供应商`, !gameCall, JSON.stringify(gameCall || null));
    await page.screenshot({ path: path.join(outDir, `direct_game_${label}.png`) });
    shots.push(path.join(outDir, `direct_game_${label}.png`));

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('#open-settings').click();
    await page.getByText('尚未填写密钥').waitFor();
    check(`${label} 刷新后密钥失效`, true);
    await save(page, `http://127.0.0.1:${mockPort}/v1`, firstKey);
    await page.locator('#settings-address').fill(`http://127.0.0.1:${mockPort2}/v1`);
    await page.locator('#settings-save').click();
    await page.locator('#settings-rebind-dialog').waitFor({ state: 'visible' });
    await page.locator('#settings-rebind-cancel').click();
    check(`${label} 改地址没有带着旧密钥保存`, calls.filter((item) => item.key === 'first').every((item) => item.path.startsWith('/v1/')));
    await page.locator('#settings-address').fill(`http://127.0.0.1:${mockPort2}/v1`);
    await page.locator('#settings-key').fill(secondKey);
    await page.locator('#settings-save').click();
    await page.getByText('只保存在这次打开的页面内存里').waitFor();
    const switched = calls.length;
    await page.locator('#settings-back').click();
    await page.locator('#switcher a[data-course="ai"]').click();
    await page.locator('a[data-lesson-module="ai-tutor"]').click();
    await page.frameLocator('#lesson-frame').locator('textarea').first().fill('换地址后再问一次。');
    await page.frameLocator('#lesson-frame').getByRole('button', { name: '向导师提问' }).click();
    await page.frameLocator('#lesson-frame').getByText('托管助手未接通').waitFor({ timeout: 20000 });
    const second = calls.slice(switched).find((item) => item.method === 'POST');
    check(`${label} 换密钥后仍不直连供应商`, !second, JSON.stringify(second || null));

    await page.locator('#open-settings').click();
    await save(page, 'http://127.0.0.1:9/v1', firstKey);
    await page.locator('#settings-back').click();
    await page.frameLocator('#lesson-frame').locator('textarea').first().fill('这个地址没有服务。');
    await page.frameLocator('#lesson-frame').getByRole('button', { name: '向导师提问' }).click();
    await page.frameLocator('#lesson-frame').getByText('托管助手未接通').waitFor({ timeout: 20000 });
    check(`${label} 旧地址失败也不会改走浏览器密钥`, calls.filter((item) => item.method === 'POST').length === 0);
    await page.screenshot({ path: path.join(outDir, `direct_error_${label}.png`) });
    shots.push(path.join(outDir, `direct_error_${label}.png`));
    check(`${label} 浏览器记录里没有把 Cookie 发给模拟供应商`, seen.every((item) => !item.cookie), JSON.stringify(seen));
    await page.close();
  }
} finally {
  await browser.close();
  mock.close();
  mock2.close();
}

const report = ['# 前端直连模拟供应商', '', '这不是真实模型，也不是公网部署。模拟服务只在 127.0.0.1 上返回固定文本。记录里只有路径和密钥类别，没有密钥原文。', '',
  ...checks.map((item) => `- ${item.ok ? 'PASS' : 'FAIL'} ${item.name}${item.detail ? ` — ${item.detail}` : ''}`),
  '', '## 模拟请求', '',
  ...calls.map((item) => `- \`${item.origin}${item.path}\` cookie=${item.cookie} key=${item.key} course=${item.hasCourse} draft=${item.hasDraft}`),
  '', '## 截图', '', ...shots.map((file) => `- \`${file}\``),
].join('\n');
await mkdir(outDir, { recursive: true });
await writeFile(path.join(outDir, 'direct-browser-report.md'), report);
await writeFile(path.join(outDir, 'direct-browser-requests.json'), JSON.stringify(calls, null, 2));
process.stdout.write(`${report}\n`);
process.exit(checks.some((item) => !item.ok) ? 1 : 0);
