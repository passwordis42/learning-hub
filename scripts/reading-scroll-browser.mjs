import { spawn, execFileSync } from 'node:child_process';
import http from 'node:http';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = '/opt/cursor/artifacts/reading-scroll';
const checks = [];
const shots = [];
const lessons = [
  { course: 'nmr', module: 'nmr-2-1', text: '振幅', end: '.lesson-completion button', action: '我理解了，标记本版完成' },
  { course: 'ai', module: 'week-01', text: '周', end: '.week-course-links', action: '' },
  { course: 'game', module: 'game-w01', text: '周', end: '.prev-next a', action: '' },
];

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
            : candidate.endsWith('.css') ? 'text/css' : 'application/octet-stream';
        response.writeHead(200, { 'content-type': type });
        response.end(body);
        return;
      } catch { /* next */ }
    }
    response.writeHead(404);
    response.end('missing');
  });
  return new Promise((resolve) => site.listen(port, '127.0.0.1', () => resolve(site)));
}

async function state(page) {
  return page.evaluate(() => {
    const frame = document.querySelector('#lesson-frame');
    const doc = frame?.contentDocument;
    return {
      y: Math.round(window.scrollY),
      max: Math.round(Math.max(0, document.documentElement.scrollHeight - window.innerHeight)),
      html: Math.round(document.documentElement.scrollTop),
      body: Math.round(document.body.scrollTop),
      frame: frame ? Math.round(frame.scrollTop) : 0,
      inner: doc ? Math.round(doc.documentElement.scrollTop) : 0,
      innerBody: doc?.body ? Math.round(doc.body.scrollTop) : 0,
      overflow: getComputedStyle(document.documentElement).overflowY,
    };
  });
}

function moved(before, after) {
  return after.y > before.y + 30;
}

async function wheel(page, x, y) {
  const before = await state(page);
  await page.mouse.move(x, y);
  await page.mouse.wheel(0, 280);
  await page.waitForTimeout(150);
  return { before, after: await state(page) };
}

async function focusShell(page) {
  await page.evaluate(() => {
    const note = document.querySelector('.reading-size-note');
    if (!note) return;
    note.tabIndex = -1;
    note.focus({ preventScroll: true });
  });
}

async function pageDown(page) {
  await focusShell(page);
  const before = await state(page);
  await page.keyboard.press('PageDown');
  await page.waitForTimeout(120);
  return { before, after: await state(page) };
}

async function openLesson(page, origin, base, lesson) {
  await page.goto(`${origin}${base}?view=reader&course=${lesson.course}&module=${lesson.module}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction((needle) => document.querySelector('#lesson-frame')?.contentDocument?.body?.innerText.includes(needle), lesson.text, { timeout: 20000 });
  const full = page.frameLocator('#lesson-frame').getByRole('button', { name: '切换为阅读全文' });
  if (await full.count()) await full.click();
  try {
    await page.waitForFunction(() => {
      const frame = document.querySelector('#lesson-frame');
      const height = parseFloat(frame?.style.height) || 0;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      return height > window.innerHeight || max > 500;
    }, null, { timeout: 20000 });
  } catch (error) {
    const snap = await page.evaluate(() => {
      const frame = document.querySelector('#lesson-frame');
      const doc = frame?.contentDocument;
      return {
        src: frame?.getAttribute('src') || '',
        styleHeight: frame?.style.height || '',
        parentMax: document.documentElement.scrollHeight - window.innerHeight,
        innerScroll: doc?.documentElement.scrollHeight || 0,
        innerClient: doc?.documentElement.clientHeight || 0,
        overflow: getComputedStyle(document.documentElement).overflowY,
      };
    });
    throw new Error(`${error.message} ${JSON.stringify(snap)}`);
  }
}

async function iframePoint(page) {
  const box = await page.frameLocator('#lesson-frame').locator('p:visible, h2:visible').first().boundingBox();
  if (!box || box.height < 4) throw new Error('iframe paragraph has no box');
  return { x: box.x + Math.min(24, box.width / 2), y: box.y + Math.min(10, box.height / 2) };
}

async function shellPoint(page) {
  const box = await page.locator('.reading-size-note').boundingBox();
  if (!box) throw new Error('shell note has no box');
  return { x: box.x + 12, y: box.y + box.height / 2 };
}

async function reachEnd(page, lesson) {
  await focusShell(page);
  for (let step = 0; step < 24; step += 1) {
    const visible = await page.evaluate((selector) => {
      const frame = document.querySelector('#lesson-frame');
      const doc = frame?.contentDocument;
      const target = selector.startsWith('.') || selector.startsWith('#')
        ? doc?.querySelector(selector)
        : [...(doc?.querySelectorAll('button, a') || [])].find((el) => (el.innerText || '').includes(selector));
      if (!target) return false;
      const rect = target.getBoundingClientRect();
      const host = frame.getBoundingClientRect();
      const top = host.top + rect.top;
      return top > 48 && top < window.innerHeight - 8;
    }, lesson.end);
    if (visible) return true;
    const before = (await state(page)).y;
    await page.keyboard.press('PageDown');
    await page.waitForTimeout(70);
    const after = await state(page);
    if (after.max > 200 && after.y >= after.max - 4 && Math.abs(after.y - before) < 2) return visible;
  }
  return false;
}

async function exercise(page, origin, base, lesson, label) {
  await openLesson(page, origin, base, lesson);
  const opened = await state(page);
  check(`${label} ${lesson.course} 长文高于一屏`, opened.max > 450, JSON.stringify(opened));
  const inside = await iframePoint(page);
  const frameWheel = await wheel(page, inside.x, inside.y);
  check(`${label} ${lesson.course} 指针在 iframe 正文内滚轮`, moved(frameWheel.before, frameWheel.after), `before=${frameWheel.before.y} after=${frameWheel.after.y} inner=${frameWheel.after.inner}`);
  const shell = await shellPoint(page);
  const shellWheel = await wheel(page, shell.x, shell.y);
  check(`${label} ${lesson.course} 指针在外壳内滚轮`, moved(shellWheel.before, shellWheel.after), `before=${shellWheel.before.y} after=${shellWheel.after.y}`);
  const key = await pageDown(page);
  const paged = key.after.y > key.before.y + 30 || (key.after.y > key.before.y && key.after.max - key.after.y <= 8);
  check(`${label} ${lesson.course} PageDown`, paged, `before=${key.before.y} after=${key.after.y} max=${key.after.max}`);
  const reached = await reachEnd(page, lesson);
  const atEnd = await state(page);
  check(`${label} ${lesson.course} 真实翻页后课末进入视口`, reached, `y=${atEnd.y} max=${atEnd.max}`);
  if (reached && lesson.action) {
    const frame = page.frameLocator('#lesson-frame');
    const control = lesson.end.startsWith('.') || lesson.end.startsWith('#')
      ? frame.locator(lesson.end)
      : frame.getByRole('button', { name: lesson.action });
    await control.click();
    const changed = await control.innerText();
    check(`${label} ${lesson.course} 课末按钮可点`, changed.includes('已完成') || changed.includes('撤销') || changed.includes('取消'), changed);
  } else if (reached && lesson.course === 'game') {
    const next = page.frameLocator('#lesson-frame').locator('.prev-next a').last();
    const beforeHash = await page.evaluate(() => document.querySelector('#lesson-frame').contentWindow.location.hash);
    await next.click();
    await page.waitForFunction((from) => document.querySelector('#lesson-frame').contentWindow.location.hash !== from, beforeHash);
    check(`${label} game 课末链接可点`, true, beforeHash);
  }
  if (label.endsWith('desktop') && lesson.course === 'nmr') {
    await page.screenshot({ path: path.join(outDir, `${label.replace(/\s+/g, '_')}_end.png`) });
    shots.push(path.join(outDir, `${label.replace(/\s+/g, '_')}_end.png`));
  }
}

async function settingsRound(page, label) {
  await focusShell(page);
  let parked = await state(page);
  if (parked.max - parked.y < 90) {
    await page.keyboard.press('PageUp');
    await page.waitForTimeout(100);
    parked = await state(page);
  }
  if (parked.y < 80) {
    await page.keyboard.press('PageDown');
    await page.waitForTimeout(100);
    parked = await state(page);
  }
  await page.evaluate(() => document.getElementById('open-settings').click());
  await page.waitForFunction(() => document.body.dataset.view === 'settings');
  const shell = await page.locator('#assist').boundingBox();
  await page.mouse.move(shell.x + 20, shell.y + shell.height - 20);
  await page.mouse.wheel(0, 400);
  await page.keyboard.press('PageDown');
  await page.waitForTimeout(150);
  const locked = await state(page);
  check(`${label} 设置打开锁住文档滚动`, Math.abs(locked.y - parked.y) <= 2, `parked=${parked.y} locked=${locked.y} overflow=${locked.overflow}`);
  await page.evaluate(() => document.getElementById('settings-back').click());
  await page.waitForFunction((top) => document.body.dataset.view === 'reader' && Math.abs(window.scrollY - top) <= 2, parked.y);
  const restored = await state(page);
  check(`${label} 设置关闭复原滚动`, Math.abs(restored.y - parked.y) <= 2, `restored=${restored.y}`);
  await page.locator('.reading-size-note').click();
  await page.keyboard.press('PageDown');
  await page.waitForTimeout(800);
  const later = await state(page);
  check(`${label} 手动翻页离开恢复点后不被抢回`, Math.abs(later.y - parked.y) > 30, `parked=${parked.y} later=${later.y}`);
}

async function homeStays(page, label) {
  await page.locator('#backLink').click();
  await page.waitForSelector('.harbor');
  await page.locator('#backLink').click();
  await page.waitForFunction(() => !document.body.classList.contains('in-course') && document.body.innerText.includes('今天，去哪座岛'));
  const before = await state(page);
  const sea = await page.locator('#sea').boundingBox();
  await page.mouse.move(sea.x + sea.width / 2, sea.y + 80);
  await page.mouse.wheel(0, 700);
  await page.keyboard.press('PageDown');
  await page.waitForTimeout(150);
  const after = await state(page);
  check(`${label} 返回海景没有文档滚动`, before.y === 0 && after.y === 0 && after.max < 8 && after.overflow === 'hidden', `before=${before.y} after=${after.y} max=${after.max} overflow=${after.overflow}`);
}

await mkdir(outDir, { recursive: true });
const browser = await chromium.launch({
  executablePath: '/usr/local/bin/google-chrome',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const servers = [];
try {
  for (const [base, port, label] of [['/', 8941, 'root'], ['/learning-hub/', 8942, 'pages']]) {
    await run(process.execPath, ['scripts/build.mjs'], { ...process.env, HUB_BASE: base });
    servers.push(await listen(port, path.join(root, 'dist'), base));
    const origin = `http://127.0.0.1:${port}`;
    const desktop = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    for (const lesson of lessons) await exercise(desktop, origin, base, lesson, `${label} desktop`);
    await settingsRound(desktop, `${label} desktop`);
    await homeStays(desktop, `${label} desktop`);
    await desktop.close();
    for (const [width, name] of [[390, '390'], [360, '360']]) {
      const phone = await browser.newPage({ viewport: { width, height: 800 } });
      await exercise(phone, origin, base, lessons[0], `${label} ${name}`);
      await phone.screenshot({ path: path.join(outDir, `${label}_${name}_end.png`) });
      shots.push(path.join(outDir, `${label}_${name}_end.png`));
      await phone.close();
    }
  }
} finally {
  await browser.close();
  servers.forEach((server) => server.close());
}

await run(process.execPath, ['scripts/build.mjs'], { ...process.env, HUB_BASE: '/' });
const profile = await mkdtemp(path.join(tmpdir(), 'scroll-zoom-'));
const zoomServer = spawn('python3', ['-m', 'http.server', '8944', '--bind', '127.0.0.1', '--directory', path.join(root, 'dist')], { stdio: 'ignore' });
const chrome = spawn('google-chrome', [
  '--no-sandbox', '--disable-dev-shm-usage', '--no-first-run', '--disable-translate',
  `--user-data-dir=${profile}`, '--window-size=1440,900', '--window-position=40,40',
  '--remote-debugging-port=9225', 'http://127.0.0.1:8944/?view=reader&course=nmr&module=nmr-2-1',
], { stdio: 'ignore', env: { ...process.env, DISPLAY: process.env.DISPLAY || ':1' } });
let zoomBrowser;
try {
  for (let attempt = 0; attempt < 40 && !zoomBrowser; attempt += 1) {
    try { zoomBrowser = await chromium.connectOverCDP('http://127.0.0.1:9225'); }
    catch { await new Promise((resolve) => setTimeout(resolve, 250)); }
  }
  const page = zoomBrowser.contexts()[0].pages().find((item) => item.url().includes('8944'));
  await page.waitForFunction(() => document.querySelector('#lesson-frame')?.contentDocument?.body?.innerText.includes('振幅'));
  let id = '';
  for (let attempt = 0; attempt < 40 && !id; attempt += 1) {
    try {
      id = execFileSync('xdotool', ['search', '--name', '学习入口'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean).at(-1) || '';
    } catch { await new Promise((resolve) => setTimeout(resolve, 250)); }
  }
  if (!id) throw new Error('未找到学习入口窗口');
  const press = (combo) => {
    execFileSync('xdotool', ['windowactivate', '--sync', id]);
    execFileSync('xdotool', ['key', '--window', id, '--clearmodifiers', combo]);
  };
  press('ctrl+0');
  await page.waitForTimeout(300);
  for (let step = 0; step < 5; step += 1) {
    press('ctrl+equal');
    await page.waitForTimeout(150);
  }
  const metrics = await page.evaluate(() => ({
    font: getComputedStyle(document.documentElement).fontSize,
    scale: window.visualViewport.scale,
    zoom: getComputedStyle(document.documentElement).zoom,
    width: window.innerWidth,
  }));
  check('原生 200% 成立', metrics.font === '16px' && metrics.scale === 1 && metrics.zoom === '1' && metrics.width < 800, JSON.stringify(metrics));
  const full = page.frameLocator('#lesson-frame').getByRole('button', { name: '切换为阅读全文' });
  if (await full.count()) await full.click();
  await page.waitForFunction(() => document.documentElement.scrollHeight - window.innerHeight > 1500);
  const point = await iframePoint(page);
  const spun = await wheel(page, point.x, point.y);
  check('原生 200% iframe 内滚轮离开顶部', moved(spun.before, spun.after), `before=${spun.before.y} after=${spun.after.y}`);
  const keyed = await pageDown(page);
  check('原生 200% PageDown 继续下移', moved(keyed.before, keyed.after), `before=${keyed.before.y} after=${keyed.after.y}`);
  const reached = await reachEnd(page, lessons[0]);
  check('原生 200% 翻到核磁课末', reached, JSON.stringify(await state(page)));
  await page.screenshot({ path: path.join(outDir, 'zoom_200_end.png') });
  shots.push(path.join(outDir, 'zoom_200_end.png'));
  await settingsRound(page, '原生 200%');
} finally {
  await zoomBrowser?.close().catch(() => {});
  chrome.kill('SIGTERM');
  zoomServer.kill('SIGTERM');
}

const report = [
  '# 阅读页真实滚动',
  '',
  '断言使用鼠标滚轮和 PageDown。没有用 scrollTo 代替用户输入。记录的是每次输入前后的 window.scrollY。',
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
