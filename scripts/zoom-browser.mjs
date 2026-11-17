import { spawn, execFileSync } from 'node:child_process';
import http from 'node:http';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const outDir = '/opt/cursor/artifacts';
const port = 8877;
const origin = `http://127.0.0.1:${port}`;
const checks = [];
const shots = [];

function check(name, ok, detail = '') {
  checks.push({ name, ok: Boolean(ok), detail });
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}\n`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function httpOk(url) {
  return new Promise((resolve) => {
    const request = http.get(url, (response) => {
      response.resume();
      resolve(response.statusCode >= 200 && response.statusCode < 500);
    });
    request.setTimeout(1000, () => { request.destroy(); resolve(false); });
    request.on('error', () => resolve(false));
  });
}

async function metrics(page) {
  return page.evaluate(() => ({
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    dpr: window.devicePixelRatio,
    scale: window.visualViewport ? window.visualViewport.scale : null,
    htmlFont: getComputedStyle(document.documentElement).fontSize,
    htmlZoom: getComputedStyle(document.documentElement).zoom,
    bodyZoom: getComputedStyle(document.body).zoom,
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }));
}

function chromeWindow() {
  const ids = execFileSync('xdotool', ['search', '--name', '开架'], { encoding: 'utf8' })
    .split('\n').map((item) => item.trim()).filter(Boolean);
  if (!ids.length) throw new Error('未找到标题含「开架」的 Chrome 窗口');
  return ids[ids.length - 1];
}

function zoomKey(combo) {
  const id = chromeWindow();
  execFileSync('xdotool', ['windowactivate', '--sync', id]);
  execFileSync('xdotool', ['key', '--window', id, '--clearmodifiers', combo]);
}

async function shot(page, name) {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve())));
  await sleep(80);
  const id = chromeWindow();
  const geometry = execFileSync('xdotool', ['getwindowgeometry', '--shell', id], { encoding: 'utf8' });
  const values = Object.fromEntries(geometry.trim().split('\n').map((line) => line.split('=')));
  const file = path.join(outDir, name);
  execFileSync('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-f', 'x11grab',
    '-video_size', `${values.WIDTH}x${values.HEIGHT}`,
    '-i', `${process.env.DISPLAY}+${values.X},${values.Y}`,
    '-frames:v', '1',
    file,
  ]);
  shots.push(file);
}

async function openReader(page, course, moduleId, text) {
  await page.goto(`${origin}/?view=reader&course=${course}&module=${moduleId}`, { waitUntil: 'domcontentloaded' });
  try {
    await page.waitForFunction((needle) => {
      const frame = document.querySelector('#lesson-frame');
      return frame && !frame.hidden && frame.contentDocument?.body?.innerText.includes(needle);
    }, text, { timeout: 20000 });
  } catch (error) {
    const snapshot = await page.evaluate(() => {
      const frame = document.querySelector('#lesson-frame');
      return {
        view: document.body.dataset.view,
        src: frame?.getAttribute('src') || '',
        hidden: frame?.hidden ?? null,
        text: frame?.contentDocument?.body?.innerText?.slice(0, 400) || '',
      };
    });
    throw new Error(`${error.message}\nreader ${course}/${moduleId} ${JSON.stringify(snapshot)}`);
  }
}

const profile = await mkdtemp(path.join(tmpdir(), 'hub-zoom-chrome-'));
const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1', '--directory', dist], {
  stdio: 'ignore',
});
const chrome = spawn('google-chrome', [
  '--no-sandbox',
  '--disable-dev-shm-usage',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-translate',
  '--lang=zh-CN',
  '--disable-features=Translate,TranslateUI',
  `--user-data-dir=${profile}`,
  '--window-size=1440,900',
  '--window-position=40,40',
  '--remote-debugging-port=9223',
  `${origin}/`,
], { stdio: 'ignore' });

let browser;
try {
  let serving = false;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    serving = await httpOk(`${origin}/`);
    if (serving) break;
    await sleep(150);
  }
  if (!serving) throw new Error('静态服务器没有开始响应');
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
      break;
    } catch {
      await sleep(200);
    }
  }
  if (!browser) throw new Error('Chrome 远程调试端口没有起来');
  let page;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    page = browser.contexts()[0].pages().find((item) => item.url().startsWith(origin));
    if (page) break;
    await sleep(200);
  }
  if (!page) throw new Error('Chrome 没有打开静态站点');
  await page.waitForSelector('h1');

  zoomKey('ctrl+0');
  await sleep(400);
  const at100 = await metrics(page);
  await shot(page, 'zoom_home_100.png');
  for (let step = 0; step < 5; step += 1) {
    zoomKey('ctrl+equal');
    await sleep(180);
  }
  await sleep(200);
  const at200 = await metrics(page);
  const widthRatio = at100.innerWidth / at200.innerWidth;
  const dprRatio = at200.dpr / at100.dpr;
  const native = widthRatio > 1.95 && widthRatio < 2.05
    && dprRatio > 1.95 && dprRatio < 2.05
    && at200.scale === 1
    && at200.htmlFont === at100.htmlFont
    && at200.htmlZoom === '1'
    && at200.bodyZoom === '1';
  check('Chrome 原生页面缩放到达 200%', native, `100%=${JSON.stringify(at100)} 200%=${JSON.stringify(at200)} widthRatio=${widthRatio.toFixed(3)} dprRatio=${dprRatio.toFixed(3)}`);
  if (!native) throw new Error('原生 200% 没有成立，后面的页面不能算作 200% 验证');

  async function layout(name) {
    const box = await metrics(page);
    const still = Math.abs((at100.innerWidth / box.innerWidth) - 2) < 0.08 && box.scale === 1 && box.htmlFont === '16px' && box.htmlZoom === '1';
    check(`${name} 仍是原生 200%`, still, JSON.stringify(box));
    check(`${name} 没有横向溢出`, box.overflow <= 1, `overflow=${box.overflow}`);
    return box;
  }

  await layout('首页');
  const homeControls = await page.evaluate(() => {
    const ids = ['nav-overview', 'open-settings', 'motion-toggle'];
    return ids.map((id) => {
      const el = document.getElementById(id);
      const rect = el.getBoundingClientRect();
      return {
        id,
        text: el.textContent.trim(),
        width: rect.width,
        top: rect.top,
        left: rect.left,
        right: rect.right,
        inside: rect.width > 8 && rect.left >= -1 && rect.right <= window.innerWidth + 1 && rect.top >= -1 && rect.bottom <= window.innerHeight + 1,
      };
    });
  });
  check('首页导航和暂停按钮在 200% 视口内', homeControls.every((item) => item.inside), JSON.stringify(homeControls));
  await page.locator('#nav-overview').focus();
  const homeFocus = await page.evaluate(() => document.activeElement?.id);
  check('首页导航可以获得焦点', homeFocus === 'nav-overview', homeFocus);
  await shot(page, 'zoom_home_200.png');

  await openReader(page, 'nmr', 'nmr-2-1', '振幅');
  const lessonFrame = page.frameLocator('#lesson-frame');
  await lessonFrame.getByRole('button', { name: '切换为阅读全文' }).click();
  const formula = lessonFrame.locator('details.formula summary').first();
  await formula.click();
  const katex = lessonFrame.locator('.katex').first();
  await katex.waitFor();
  const formulaText = await katex.innerText();
  let formulaBox = await katex.boundingBox();
  if (formulaBox && (formulaBox.y < 40 || formulaBox.y > 300)) {
    await page.evaluate((delta) => window.scrollBy(0, delta), formulaBox.y - 140);
    await sleep(200);
    formulaBox = await katex.boundingBox();
  }
  check('阅读页嵌入了实际公式', formulaText.includes('cos') && formulaBox && formulaBox.y > 40 && formulaBox.y < 300 && formulaBox.width > 20, `${formulaText.replace(/\s+/g, ' ').slice(0, 80)} ${JSON.stringify(formulaBox)}`);
  await shot(page, 'zoom_reader_formula_200.png');
  await layout('公式阅读');

  const endButton = page.frameLocator('#lesson-frame').getByRole('button', { name: '我理解了，标记本版完成' });
  await endButton.scrollIntoViewIfNeeded();
  const endBox = await endButton.boundingBox();
  check('课末完成按钮可见可点', Boolean(endBox && endBox.width > 8 && endBox.height > 8), JSON.stringify(endBox));
  await shot(page, 'zoom_reader_end_200.png');

  await openReader(page, 'nmr', 'nmr-1-1', '仪器里有什么');
  const lesson = page.frameLocator('#lesson-frame');
  const readingMode = lesson.getByRole('button', { name: /切换为/ });
  await readingMode.waitFor();
  if ((await readingMode.innerText()).includes('阅读全文')) await readingMode.click();
  await lesson.locator('input[type="radio"]').first().click();
  await lesson.getByText(/理解正确|再想一步/).waitFor();
  check('核磁小测可以作答并给出反馈', true);
  await layout('核磁小测');
  await shot(page, 'zoom_quiz_200.png');

  await openReader(page, 'nmr', 'nmr-lab-waves', '波');
  const opposed = page.frameLocator('#lesson-frame').getByRole('button', { name: '反相 · 180°' });
  await opposed.click();
  await page.waitForFunction(() => document.querySelector('#lesson-frame')?.contentDocument?.querySelector('button[aria-pressed="true"]')?.textContent?.includes('180'));
  check('核磁实验按钮可以按下', true);
  await layout('核磁实验');
  await shot(page, 'zoom_nmr_lab_200.png');

  await openReader(page, 'game', 'game-w01', '周');
  const game = page.frameLocator('#lesson-frame');
  await game.getByRole('link', { name: '交互实验' }).click();
  await game.locator('#lab-prediction').fill('我预测主通道能回到基地，因为耗电更稳定。');
  const typed = await game.locator('#lab-prediction').inputValue();
  await game.getByRole('button', { name: '锁定预测，开始实验' }).click();
  await game.getByRole('button', { name: '走主通道' }).click();
  await game.getByText('需要 5 格电').waitFor();
  check('游戏实验输入和按钮可用', typed.includes('主通道'));
  await layout('游戏实验');
  await shot(page, 'zoom_game_lab_200.png');

  await page.evaluate(() => {
    localStorage.setItem('learning-atlas:day-one-reflection', JSON.stringify({ rows: 2, reason: '因为示例里有重复。', evidence: '第 1 行和第 2 行。' }));
    localStorage.setItem('learning-atlas:day-one-scope', 'true');
  });
  await openReader(page, 'ai', 'ai-tutor', 'AI 学伴');
  const tutor = page.frameLocator('#lesson-frame');
  await tutor.getByRole('button', { name: '检查连接' }).click();
  await tutor.getByText('不能当作已经连通').waitFor();
  const tutorText = await tutor.locator('body').innerText();
  check('AI 学伴核对配置时不显示调用成功', !tutorText.includes('模型调用成功') && tutorText.includes('不能当作已经连通'));
  await layout('AI 学伴');
  await shot(page, 'zoom_tutor_200.png');

  await openReader(page, 'game', 'game-coach', '我的设计');
  const coach = page.frameLocator('#lesson-frame');
  await coach.locator('#coach-draft').waitFor();
  await coach.getByRole('button', { name: /连接本地助手|检查连接/ }).click();
  await coach.getByText('没有连接供应商').waitFor();
  const coachText = await coach.locator('body').innerText();
  check('游戏助手在没有配置时不显示已连接', coachText.includes('没有连接供应商') && !coachText.includes('已连接本地助手'));
  await layout('游戏助手');
  await shot(page, 'zoom_game_coach_200.png');

  await openReader(page, 'nmr', 'nmr-2-1', '振幅');
  await page.evaluate(() => window.scrollTo({ top: 480, behavior: 'instant' }));
  await page.waitForFunction(() => Math.abs(window.scrollY - 480) <= 2);
  await page.evaluate(() => document.getElementById('open-settings').click());
  await page.waitForFunction(() => document.body.dataset.view === 'settings');
  const settingsFocus = await page.evaluate(() => document.activeElement?.id);
  const settingsCopy = await page.locator('#settings-result').innerText();
  await page.locator('#settings-model').fill('zoom-check-model');
  const modelValue = await page.locator('#settings-model').inputValue();
  check('设置页打开后焦点在返回课程', settingsFocus === 'settings-back', settingsFocus);
  check('静态站点设置页只把密钥留在页面内存', settingsCopy.includes('页面内存') && settingsCopy.includes('没有连接供应商') && !settingsCopy.includes('配置已保存'), settingsCopy);
  check('设置页模型输入可以填写', modelValue === 'zoom-check-model', modelValue);
  await layout('助手设置');
  await shot(page, 'zoom_settings_200.png');
  await page.locator('#settings-back').click();
  const discard = page.locator('#settings-unsaved-discard');
  await discard.waitFor({ state: 'visible' });
  const discardBox = await discard.boundingBox();
  check('未保存更改对话框的按钮在视口内', Boolean(discardBox && discardBox.y >= 0 && discardBox.height > 8 && discardBox.y + discardBox.height <= at200.innerHeight + 1), JSON.stringify(discardBox));
  await shot(page, 'zoom_settings_unsaved_200.png');
  await discard.click();
  await page.waitForFunction(() => document.body.dataset.view === 'reader' && location.search.includes('module=nmr-2-1'));
  let restored = false;
  let restoreDetail = '';
  for (let attempt = 0; attempt < 15; attempt += 1) {
    restoreDetail = await page.evaluate(() => JSON.stringify({
      scrollY: window.scrollY,
      scrollHeight: document.documentElement.scrollHeight,
      innerHeight: window.innerHeight,
    }));
    restored = Math.abs(JSON.parse(restoreDetail).scrollY - 480) <= 2;
    if (restored) break;
    await sleep(100);
  }
  check('从设置返回后恢复阅读滚动位置', restored, restoreDetail);
  const backFocus = await page.evaluate(() => ({
    id: document.activeElement?.id,
    hidden: Boolean(document.activeElement?.closest('[hidden]')),
  }));
  check('返回后焦点在打开设置的按钮上', backFocus.id === 'open-settings' && !backFocus.hidden, JSON.stringify(backFocus));
  await page.evaluate(() => window.scrollTo({ top: 480, behavior: 'instant' }));
  await page.waitForFunction(() => Math.abs(window.scrollY - 480) <= 2);
  const beforeMax = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
  await page.evaluate(() => document.getElementById('open-settings').click());
  await page.waitForFunction(() => document.body.dataset.view === 'settings');
  await page.evaluate(() => {
    window.addEventListener('message', (event) => {
      if (event.data?.type === 'hub-embed-height') event.stopImmediatePropagation();
    }, true);
    const frame = document.getElementById('lesson-frame');
    frame.dataset.fullHeight = frame.style.height;
    frame.style.height = '1px';
    document.querySelector('.learning-sidebar').style.display = 'none';
    document.querySelector('.lesson-article').style.display = 'none';
  });
  await page.evaluate(() => document.getElementById('settings-back').click());
  await page.waitForFunction(() => document.body.dataset.view === 'reader');
  await page.waitForTimeout(800);
  const early = await page.evaluate(() => window.scrollY);
  const earlyMax = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
  await page.evaluate(() => {
    document.querySelector('.learning-sidebar').style.display = '';
    document.querySelector('.lesson-article').style.display = '';
    const frame = document.getElementById('lesson-frame');
    frame.style.height = frame.dataset.fullHeight || '4200px';
  });
  await page.waitForFunction(() => Math.abs(window.scrollY - 480) <= 2, null, { timeout: 4000 });
  const late = await page.evaluate(() => ({ scrollY: window.scrollY, max: document.documentElement.scrollHeight - window.innerHeight }));
  check('延迟布局稳定后恢复到 480 而不是停留在夹住的位置', early < 480 && earlyMax + 1 < 480 && Math.abs(late.scrollY - 480) <= 2, `early=${early} earlyMax=${earlyMax} late=${JSON.stringify(late)} beforeMax=${beforeMax}`);
  await page.mouse.wheel(0, 160);
  await page.waitForTimeout(700);
  const manual = await page.evaluate(() => window.scrollY);
  check('布局稳定后不再抢回滚动', Math.abs(manual - 480) > 20, `manual=${manual}`);
  await shot(page, 'zoom_reader_restored_200.png');
} catch (error) {
  process.stderr.write(`${error.stack || error}\n`);
  checks.push({ name: '脚本中断', ok: false, detail: String(error.message || error).slice(0, 800) });
} finally {
  await browser?.close().catch(() => {});
  chrome.kill('SIGTERM');
  server.kill('SIGTERM');
  await sleep(400);
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}

await mkdir(outDir, { recursive: true });
const failed = checks.filter((item) => !item.ok);
const report = [
  '# 原生 200% 页面缩放',
  '',
  '这不是公网页面。静态文件由本机 `python3 -m http.server` 只绑定 `127.0.0.1:8877`，目录是构建出的 `dist/`。Chrome 使用全新用户目录、窗口 1440×900，没有设置 `deviceScaleFactor`、CSS `zoom` 或页面字号。缩放由操作系统发给 Chrome 窗口的 `Ctrl+=` 完成，连按 5 次，这是 Chrome 从 100% 到 200% 的原生步进。',
  '',
  ...checks.map((item) => `- ${item.ok ? 'PASS' : 'FAIL'} ${item.name}${item.detail ? ` — ${item.detail}` : ''}`),
  '',
  '## 截图',
  '',
  ...shots.map((file) => `- \`${file}\``),
  '',
].join('\n');
await writeFile(path.join(outDir, 'zoom-browser-report.md'), report);
process.stdout.write(`${report}\n`);
if (failed.length) process.exit(1);
