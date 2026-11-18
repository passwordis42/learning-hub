import { spawn } from 'node:child_process';
import http from 'node:http';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = process.env.AI_OFFLINE_OUT || '/tmp/ai-offline-evidence';
const marker = '完成第一天的清洗实验，再测试正常、全空和分类冲突三种情况';
const checks = [];

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

async function walk(dir, hit) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, hit);
    else if (/\.(html|js|mjs|json|css|md)$/.test(entry.name)) {
      const text = await readFile(full, 'utf8');
      if (text.includes(marker) || text.includes('ai/#week-01') || text.includes('Tutor-')) hit.push(path.relative(root, full));
    }
  }
}

await mkdir(outDir, { recursive: true });
const source = await readFile(path.join(root, 'sites/ai-learning-atlas/src/data/course.js'), 'utf8');
check('教程源码仍在仓库', source.includes(marker));

for (const base of ['/', '/learning-hub/']) {
  const env = { ...process.env, HUB_BASE: base };
  delete env.LEARNING_HUB_PUBLIC_BAILIAN_KEY;
  await run(process.execPath, ['scripts/build.mjs'], env);
  const hit = [];
  await walk(path.join(root, 'dist'), hit);
  check(`${base} 发布目录没有教程正文或旧包`, hit.length === 0, hit.slice(0, 8).join(' | '));
  const offline = await readFile(path.join(root, 'dist/ai/index.html'), 'utf8');
  check(`${base} 下线页可回首页`, offline.includes('返回首页') && offline.includes('href="../"') && !offline.includes(marker));
}
const browserEnv = { ...process.env, HUB_BASE: '/' };
delete browserEnv.LEARNING_HUB_PUBLIC_BAILIAN_KEY;
await run(process.execPath, ['scripts/build.mjs'], browserEnv);

const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2' };
const site = http.createServer(async (request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  const file = path.normalize(path.join(root, 'dist', decodeURIComponent(url.pathname)));
  if (!file.startsWith(path.join(root, 'dist'))) {
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
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.addInitScript(() => {
    localStorage.setItem('learning-atlas:weekly-study', JSON.stringify({ 'week-01': { completed: true } }));
    localStorage.setItem('learning-atlas:day-one-complete', 'true');
    localStorage.setItem('learning-atlas:weekly-resume', JSON.stringify('week-01'));
  });
  await page.goto(`${origin}/?view=reader&course=ai&module=week-01`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: '这门课已下线' }).waitFor();
  check('旧深链显示下线页', !(await page.locator('body').innerText()).includes(marker) && await page.locator('#lesson-frame').count() === 0);
  await page.screenshot({ path: path.join(outDir, 'deep_link_offline_1280.png') });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: '这门课已下线' }).waitFor();
  check('下线页刷新不循环', locationSafe(await page.url()));
  await page.getByRole('link', { name: '返回首页' }).click();
  await page.waitForFunction(() => document.body.innerText.includes('今天，去哪座岛') && !location.search.includes('course=ai'));
  check('返回首页后没有 AI 岛', await page.locator('.w-isle[data-course="ai"]').count() === 0 && await page.locator('.w-isle[data-course="nmr"]').count() === 1);
  await page.screenshot({ path: path.join(outDir, 'home_without_ai_1280.png') });
  const catalogText = await page.locator('body').innerText();
  check('首页没有教程章节标题', !catalogText.includes('用三种样本检查清洗规则'));
  await page.goto(`${origin}/#ai`, { waitUntil: 'domcontentloaded' });
  check('旧岛哈希不打开教程', await page.locator('.w-isle[data-course="ai"]').count() === 0 && !(await page.locator('body').innerText()).includes(marker));

  await page.goto(`${origin}/ai/#week-01`, { waitUntil: 'domcontentloaded' });
  await page.reload({ waitUntil: 'domcontentloaded' });
  const direct = await page.locator('body').innerText();
  check('直达 /ai/ 是下线页', direct.includes('这门课已下线') && !direct.includes(marker));
  await page.screenshot({ path: path.join(outDir, 'direct_ai_offline_1280.png') });
  const missing = await page.request.get(`${origin}/ai/assets/index.js`);
  check('旧静态资源不再发布', missing.status() === 404);

  await page.goto(`${origin}/?view=reader&course=nmr&module=nmr-1-1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('#lesson-frame')?.contentDocument?.body?.innerText.includes('仪器里有什么'));
  check('核磁课程仍可阅读', true);
  await page.goto(`${origin}/?view=reader&course=game&module=game-coach`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('#lesson-frame')?.contentDocument?.body?.innerText.includes('AI'));
  const coach = await page.frameLocator('#lesson-frame').locator('body').innerText();
  check('游戏 AI 教练仍在', /教练|工坊|提问/.test(coach));
  const settingsClosed = await page.evaluate(() => document.getElementById('open-settings').hidden && document.getElementById('btnAssist').hidden);
  check('配置页入口仍关闭', settingsClosed);
  await page.screenshot({ path: path.join(outDir, 'game_coach_still_1280.png') });
  await page.close();
} finally {
  await browser.close();
  site.close();
}

function locationSafe(url) {
  return url.includes('course=ai') && !url.includes('course=ai&module=ai&');
}

const failed = checks.filter((item) => !item.ok);
await writeFile(path.join(outDir, 'ai-offline-log.json'), JSON.stringify({ checks, failed: failed.length }, null, 2));
await writeFile(path.join(outDir, 'ai-offline-log.md'), ['# AI 教程下线', '', ...checks.map((item) => `- ${item.ok ? 'PASS' : 'FAIL'} ${item.name}${item.detail ? ` — ${item.detail}` : ''}`), ''].join('\n'));
if (failed.length) process.exit(1);
