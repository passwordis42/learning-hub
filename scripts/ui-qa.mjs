import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const sha = process.env.QA_SHA || 'uncommitted';
const outDirs = ['/opt/cursor/artifacts', '/cursor/stores/self/artifacts'];
const shots = [];
const checks = [];

function run(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, env, stdio: 'inherit' });
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`))));
  });
}

function start(command, args, env) {
  const child = spawn(command, args, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  return child;
}

async function waitFor(url) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).ok) return;
    } catch { /* retry */ }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`timeout ${url}`);
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
  const fileName = `uiqa_${name}.png`;
  for (const directory of outDirs) {
    await mkdir(directory, { recursive: true });
    await page.screenshot({ path: path.join(directory, fileName) });
  }
  shots.push({ name, file: fileName, test: name });
}

function frame(page) {
  return page.frameLocator('#lesson-frame');
}

async function openReader(page, course, moduleId, text) {
  await page.goto(`http://127.0.0.1:8094/?view=reader&course=${course}&module=${moduleId}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction((needle) => {
    const node = document.querySelector('#lesson-frame');
    return node && !node.hidden && node.contentDocument?.body?.innerText.includes(needle);
  }, text, { timeout: 20000 });
}

const node = process.execPath;
const clean = { ...process.env, HUB_BASE: '/', PORT: '8094', ASSISTANT_CONFIG_PATH: path.join(tmpdir(), `ui-qa-${process.pid}.json`) };
for (const key of Object.keys(clean)) if (/KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL/i.test(key)) delete clean[key];
clean.HUB_BASE = '/';
clean.PORT = '8094';
clean.ASSISTANT_CONFIG_PATH = path.join(tmpdir(), `ui-qa-${process.pid}.json`);

await run(node, ['scripts/build.mjs'], clean);
const server = start(node, ['server/hub.mjs'], clean);
try {
  await waitFor('http://127.0.0.1:8094/');
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    await record('V01 desktop reader has one visible title and the lesson text', async () => {
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      await openReader(page, 'nmr', 'nmr-1-1', '仪器里有什么');
      const state = await page.evaluate(() => {
        const frameNode = document.querySelector('#lesson-frame');
        const inner = frameNode.contentDocument;
        const innerH1 = inner.querySelector('h1');
        const style = innerH1 ? getComputedStyle(innerH1) : null;
        return {
          prose: document.body.innerText.includes('已迁入的课程模块') || document.body.innerText.includes('本节课程'),
          titles: [...document.querySelectorAll('h1')].filter((node) => node.getClientRects().length > 0).map((node) => node.textContent),
          innerClipped: style ? style.position === 'absolute' && style.width === '1px' : false,
          lesson: inner.body.innerText.includes('仪器里有什么'),
          tocs: document.querySelectorAll('#lesson-nav').length,
          sidebar: getComputedStyle(inner.querySelector('.sidebar')).display,
        };
      });
      if (state.prose || state.titles.length !== 1 || !state.innerClipped || !state.lesson || state.tocs !== 1 || state.sidebar !== 'none') {
        throw new Error(JSON.stringify(state));
      }
      await shot(page, 'v01_reader_nmr_desktop');
      await page.close();
    });

    await record('V01 phone and 360 reader keep the lesson and do not overflow', async () => {
      for (const [width, name] of [[390, 'v01_reader_nmr_phone'], [360, 'v01_reader_360']]) {
        const page = await browser.newPage({ viewport: { width, height: 780 } });
        await openReader(page, 'nmr', 'nmr-7-1', '永磁');
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        const text = await page.locator('#lesson-title').innerText();
        if (!text.includes('永磁') || overflow > 1) throw new Error(`${width} ${text} overflow ${overflow}`);
        if ((await page.locator('body').innerText()).includes('门户导读')) throw new Error('guide still present');
        await shot(page, name);
        await page.close();
      }
    });

    await record('V02 lesson end has a small standalone link and no guide card', async () => {
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      await openReader(page, 'nmr', 'nmr-1-1', '仪器里有什么');
      const lesson = frame(page);
      await lesson.getByRole('button', { name: '切换为阅读全文' }).click();
      await lesson.locator('input[type="radio"]').first().click();
      await lesson.getByText(/理解正确|再想一步/).waitFor();
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      const end = await page.evaluate(() => {
        const link = document.querySelector('#lesson-source');
        const style = getComputedStyle(link);
        return {
          guide: document.body.innerText.includes('门户导读'),
          card: !!document.querySelector('.teaching-entry'),
          linkSize: parseFloat(style.fontSize),
          sources: document.querySelector('#lesson-repo')?.textContent || '',
        };
      });
      if (end.guide || end.card || end.linkSize > 16 || !end.sources.includes('源仓库')) throw new Error(JSON.stringify(end));
      await shot(page, 'v02_reader_end_desktop');
      await page.setViewportSize({ width: 390, height: 844 });
      await shot(page, 'v02_reader_end_phone');
      await page.close();
    });

    await record('V03 tutor uses teal paper colors', async () => {
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      await page.goto('http://127.0.0.1:8094/', { waitUntil: 'domcontentloaded' });
      await page.evaluate(() => {
        localStorage.setItem('learning-atlas:day-one-reflection', JSON.stringify({ rows: 2, reason: '因为示例里有重复。', evidence: '第 1 行和第 2 行。' }));
        localStorage.setItem('learning-atlas:day-one-scope', 'true');
      });
      await openReader(page, 'ai', 'ai-tutor', '已使用本机统一入口');
      const colors = await page.evaluate(() => {
        const tutor = document.querySelector('#lesson-frame').contentDocument.querySelector('.atlas-tutor');
        const style = getComputedStyle(tutor);
        return { border: style.borderColor, background: style.backgroundColor };
      });
      if (colors.border.includes('223, 216, 236') || colors.background.includes('244, 240, 251')) throw new Error(JSON.stringify(colors));
      await shot(page, 'v03_tutor_desktop');
      await page.close();
    });

    await record('settings states and danger control', async () => {
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      await page.goto('http://127.0.0.1:8094/?view=settings&course=nmr&module=nmr-1-1', { waitUntil: 'domcontentloaded' });
      await page.locator('#settings-vendor').waitFor();
      await page.waitForFunction(() => document.querySelector('#settings-key-status')?.textContent?.includes('密钥'));
      const danger = await page.locator('#settings-clear').evaluate((node) => {
        const style = getComputedStyle(node);
        return { height: parseFloat(style.minHeight), radius: style.borderRadius, text: node.textContent };
      });
      if (danger.height < 44 || !danger.radius || danger.radius === '0px' || !danger.text.includes('清除此厂商')) throw new Error(JSON.stringify(danger));
      await shot(page, 'settings_initial_desktop');
      await page.setViewportSize({ width: 390, height: 844 });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (overflow > 1) throw new Error(`settings phone overflow ${overflow}`);
      await shot(page, 'settings_initial_phone');
      await page.setViewportSize({ width: 1280, height: 800 });

      await page.locator('#settings-model').fill('hub-ui-qa-model');
      await page.locator('#settings-key').fill('sk-ui-qa-not-a-real-key');
      await page.locator('#settings-save').click();
      await page.getByText('配置已保存').waitFor();
      if (await page.locator('#settings-key').inputValue() !== '') throw new Error('key read back');
      if ((await page.locator('body').innerText()).includes('sk-ui-qa-not-a-real-key')) throw new Error('key visible');
      await shot(page, 'settings_save_success');
      await page.locator('#settings-test').click();
      await page.locator('#settings-result').getByText('AI 学伴：服务可达，模型调用尚未验证。').waitFor();
      await page.locator('#settings-result').getByText('游戏助手：服务可达，模型调用尚未验证。').waitFor();
      await page.locator('#settings-result').scrollIntoViewIfNeeded();
      await shot(page, 'settings_status_ai_game');

      await page.locator('#settings-model').fill('dirty-model');
      await page.locator('[data-settings-vendor="anthropic"]').click();
      await page.locator('#settings-unsaved-dialog').waitFor({ state: 'visible' });
      if (await page.evaluate(() => document.activeElement?.id) !== 'settings-unsaved-keep') throw new Error('unsaved focus');
      await shot(page, 'settings_unsaved_dialog');
      await page.locator('#settings-unsaved-keep').click();

      await page.locator('#settings-clear').click();
      await page.locator('#settings-clear-dialog').waitFor({ state: 'visible' });
      if (await page.evaluate(() => document.activeElement?.id) !== 'settings-clear-cancel') throw new Error('clear focus');
      await shot(page, 'settings_clear_dialog');
      await page.locator('#settings-clear-cancel').click();

      await page.route(/\/api\/assistant-config\/test$/, async (route) => {
        const body = JSON.parse(route.request().postData() || '{}');
        const kind = body.vendor === 'anthropic' ? 'timeout' : 'auth';
        const message = kind === 'timeout' ? '请求超时。请稍后重试。' : '认证失败。请检查已保存的密钥和访问权限，保存后重试。';
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            scope: 'status',
            vendor: body.vendor,
            mocked: 'ui-qa-fixture',
            ai: { course: 'AI 学伴', code: kind, message },
            game: { course: '游戏助手', code: kind, message },
          }),
        });
      });
      await page.locator('#settings-model').fill('hub-ui-qa-model');
      await page.locator('#settings-save').click();
      await page.getByText('配置已保存').waitFor();
      await page.locator('#settings-test').click();
      await page.locator('#settings-result').getByText('AI 学伴：认证失败。请检查已保存的密钥和访问权限，保存后重试。').waitFor();
      await page.locator('#settings-result').scrollIntoViewIfNeeded();
      await shot(page, 'settings_error_auth_mock');
      await page.locator('[data-settings-vendor="anthropic"]').click();
      await page.locator('#settings-test').click();
      await page.locator('#settings-result').getByText('AI 学伴：请求超时。请稍后重试。').waitFor();
      await page.locator('#settings-result').scrollIntoViewIfNeeded();
      await shot(page, 'settings_error_timeout_mock');
      await page.unrouteAll({ behavior: 'ignoreErrors' });
      await page.route(/\/api\/assistant-config\/test$/, (route) => route.abort());
      await page.locator('#settings-test').click();
      await page.getByText('后端不可达').waitFor();
      await page.locator('#settings-result').scrollIntoViewIfNeeded();
      await shot(page, 'settings_error_network_mock');
      await page.unrouteAll({ behavior: 'ignoreErrors' });
      await fetch('http://127.0.0.1:8094/api/assistant-config/clear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: 'clear-assistant-configuration' }),
      });
      await page.close();
    });

    await record('reader formula, code, zoom, scroll, focus and back', async () => {
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      await openReader(page, 'nmr', 'nmr-1-1', '仪器里有什么');
      await frame(page).getByRole('button', { name: '切换为阅读全文' }).click();
      await frame(page).getByText('查看关系与符号').click();
      await frame(page).locator('.katex').first().waitFor();
      await shot(page, 'reader_formula_desktop');
      await openReader(page, 'ai', 'ai-day1', 'tickets.csv');
      await frame(page).getByRole('button', { name: '查看样本并预测' }).click();
      await frame(page).locator('pre code').first().evaluate((node) => node.scrollIntoView({ block: 'center' }));
      await shot(page, 'reader_code_desktop');
      await openReader(page, 'nmr', 'nmr-1-1', '仪器里有什么');
      await page.evaluate(() => { document.documentElement.style.fontSize = '32px'; });
      await page.frameLocator('#lesson-frame').locator('body').evaluate(() => { document.documentElement.style.fontSize = '32px'; });
      await page.waitForTimeout(300);
      const zoomed = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth - window.innerWidth,
        nested: (() => {
          const doc = document.querySelector('#lesson-frame').contentDocument.documentElement;
          return doc.scrollHeight - doc.clientHeight;
        })(),
      }));
      if (zoomed.overflow > 1) throw new Error(`zoom overflow ${zoomed.overflow}`);
      await shot(page, 'reader_zoom_200_desktop');
      await page.evaluate(() => { document.documentElement.style.fontSize = ''; });
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      const bottom = await page.evaluate(() => {
        const frameNode = document.querySelector('#lesson-frame');
        const doc = frameNode.contentDocument.documentElement;
        return {
          tocs: document.querySelectorAll('#lesson-nav').length,
          nested: doc.scrollHeight - doc.clientHeight,
          atEnd: window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 4,
        };
      });
      if (bottom.tocs !== 1 || bottom.nested > 24 || !bottom.atEnd) throw new Error(JSON.stringify(bottom));
      await shot(page, 'reader_scroll_bottom_desktop');
      await page.locator('#lesson-title').focus();
      if (await page.evaluate(() => document.activeElement?.id) !== 'lesson-title') throw new Error('title focus');
      await page.evaluate(() => {
        document.documentElement.style.scrollBehavior = 'auto';
        document.body.style.minHeight = '4000px';
        window.scrollTo({ top: 640, behavior: 'instant' });
      });
      await page.evaluate(() => document.getElementById('open-settings').click());
      await page.evaluate(() => document.getElementById('settings-back').click());
      await page.waitForFunction(() => document.body.dataset.view === 'reader' && Math.abs(window.scrollY - 640) <= 2);
      await page.setViewportSize({ width: 390, height: 844 });
      await shot(page, 'reader_mobile_restored');
      await page.close();
    });
  } finally {
    await browser.close();
  }
} finally {
  server.kill('SIGTERM');
}

const failed = checks.filter((item) => !item.ok);
const report = [
  `# UI verification after d5543e12`,
  '',
  `Commit under test: \`${sha}\`. These screenshots were produced by \`scripts/ui-qa.mjs\` after that commit's fixes. They do not belong to the earlier review of \`d5543e12\`.`,
  '',
  '## Checks',
  '',
  ...checks.map((item) => `- ${item.ok ? 'PASS' : 'FAIL'} \`${item.name}\`${item.error ? `: ${item.error}` : ''}`),
  '',
  '## Screenshots',
  '',
  ...shots.map((item) => `- \`${item.file}\` from check \`${item.test}\``),
  '',
  'Settings auth, timeout, and network images are labeled mock responses from the test route. They are not live provider results. The status image is the real local status check and says the model call was not made. No real API key or external model call was used.',
  '',
  failed.length ? `Failed: ${failed.length}` : 'Failed: 0',
].join('\n');
for (const directory of outDirs) {
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, 'ui-qa-report.md'), report);
}
process.stdout.write(`${report}\n`);
if (failed.length) process.exit(1);
