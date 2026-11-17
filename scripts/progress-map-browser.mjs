import { spawn } from 'node:child_process';
import http from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = '/opt/cursor/artifacts/progress-map';
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

function listen(port, directory, base) {
  const site = http.createServer(async (request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    let pathname = decodeURIComponent(url.pathname);
    if (base !== '/' && pathname.startsWith(base)) pathname = `/${pathname.slice(base.length)}`;
    const file = path.normalize(path.join(directory, pathname));
    if (!file.startsWith(directory)) {
      response.writeHead(403);
      response.end();
      return;
    }
    for (const candidate of [file, path.join(file, 'index.html')]) {
      try {
        const body = await readFile(candidate);
        const type = candidate.endsWith('.html') ? 'text/html; charset=utf-8'
          : candidate.endsWith('.js') ? 'text/javascript'
            : candidate.endsWith('.mjs') ? 'text/javascript'
              : candidate.endsWith('.css') ? 'text/css' : 'application/octet-stream';
        response.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
        response.end(body);
        return;
      } catch { /* next */ }
    }
    response.writeHead(404);
    response.end('missing');
  });
  return new Promise((resolve) => site.listen(port, '127.0.0.1', () => resolve(site)));
}

async function openLesson(page, origin, base, course, moduleId) {
  await page.goto(`${origin}${base}?view=reader&course=${course}&module=${moduleId}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#lesson-frame');
  await page.waitForFunction(() => {
    const frame = document.querySelector('#lesson-frame');
    return frame && frame.contentDocument && frame.contentDocument.body && frame.contentDocument.body.innerText.length > 40;
  });
}

async function backToDirectory(page) {
  await page.locator('#backLink').click();
  await page.waitForSelector('#dirDone');
}

async function backHome(page) {
  await page.locator('#backLink').click();
  await page.waitForFunction(() => !document.body.classList.contains('in-course'));
}

async function meter(page, course) {
  return page.locator(`.w-isle[data-course="${course}"] .meter`).textContent();
}

async function markNmr(frame) {
  const full = frame.getByRole('button', { name: '切换为阅读全文' });
  if (await full.count()) await full.click();
  await frame.getByRole('button', { name: '我理解了，标记本版完成' }).click();
}

async function markGame(frame) {
  const note = '玩家先看到目标，再做出选择，并立刻得到反馈。';
  await frame.getByRole('link', { name: '阅读全文' }).click();
  await frame.locator('#practice-notes').fill(note);
  await frame.locator('#reason-judgment').fill('这个循环让玩家感到自己的选择有后果。');
  await frame.locator('#reason-evidence').fill('教程关卡在操作后马上给出音效和分数。');
  await frame.locator('#reason-verification').fill('如果去掉反馈，玩家会停下来询问是否成功。');
  await frame.getByRole('button', { name: '提交我的判断' }).click();
  await frame.locator('#reason-reflection').fill('我保留了选择带来反馈的判断，因为去掉反馈后目标不再清楚。');
  await frame.locator('#study-finish').click();
}

async function markAi(frame) {
  await frame.getByRole('button', { name: '去看演示' }).click();
  for (let step = 0; step < 6; step += 1) {
    const ready = frame.getByRole('button', { name: '开始自己试' });
    if (await ready.isEnabled()) break;
    await frame.getByRole('button', { name: /开始演示|演示下一步/ }).click();
  }
  await frame.getByRole('button', { name: '开始自己试' }).click();
  await frame.locator('#week-work').fill('第1行空，第2行保留，第4行与第2行整行重复。');
  await frame.getByLabel('第 1 题答案').fill('3');
  await frame.locator('input[name="question-1"]').first().check();
  await frame.getByRole('button', { name: '提交并核对结果' }).click();
  await frame.getByRole('button', { name: /完成本课/ }).click();
}

async function plantTraces(page) {
  await page.evaluate(() => {
    localStorage.setItem('nmr-from-zero.progress.v2', JSON.stringify({
      completed: [],
      lastLesson: '2-1',
      answers: { '2-1': 1 },
      positions: { '2-1': 'check' },
      readingMode: 'all',
      legacy: { completed: ['2-1'] },
    }));
    localStorage.setItem('nmr-from-zero.progress.v1', JSON.stringify({ completed: ['2-1'] }));
    localStorage.setItem('learning-atlas:weekly-study', JSON.stringify({
      'week-01': { completed: false, phase: 2, practice: { work: '只是草案' } },
    }));
    localStorage.setItem('learning-atlas:weekly-resume', JSON.stringify('week-01'));
    localStorage.setItem('learning-atlas:day-one-experiment', JSON.stringify('实验草案'));
    localStorage.setItem('learning-atlas:chapters', JSON.stringify(['s1']));
    localStorage.setItem('game-design-atlas:learning:v1', JSON.stringify({
      1: { complete: true, draft: '项目草案', study: { finished: true, practice: '短', position: 'check', reasoning: { submitted: false } } },
    }));
    localStorage.setItem('game-design-atlas:resume:v1', JSON.stringify('1'));
  });
}

async function clearCourseStores(page) {
  await page.evaluate(() => {
    ['nmr-from-zero.progress.v2', 'nmr-from-zero.progress.v1', 'learning-atlas:weekly-study', 'learning-atlas:weekly-resume', 'learning-atlas:day-one-experiment', 'learning-atlas:day-one-complete', 'learning-atlas:chapters', 'game-design-atlas:learning:v1', 'game-design-atlas:resume:v1'].forEach((key) => localStorage.removeItem(key));
  });
}

async function flow(page, origin, base, label) {
  await page.goto(`${origin}${base}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.w-isle[data-course="nmr"]');
  await plantTraces(page);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.w-isle[data-course="nmr"]');
  const traced = await meter(page, 'nmr');
  check(`${label} 旧记录和草案不计完成`, traced.startsWith('已完成 0 /'), traced);
  await page.goto(`${origin}${base}#nmr`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('#dockDone')?.textContent === '0');
  const tracedRow = await page.locator('#dockRoute li.done a[href*="module=nmr-2-1"]').count();
  check(`${label} 选岛目录不把 NMR 旧完成当已读`, tracedRow === 0, `rows=${tracedRow}`);
  await clearCourseStores(page);

  await openLesson(page, origin, base, 'nmr', 'nmr-2-1');
  check(`${label} 进入核磁课时文档可滚动`, await page.evaluate(() => getComputedStyle(document.documentElement).overflowY) === 'auto');
  await backToDirectory(page);
  check(`${label} 只打开核磁课还不算完成`, (await page.locator('#dirDone').textContent()) === '0');
  await openLesson(page, origin, base, 'nmr', 'nmr-2-1');
  await markNmr(page.frameLocator('#lesson-frame'));
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('nmr-from-zero.progress.v2') || '{}').completed?.includes('2-1'));
  await backToDirectory(page);
  check(`${label} 核磁标完后目录计数`, (await page.locator('#dirDone').textContent()) === '1');
  check(`${label} 核磁目录标出 2-1`, await page.locator('.lessons li.done a[data-lesson-module="nmr-2-1"]').count() === 1);
  await backHome(page);
  await page.waitForFunction(() => document.querySelector('#dockDone')?.textContent === '1');
  check(`${label} 返回选岛目录汇总核磁`, await page.locator('#dockRoute li.done a[href*="module=nmr-2-1"]').count() === 1);
  await page.locator('#btnHome').click();
  await page.waitForFunction(() => document.querySelector('.w-isle[data-course="nmr"] .meter')?.textContent?.startsWith('已完成 1 /'));
  check(`${label} 返回首页汇总核磁`, (await meter(page, 'nmr')).startsWith('已完成 1 /'));
  await page.locator('#btnList').click();
  await page.locator('.cat-course summary', { hasText: '核磁共振' }).click();
  check(`${label} 文字目录标出核磁 2-1`, await page.locator('.cat-list li.done a[href*="module=nmr-2-1"]').count() === 1);
  await page.locator('#scrim').click();

  await openLesson(page, origin, base, 'game', 'game-w01');
  await backToDirectory(page);
  check(`${label} 只打开游戏课还不算完成`, (await page.locator('#dirDone').textContent()) === '0');
  await openLesson(page, origin, base, 'game', 'game-w01');
  await markGame(page.frameLocator('#lesson-frame'));
  await page.waitForFunction(() => {
    const row = JSON.parse(localStorage.getItem('game-design-atlas:learning:v1') || '{}')['1'];
    return row?.study?.finished === true;
  });
  await backToDirectory(page);
  check(`${label} 游戏标完后目录计数`, (await page.locator('#dirDone').textContent()) === '1');
  check(`${label} 游戏目录标出第 1 周`, await page.locator('.lessons li.done a[data-lesson-module="game-w01"]').count() === 1);
  await backHome(page);
  await page.locator('#btnHome').click();
  await page.waitForFunction(() => document.querySelector('.w-isle[data-course="game"] .meter')?.textContent?.startsWith('已完成 1 /'));
  check(`${label} 返回首页汇总游戏`, (await meter(page, 'game')).startsWith('已完成 1 /'));

  await openLesson(page, origin, base, 'ai', 'week-01');
  await backToDirectory(page);
  check(`${label} 只打开 AI 课还不算完成`, (await page.locator('#dirDone').textContent()) === '0');
  await openLesson(page, origin, base, 'ai', 'week-01');
  await markAi(page.frameLocator('#lesson-frame'));
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('learning-atlas:weekly-study') || '{}')['week-01']?.completed === true);
  const resumedOnly = await page.evaluate(() => JSON.parse(localStorage.getItem('learning-atlas:weekly-study') || '{}')['week-02']?.completed === true);
  check(`${label} 下一课浏览指针不算完成`, resumedOnly === false);
  await backToDirectory(page);
  check(`${label} AI 标完后目录计数`, (await page.locator('#dirDone').textContent()) === '1');
  check(`${label} AI 目录标出第 1 周`, await page.locator('.lessons li.done a[data-lesson-module="week-01"]').count() === 1);
  check(`${label} AI 目录不标第 2 周`, await page.locator('.lessons li.done a[data-lesson-module="week-02"]').count() === 0);
  await backHome(page);
  await page.locator('#btnHome').click();
  await page.waitForFunction(() => document.querySelector('.w-isle[data-course="ai"] .meter')?.textContent?.startsWith('已完成 1 /'));
  check(`${label} 返回首页汇总 AI`, (await meter(page, 'ai')).startsWith('已完成 1 /'));
  check(`${label} 首页海景仍锁住文档滚动`, await page.evaluate(() => getComputedStyle(document.documentElement).overflowY) === 'hidden');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('.w-isle[data-course="nmr"] .meter')?.textContent?.startsWith('已完成 1 /'));
  check(`${label} 刷新后三课完成仍在`, [
    await meter(page, 'nmr'),
    await meter(page, 'game'),
    await meter(page, 'ai'),
  ].every((text) => text.startsWith('已完成 1 /')));
  const foreign = await page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith('lh-progress') || key === 'hub-progress'));
  check(`${label} 没有另建入口进度`, foreign.length === 0, foreign.join(','));

  await page.screenshot({ path: path.join(outDir, `${label}_home.png`) });
  shots.push(path.join(outDir, `${label}_home.png`));
  if (label === 'root') {
    const phone = await page.context().newPage();
    await phone.setViewportSize({ width: 390, height: 800 });
    await phone.goto(`${origin}${base}#nmr`, { waitUntil: 'domcontentloaded' });
    await phone.waitForFunction(() => document.querySelector('#dockDone')?.textContent === '1');
    check('root 390 选岛目录仍显示核磁已完成', await phone.locator('#dockRoute li.done a[href*="module=nmr-2-1"]').count() === 1);
    await phone.screenshot({ path: path.join(outDir, 'root_390_dock.png') });
    shots.push(path.join(outDir, 'root_390_dock.png'));
    await phone.close();
  }

  await openLesson(page, origin, base, 'nmr', 'nmr-2-1');
  const nmr = page.frameLocator('#lesson-frame');
  const nmrFull = nmr.getByRole('button', { name: '切换为阅读全文' });
  if (await nmrFull.count()) await nmrFull.click();
  await nmr.getByRole('button', { name: '已完成本课 · 点击撤销' }).click();
  await page.waitForFunction(() => !JSON.parse(localStorage.getItem('nmr-from-zero.progress.v2') || '{}').completed?.includes('2-1'));
  await backToDirectory(page);
  check(`${label} 撤销核磁后目录归零`, (await page.locator('#dirDone').textContent()) === '0');
  await backHome(page);
  await page.locator('#btnHome').click();
  await page.waitForFunction(() => document.querySelector('.w-isle[data-course="nmr"] .meter')?.textContent?.startsWith('已完成 0 /'));
  check(`${label} 撤销核磁后首页同步`, (await meter(page, 'nmr')).startsWith('已完成 0 /'));

  await openLesson(page, origin, base, 'game', 'game-w01');
  const game = page.frameLocator('#lesson-frame');
  const gameFull = game.getByRole('link', { name: '阅读全文' });
  if (await gameFull.count()) await gameFull.click();
  await game.locator('#study-finish').click();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('game-design-atlas:learning:v1') || '{}')['1']?.study?.finished !== true);
  await backToDirectory(page);
  check(`${label} 撤销游戏后目录归零`, (await page.locator('#dirDone').textContent()) === '0');
  await backHome(page);
  await page.locator('#btnHome').click();
  await page.waitForFunction(() => document.querySelector('.w-isle[data-course="game"] .meter')?.textContent?.startsWith('已完成 0 /'));
  check(`${label} 撤销游戏后首页同步`, (await meter(page, 'game')).startsWith('已完成 0 /'));

  await page.evaluate(() => {
    const study = JSON.parse(localStorage.getItem('learning-atlas:weekly-study') || '{}');
    if (study['week-01']) study['week-01'].completed = false;
    localStorage.setItem('learning-atlas:weekly-study', JSON.stringify(study));
  });
  await page.goto(`${origin}${base}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('.w-isle[data-course="ai"] .meter')?.textContent?.startsWith('已完成 0 /'));
  check(`${label} 撤销 AI 完成后首页同步`, (await meter(page, 'ai')).startsWith('已完成 0 /'));
  await page.goto(`${origin}${base}?view=reader&course=ai`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#dirDone');
  check(`${label} 撤销 AI 完成后目录同步`, (await page.locator('#dirDone').textContent()) === '0');
}

await mkdir(outDir, { recursive: true });
const browser = await chromium.launch({
  executablePath: '/usr/local/bin/google-chrome',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const servers = [];
try {
  for (const [base, port, label] of [['/', 8951, 'root'], ['/learning-hub/', 8952, 'pages']]) {
    await run(process.execPath, ['scripts/build.mjs'], { ...process.env, HUB_BASE: base });
    servers.push(await listen(port, path.join(root, 'dist'), base));
    const origin = `http://127.0.0.1:${port}`;
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    await flow(page, origin, base, label);
    await context.close();
  }
} finally {
  await browser.close();
  servers.forEach((server) => server.close());
}

const report = [
  '# 三课完成状态映射',
  '',
  '入口只读三课现有存储。NMR 看 `nmr-from-zero.progress.v2` 的 `completed`。AI 看 `learning-atlas:weekly-study` 里 `completed === true`，以及 `learning-atlas:day-one-complete === true`。游戏看 `game-design-atlas:learning:v1` 中满足完成本课条件的 `study.finished`。',
  '',
  '不读取旧版 v1、legacy.completed、最后阅读位置、答案、周续看指针、实验草案或项目验收。撤销后下一次绘制重新读取。',
  '',
  ...checks.map((item) => `- ${item.ok ? 'PASS' : 'FAIL'} ${item.name}${item.detail ? ` — ${item.detail}` : ''}`),
  '',
  '## 截图',
  '',
  ...shots.map((file) => `- \`${file}\``),
].join('\n');
await writeFile(path.join(outDir, 'report.md'), report);
process.stdout.write(`${report}\n`);
process.exit(checks.some((item) => !item.ok) ? 1 : 0);
