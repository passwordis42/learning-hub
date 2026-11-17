import { spawn, execFileSync } from 'node:child_process';
import http from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = '/opt/cursor/artifacts/reading-size';
const checks = [];
const shots = [];
const courses = [
  ['ai', 'week-01', '周'],
  ['nmr', 'nmr-2-1', '振幅'],
  ['game', 'game-w01', '周'],
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
    const candidates = [file, path.join(file, 'index.html')];
    for (const candidate of candidates) {
      try {
        const body = await readFile(candidate);
        const type = candidate.endsWith('.html') ? 'text/html; charset=utf-8'
          : candidate.endsWith('.js') ? 'text/javascript'
            : candidate.endsWith('.css') ? 'text/css'
              : candidate.endsWith('.svg') ? 'image/svg+xml' : 'application/octet-stream';
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

async function sample(page) {
  return page.evaluate(() => {
    const frame = document.querySelector('#lesson-frame');
    const doc = frame?.contentDocument;
    const paragraph = [...(doc?.querySelectorAll('p') || [])].find((node) => (
      node.getClientRects().length && (node.innerText || '').trim().length > 12 && !node.closest('.katex')
    ));
    const title = document.querySelector('#lt');
    const paragraphStyle = paragraph ? getComputedStyle(paragraph) : null;
    const katex = doc?.querySelector('.katex');
    return {
      title: title ? parseFloat(getComputedStyle(title).fontSize) : 0,
      body: paragraphStyle ? parseFloat(paragraphStyle.fontSize) : 0,
      zoom: paragraphStyle ? paragraphStyle.zoom : '',
      transform: paragraphStyle ? paragraphStyle.transform : '',
      katex: katex ? parseFloat(getComputedStyle(katex).fontSize) : 0,
      frameHeight: frame ? parseFloat(frame.style.height) || frame.getBoundingClientRect().height : 0,
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      parentFont: getComputedStyle(document.documentElement).fontSize,
      parentZoom: getComputedStyle(document.documentElement).zoom,
    };
  });
}

async function openLesson(page, origin, base, course, moduleId, text) {
  await page.goto(`${origin}${base}?view=reader&course=${course}&module=${moduleId}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction((needle) => {
    const frame = document.querySelector('#lesson-frame');
    return frame && frame.contentDocument?.body?.innerText.includes(needle);
  }, text, { timeout: 20000 });
  await page.waitForFunction(() => {
    const doc = document.querySelector('#lesson-frame')?.contentDocument;
    return [...(doc?.querySelectorAll('p') || [])].some((node) => node.getClientRects().length && (node.innerText || '').trim().length > 12);
  });
}

await mkdir(outDir, { recursive: true });
const browser = await chromium.launch({
  executablePath: '/usr/local/bin/google-chrome',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const servers = [];
try {
  for (const [base, port] of [['/', 8931], ['/learning-hub/', 8932]]) {
    await run(process.execPath, ['scripts/build.mjs'], { ...process.env, HUB_BASE: base });
    const server = await listen(port, path.join(root, 'dist'), base);
    servers.push(server);
    const origin = `http://127.0.0.1:${port}`;
    const label = base === '/' ? 'root' : 'pages';
    for (const [width, widthName] of [[1280, 'desktop'], [390, 'phone'], [360, 'narrow']]) {
      const page = await browser.newPage({ viewport: { width, height: 800 } });
      for (const [course, moduleId, text] of courses) {
        await openLesson(page, origin, base, course, moduleId, text);
        const before = await sample(page);
        await page.locator('#fsUp').click();
        await page.waitForFunction((start) => {
          const doc = document.querySelector('#lesson-frame')?.contentDocument;
          const paragraph = [...(doc?.querySelectorAll('p') || [])].find((node) => node.getClientRects().length && (node.innerText || '').trim().length > 12);
          return paragraph && parseFloat(getComputedStyle(paragraph).fontSize) > start + 0.5;
        }, before.body);
        const larger = await sample(page);
        await page.locator('#fsDown').click();
        await page.waitForFunction((start) => {
          const doc = document.querySelector('#lesson-frame')?.contentDocument;
          const paragraph = [...(doc?.querySelectorAll('p') || [])].find((node) => node.getClientRects().length && (node.innerText || '').trim().length > 12);
          return paragraph && parseFloat(getComputedStyle(paragraph).fontSize) < start - 0.5;
        }, larger.body);
        const smaller = await sample(page);
        const natural = before.zoom === '1' || before.zoom === 'normal';
        const plain = before.transform === 'none' && larger.transform === 'none';
        check(`${label} ${widthName} ${course} 正文 A+ 变大、A- 变小`, larger.body > before.body && smaller.body < larger.body && natural && plain, `before=${before.body} larger=${larger.body} smaller=${smaller.body} zoom=${before.zoom}`);
        check(`${label} ${widthName} ${course} 标题随字号变化且没有横向溢出`, larger.title > before.title && smaller.title < larger.title && larger.overflow <= 1, `title ${before.title}->${larger.title} overflow=${larger.overflow}`);
        if (course === 'nmr' && before.katex) {
          check(`${label} ${widthName} 公式字号不被阅读字号拉开`, Math.abs(larger.katex - before.katex) < 0.5, `${before.katex}->${larger.katex}`);
        }
      }
      if (width === 1280 && base === '/') {
        await openLesson(page, origin, base, 'nmr', 'nmr-2-1', '振幅');
        const start = (await sample(page)).body;
        await page.locator('#fsUp').click();
        await page.waitForFunction((size) => {
          const doc = document.querySelector('#lesson-frame')?.contentDocument;
          const paragraph = [...(doc?.querySelectorAll('p') || [])].find((node) => node.getClientRects().length && (node.innerText || '').trim().length > 12);
          return paragraph && parseFloat(getComputedStyle(paragraph).fontSize) > size + 0.5;
        }, start);
        const held = (await sample(page)).body;
        await page.locator('nav.pager a.next').click();
        await page.waitForFunction(() => location.search.includes('module=') && !location.search.includes('nmr-2-1'));
        await page.waitForFunction((size) => {
          const doc = document.querySelector('#lesson-frame')?.contentDocument;
          const paragraph = [...(doc?.querySelectorAll('p') || [])].find((node) => node.getClientRects().length && (node.innerText || '').trim().length > 12);
          return paragraph && Math.abs(parseFloat(getComputedStyle(paragraph).fontSize) - size) < 0.5;
        }, held);
        check('切章后保持本次阅读字号', true, `body=${held}`);
        await page.locator('.reading-size-note').click();
        const beforeUser = await page.evaluate(() => window.scrollY);
        await page.keyboard.press('PageDown');
        await page.waitForFunction((start) => window.scrollY > start + 40, beforeUser);
        const parked = await page.evaluate(() => window.scrollY);
        await page.evaluate(() => document.getElementById('open-settings').click());
        await page.waitForFunction(() => document.body.dataset.view === 'settings');
        await page.keyboard.press('PageDown');
        const locked = await page.evaluate(() => window.scrollY);
        check('设置打开时 PageDown 不滚动正文', Math.abs(locked - parked) <= 2, `parked=${parked} locked=${locked}`);
        await page.evaluate(() => document.getElementById('settings-back').click());
        await page.waitForFunction((top) => document.body.dataset.view === 'reader' && Math.abs(window.scrollY - top) <= 2, parked);
        check('设置返回后恢复真实翻页位置', true, `scrollY=${parked}`);
        await openLesson(page, origin, base, 'nmr', 'nmr-1-1', '仪器里有什么');
        const quiz = page.frameLocator('#lesson-frame');
        const readingMode = quiz.getByRole('button', { name: '切换为阅读全文' });
        if (await readingMode.count()) await readingMode.click();
        await quiz.locator('input[type="radio"]').first().click();
        await quiz.getByText(/理解正确|再想一步/).waitFor();
        check('放大字号后小测仍可作答', true);
      }
      if (widthName !== 'narrow') await page.screenshot({ path: path.join(outDir, `${label}_${widthName}_${courses[1][0]}.png`) }).then(() => shots.push(path.join(outDir, `${label}_${widthName}_nmr.png`)));
      await page.close();
    }
  }
} finally {
  await browser.close();
  servers.forEach((server) => server.close());
}

await run(process.execPath, ['scripts/build.mjs'], { ...process.env, HUB_BASE: '/' });
const profile = await import('node:os').then((os) => import('node:fs/promises').then((fs) => fs.mkdtemp(path.join(os.tmpdir(), 'reading-zoom-'))));
const zoomServer = spawn('python3', ['-m', 'http.server', '8933', '--bind', '127.0.0.1', '--directory', path.join(root, 'dist')], { stdio: 'ignore' });
const chrome = spawn('google-chrome', [
  '--no-sandbox', '--disable-dev-shm-usage', '--no-first-run', '--disable-translate',
  `--user-data-dir=${profile}`, '--window-size=1440,900', '--window-position=40,40',
  '--remote-debugging-port=9224', 'http://127.0.0.1:8933/?view=reader&course=nmr&module=nmr-2-1',
], { stdio: 'ignore' });
let zoomBrowser;
try {
  for (let attempt = 0; attempt < 40 && !zoomBrowser; attempt += 1) {
    try { zoomBrowser = await chromium.connectOverCDP('http://127.0.0.1:9224'); }
    catch { await new Promise((resolve) => setTimeout(resolve, 250)); }
  }
  if (!zoomBrowser) throw new Error('原生缩放用的 Chrome 没有打开调试端口');
  let page;
  for (let attempt = 0; attempt < 30 && !page; attempt += 1) {
    page = zoomBrowser.contexts()[0].pages().find((item) => item.url().includes('8933'));
    if (!page) await new Promise((resolve) => setTimeout(resolve, 200));
  }
  let id = '';
  for (let attempt = 0; attempt < 40 && !id; attempt += 1) {
    try {
      const ids = execFileSync('xdotool', ['search', '--name', '学习入口'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
      id = ids[ids.length - 1] || '';
    } catch { await new Promise((resolve) => setTimeout(resolve, 250)); }
  }
  if (!id) throw new Error('未找到标题含「学习入口」的 Chrome 窗口');
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
  await page.waitForFunction(() => document.querySelector('#lesson-frame')?.contentDocument?.body?.innerText.includes('振幅'));
  const metrics = await page.evaluate(() => ({
    font: getComputedStyle(document.documentElement).fontSize,
    scale: window.visualViewport.scale,
    zoom: getComputedStyle(document.documentElement).zoom,
    width: window.innerWidth,
  }));
  const before = await sample(page);
  await page.locator('#fsUp').click();
  await page.waitForTimeout(200);
  const after = await sample(page);
  check('原生 200% 下正文 A+ 仍增大且没有改浏览器缩放', metrics.font === '16px' && metrics.scale === 1 && metrics.zoom === '1' && metrics.width < 800 && after.body > before.body && after.transform === 'none', `${JSON.stringify(metrics)} ${before.body}->${after.body}`);
  await page.screenshot({ path: path.join(outDir, 'zoom_200_larger.png') });
  shots.push(path.join(outDir, 'zoom_200_larger.png'));
} finally {
  await zoomBrowser?.close().catch(() => {});
  chrome.kill('SIGTERM');
  zoomServer.kill('SIGTERM');
}

await mkdir(outDir, { recursive: true });
const report = [
  '# 阅读字号增量',
  '',
  'A+/A- 写入 iframe 正文的 font-size。没有使用 CSS zoom 或 transform 冒充字号，也没有改浏览器缩放。',
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
