import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
process.stderr.write('已废弃：scripts/ui-qa.mjs 仍按旧的 #settings-test 和托管设置文案编写。它不能当作当前设置区的通过结果，也不计入本 PR 的测试计数。\n');
process.exit(2);
const rootUnused = root;
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

const evidence = [];

async function measure(page, selector, inFrame) {
  return page.evaluate(({ selector, inFrame }) => {
    const frameNode = document.querySelector('#lesson-frame');
    const root = inFrame ? frameNode?.contentDocument : document;
    const node = root?.querySelector(selector);
    if (!node || !frameNode && inFrame) return { found: false, selector };
    const rect = node.getBoundingClientRect();
    const origin = inFrame ? frameNode.getBoundingClientRect() : { top: 0, left: 0 };
    const top = origin.top + rect.top;
    const bottom = origin.top + rect.bottom;
    const left = origin.left + rect.left;
    const right = origin.left + rect.right;
    const style = getComputedStyle(node);
    return {
      found: true,
      selector,
      text: (node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 220),
      fontSize: style.fontSize,
      background: style.backgroundColor,
      color: style.color,
      border: style.borderColor,
      top, bottom, left, right,
      viewport: { width: innerWidth, height: innerHeight, scrollY },
      visible: top < innerHeight - 8 && bottom > 8 && right > 8 && left < innerWidth - 8 && (bottom - top) > 6,
    };
  }, { selector, inFrame });
}

async function requireVisible(page, selector, inFrame, label) {
  const box = await measure(page, selector, inFrame);
  evidence.push({ label, ...box });
  if (!box.found || !box.visible) throw new Error(`${label} not in viewport ${JSON.stringify(box)}`);
  return box;
}

function applyTextZoom(doc) {
  const view = doc.defaultView;
  for (const el of [doc.body, ...doc.body.querySelectorAll('*')]) {
    if (el.dataset.qaBaseFont) continue;
    const px = Number.parseFloat(view.getComputedStyle(el).fontSize);
    if (!px) continue;
    el.dataset.qaBaseFont = String(px);
    el.style.setProperty('font-size', `${px * 2}px`, 'important');
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
  await page.evaluate(() => { document.documentElement.style.scrollBehavior = 'auto'; });
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
      await page.evaluate(() => { document.documentElement.style.scrollBehavior = 'auto'; });
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
      await page.waitForFunction(() => document.querySelector('#settings-status')?.textContent?.includes('配置已保存'));
      await page.evaluate(() => {
        const node = document.querySelector('#settings-status');
        const top = node.getBoundingClientRect().top + window.scrollY;
        window.scrollTo(0, Math.max(0, top - 160));
      });
      const saved = await requireVisible(page, '#settings-status', false, 'save success status');
      if (!saved.text.includes('配置已保存')) throw new Error(saved.text);
      if (await page.locator('#settings-key').inputValue() !== '') throw new Error('key read back');
      if ((await page.locator('body').innerText()).includes('sk-ui-qa-not-a-real-key')) throw new Error('key visible');
      await shot(page, 'settings_save_success');
      await page.locator('#settings-test').click();
      await page.locator('#settings-result').getByText('AI 学伴：只核对已保存的密钥和模型。没有向上游发送请求，不能当作服务可达。').waitFor();
      await page.locator('#settings-result').getByText('游戏助手：只核对已保存的密钥和模型。没有向上游发送请求，不能当作服务可达。').waitFor();
      await page.locator('#settings-result').scrollIntoViewIfNeeded();
      await shot(page, 'settings_status_ai_game');

      await page.locator('#settings-model').fill('dirty-model');
      await page.locator('[data-settings-vendor="anthropic"]').click();
      await page.locator('#settings-unsaved-dialog').waitFor({ state: 'visible' });
      if (await page.evaluate(() => document.activeElement?.id) !== 'settings-unsaved-keep') throw new Error('unsaved focus');
      await shot(page, 'settings_unsaved_dialog');
      await page.locator('#settings-unsaved-keep').click();

      await page.locator('#settings-clear').scrollIntoViewIfNeeded();
      const scrollBeforeDialog = await page.evaluate(() => window.scrollY);
      await page.evaluate(() => {
        const button = document.getElementById('settings-clear');
        button.focus();
        button.click();
      });
      await page.locator('#settings-clear-dialog').waitFor({ state: 'visible' });
      const trap = [await page.evaluate(() => document.activeElement?.id)];
      if (trap[0] !== 'settings-clear-cancel') throw new Error(`clear focus ${trap[0]}`);
      for (let step = 0; step < 4; step += 1) {
        await page.keyboard.press('Tab');
        trap.push(await page.evaluate(() => ({
          id: document.activeElement?.id || document.activeElement?.textContent?.slice(0, 20),
          inside: Boolean(document.activeElement?.closest('#settings-clear-dialog')),
        })));
      }
      if (trap.slice(1).some((item) => !item.inside)) throw new Error(`focus left dialog ${JSON.stringify(trap)}`);
      evidence.push({ label: 'clear dialog tab sequence', selector: '#settings-clear-dialog', trap, scrollBeforeDialog });
      await shot(page, 'settings_clear_dialog');
      await page.locator('#settings-clear-cancel').click();
      const afterCancel = await page.evaluate(() => ({ id: document.activeElement?.id, scrollY }));
      if (afterCancel.id !== 'settings-clear') throw new Error(`focus not restored ${afterCancel.id}`);
      if (Math.abs(afterCancel.scrollY - scrollBeforeDialog) > 2) throw new Error(`dialog scroll changed ${scrollBeforeDialog} -> ${afterCancel.scrollY}`);
      evidence.push({ label: 'clear dialog cancel restoration', selector: '#settings-clear', ...afterCancel });

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
      const sessionToken = (await readFile(path.join(path.dirname(clean.ASSISTANT_CONFIG_PATH), 'hub-session'), 'utf8')).trim();
      await fetch('http://127.0.0.1:8094/api/assistant-config/clear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Hub-Session': sessionToken },
        body: JSON.stringify({ confirm: 'clear-assistant-configuration' }),
      });
      await page.close();
    });

    await record('reader formula, code theme, zoom, mobile end, scroll, focus and back', async () => {
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      await openReader(page, 'nmr', 'nmr-2-2', '箭头的影子');
      await frame(page).getByRole('button', { name: '切换为阅读全文' }).click();
      await frame(page).locator('.formula summary').click();
      await page.evaluate(() => { document.documentElement.style.overflowAnchor = 'none'; });
      for (let attempt = 0; attempt < 4; attempt += 1) {
        await frame(page).locator('.formula .katex').first().evaluate((node) => node.scrollIntoView({ block: 'center', behavior: 'instant' }));
        await page.waitForTimeout(200);
      }
      const formula = await requireVisible(page, '.formula .katex', true, 'formula');
      const formulaMarks = await page.evaluate(() => {
        const node = document.querySelector('#lesson-frame').contentDocument.querySelector('.formula .katex');
        const box = node.getBoundingClientRect();
        const scripts = [...node.querySelectorAll('.mtight')].map((el) => {
          const rect = el.getBoundingClientRect();
          return { text: el.textContent.replace(/\s+/g, '').slice(0, 16), dy: Math.round(rect.top - box.top) };
        });
        const lowest = Math.max(...scripts.map((item) => item.dy));
        const highest = Math.min(...scripts.map((item) => item.dy));
        return {
          sub: scripts.some((item) => item.text === '0' && item.dy > highest + 6),
          sup: scripts.some((item) => item.text.includes('−') && item.dy < lowest - 6),
          scripts,
          text: node.textContent.replace(/\s+/g, ' ').slice(0, 180),
        };
      });
      evidence.push({ label: 'formula structure', selector: '.formula .katex', ...formulaMarks });
      if (!/[ωπφϕΔ]/.test(formulaMarks.text) || !formulaMarks.sub || !formulaMarks.sup) throw new Error(JSON.stringify(formulaMarks));
      const pinned = await requireVisible(page, '.formula .katex', true, 'formula immediately before screenshot');
      if (Math.abs(pinned.top - formula.top) > 40) throw new Error(`formula moved before shot ${formula.top} -> ${pinned.top}`);
      await shot(page, 'reader_formula_desktop');
      const clip = {
        x: Math.max(0, Math.floor(pinned.left)),
        y: Math.max(0, Math.floor(pinned.top - 36)),
        width: Math.min(1000, Math.ceil(pinned.right - pinned.left)),
        height: 140,
      };
      for (const directory of outDirs) {
        await page.screenshot({ path: path.join(directory, 'uiqa_reader_formula_clip.png'), clip });
      }
      const afterShot = await measure(page, '.formula .katex', true);
      evidence.push({ label: 'formula after screenshot', ...afterShot, clip });
      if (!afterShot.visible || Math.abs(afterShot.top - pinned.top) > 40) throw new Error(`formula moved during shot ${JSON.stringify(afterShot)}`);

      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForFunction(() => {
        const frameNode = document.querySelector('#lesson-frame');
        const done = [...frameNode.contentDocument.querySelectorAll('button')].find((node) => node.textContent.includes('标记本版完成'));
        if (!done) return false;
        const top = frameNode.getBoundingClientRect().top + done.getBoundingClientRect().top + scrollY;
        return top <= document.documentElement.scrollHeight - 120;
      });
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await page.evaluate(() => {
          const frameNode = document.querySelector('#lesson-frame');
          const done = [...frameNode.contentDocument.querySelectorAll('button')].find((node) => node.textContent.includes('标记本版完成'));
          const link = document.querySelector('#lesson-source');
          const doneTop = frameNode.getBoundingClientRect().top + done.getBoundingClientRect().top + scrollY;
          const linkTop = link.getBoundingClientRect().top + scrollY;
          const target = Math.max(0, Math.min(doneTop - 80, linkTop - (innerHeight - 180)));
          window.scrollTo({ top: target, behavior: 'instant' });
        });
        await page.waitForTimeout(200);
      }
      await requireVisible(page, '.lesson-completion button', true, 'mobile completion');
      const completion = await measure(page, '.lesson-completion button', true);
      if (!completion.text.includes('标记本版完成') && !completion.text.includes('已完成本课')) throw new Error(completion.text);
      await requireVisible(page, '.lesson-pagination a', true, 'mobile next lesson');
      await requireVisible(page, '#lesson-source', false, 'mobile standalone link');
      await shot(page, 'reader_mobile_end');

      await page.setViewportSize({ width: 1280, height: 800 });
      await openReader(page, 'ai', 'ai-day1', 'tickets.csv');
      await frame(page).getByRole('button', { name: '查看样本并预测' }).click();
      await frame(page).locator('.code-frame').evaluate((node) => node.scrollIntoView({ block: 'center' }));
      const card = await requireVisible(page, '.code-frame', true, 'sample card');
      const purple = (color) => {
        const match = String(color).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        if (!match) return false;
        const [red, green, blue] = match.slice(1).map(Number);
        return blue > green + 15 && red > green;
      };
      if (purple(card.background) || purple(card.border)) throw new Error(JSON.stringify(card));
      const download = await requireVisible(page, '.code-frame .small-action', true, 'download sample');
      if (purple(download.color) || purple(download.background)) throw new Error(JSON.stringify(download));
      const summary = await measure(page, '.guide-sample summary', true);
      if (purple(summary.color)) throw new Error(JSON.stringify(summary));
      const step = await measure(page, '.guide-step-dot', true);
      if (purple(step.background) || purple(step.color)) throw new Error(JSON.stringify(step));
      await frame(page).locator('.guide-outline').first().evaluate((node) => node.scrollIntoView({ block: 'center' }));
      await requireVisible(page, '.guide-outline', true, 'lesson steps');
      const resources = await measure(page, '.guide-resources summary', true);
      if (purple(resources.color)) throw new Error(JSON.stringify(resources));
      await shot(page, 'v04_steps_desktop');
      await frame(page).locator('.code-frame').evaluate((node) => node.scrollIntoView({ block: 'center' }));
      await requireVisible(page, '.code-frame', true, 'sample card in view for screenshot');
      await shot(page, 'v04_code_card_desktop');
      await page.setViewportSize({ width: 390, height: 844 });
      await frame(page).locator('.code-frame').evaluate((node) => node.scrollIntoView({ block: 'center' }));
      await requireVisible(page, '.code-frame', true, 'sample card phone');
      await shot(page, 'v04_code_card_phone');

      await page.setViewportSize({ width: 1280, height: 800 });
      await openReader(page, 'nmr', 'nmr-1-1', '仪器里有什么');
      await frame(page).locator('.page-heading p, .lesson-heading p').first().evaluate((node) => node.scrollIntoView({ block: 'center' }));
      const beforeTitle = await requireVisible(page, '#lesson-title', false, 'zoom passage title before');
      const beforeBody = await requireVisible(page, '.page-heading p, .lesson-heading p', true, 'zoom passage body before');
      await shot(page, 'reader_zoom_before');
      await page.evaluate(applyTextZoom, await page.evaluateHandle(() => document));
      const frameHandle = await page.evaluateHandle(() => document.querySelector('#lesson-frame').contentDocument);
      await page.evaluate(applyTextZoom, frameHandle);
      await frame(page).locator('.page-heading p, .lesson-heading p').first().evaluate((node) => node.scrollIntoView({ block: 'center' }));
      const afterTitle = await requireVisible(page, '#lesson-title', false, 'zoom passage title after');
      const afterBody = await requireVisible(page, '.page-heading p, .lesson-heading p', true, 'zoom passage body after');
      const ratio = (next, previous) => Number.parseFloat(next) / Number.parseFloat(previous);
      evidence.push({
        label: '200 percent text method',
        method: 'Once per element, read computed font-size, then set inline font-size to twice that value with !important. Applied separately to the portal document and the embedded lesson document. Not image scaling and not a font-size change on the portal root alone.',
        viewport: afterBody.viewport,
        title: { selector: '#lesson-title', before: beforeTitle.fontSize, after: afterTitle.fontSize, ratio: ratio(afterTitle.fontSize, beforeTitle.fontSize) },
        passage: { selector: '.page-heading p, .lesson-heading p', before: beforeBody.fontSize, after: afterBody.fontSize, ratio: ratio(afterBody.fontSize, beforeBody.fontSize), text: afterBody.text },
        layout: await page.evaluate(() => {
          const frameNode = document.querySelector('#lesson-frame');
          const doc = frameNode.contentDocument.documentElement;
          return {
            portalOverflowX: document.documentElement.scrollWidth - innerWidth,
            embedOverflowX: doc.scrollWidth - frameNode.clientWidth,
            viewport: { width: innerWidth, height: innerHeight, scrollY },
          };
        }),
      });
      if (ratio(afterTitle.fontSize, beforeTitle.fontSize) < 1.9 || ratio(afterBody.fontSize, beforeBody.fontSize) < 1.9) {
        throw new Error(JSON.stringify(evidence.at(-1)));
      }
      await shot(page, 'reader_zoom_200_desktop');
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

for (const directory of outDirs) {
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, 'ui-qa-evidence.json'), JSON.stringify({ sha, checks, evidence }, null, 2));
}
const failed = checks.filter((item) => !item.ok);
const report = [
  `# Developer UI script after 3e424630`,
  '',
  `Tree under test: \`${sha}\`. Produced by \`scripts/ui-qa.mjs\` on this working tree. This is the author's own script, not an independent reviewer result. Interaction has not been accepted by an independent UI review.`,
  '',
  'Each screenshot below was taken only after the script measured the named element and found its rectangle inside the viewport. Measurements are in `ui-qa-evidence.json`.',
  '',
  '## Checks',
  '',
  ...checks.map((item) => `- ${item.ok ? 'SCRIPT PASS' : 'SCRIPT FAIL'} \`${item.name}\`${item.error ? `: ${item.error}` : ''}`),
  '',
  '## Screenshots',
  '',
  ...shots.map((item) => `- \`${item.file}\` from check \`${item.test}\``),
  '',
  'Settings auth, timeout, and network images are labeled mock responses from the test route. They are not live provider results. The status image is the real local status check and says the model call was not made. No real API key or external model call was used.',
  '',
  failed.length ? `Script failures: ${failed.length}` : 'Script failures: 0. Independent review is still pending.',
].join('\n');
for (const directory of outDirs) {
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, 'ui-qa-report.md'), report);
}
process.stdout.write(`${report}\n`);
if (failed.length) process.exit(1);
