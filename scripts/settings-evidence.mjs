import { execFileSync, spawn } from 'node:child_process';
import http from 'node:http';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = '/opt/cursor/artifacts';
const port = 8097;
const key = 'sk-screenshot-not-real';
const checks = [];
const shots = [];

function assertNode() {
  const major = Number(process.versions.node.split('.')[0]);
  if (major !== 24) {
    process.stderr.write(`需要 Node 24，当前 ${process.version} ${process.execPath}\n`);
    process.exit(1);
  }
}

function check(name, ok, detail = '') {
  checks.push({ name, ok: Boolean(ok), detail });
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}\n`);
}

function listen(server) {
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve()));
}

async function banner(page, text) {
  await page.evaluate((message) => {
    let node = document.getElementById('evidence-banner');
    if (!node) {
      node = document.createElement('div');
      node.id = 'evidence-banner';
      node.style.cssText = 'position:fixed;left:8px;right:8px;bottom:8px;z-index:10000;background:#0a1c27;color:#fff;padding:8px 10px;border-radius:10px;font:600 13px/1.4 sans-serif;';
      document.body.append(node);
    }
    node.textContent = message;
  }, text);
}

async function shot(page, name) {
  const file = path.join(outDir, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  shots.push(file);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(`${name} 没有横向溢出`, overflow <= 1, `overflow=${overflow}`);
  const secret = await page.locator('body').innerText();
  check(`${name} 页面文字没有密钥`, !secret.includes(key));
}

async function openSettings(page) {
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded' });
  await page.locator('#btnAssist').click();
  await page.locator('#settings-connect').waitFor();
  await page.locator('[data-settings-vendor="qwen"][aria-pressed="true"]').waitFor();
}

async function chooseRegion(page, region) {
  await page.locator('#settings-region').selectOption(region);
}

const catalogBody = JSON.stringify({
  success: true,
  code: null,
  message: null,
  output: { total: 1, page_no: 1, page_size: 100, models: [{ model: 'mock-catalog-item' }] },
});

assertNode();
await mkdir(outDir, { recursive: true });
if (process.env.SETTINGS_EVIDENCE_SKIP_BUILD !== '1') {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['scripts/build.mjs'], { cwd: root, stdio: 'inherit', env: { ...process.env, HUB_BASE: '/' } });
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`build ${code}`))));
  });
}

const site = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://127.0.0.1:${port}`);
  const file = path.normalize(path.join(root, 'dist', decodeURIComponent(url.pathname)));
  const target = file.startsWith(path.join(root, 'dist')) ? file : '';
  const candidates = [target, path.join(target, 'index.html')].filter(Boolean);
  for (const candidate of candidates) {
    try {
      const body = await readFile(candidate);
      const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
      response.writeHead(200, { 'content-type': types[path.extname(candidate)] || 'application/octet-stream' });
      response.end(body);
      return;
    } catch { /* try the next candidate */ }
  }
  response.writeHead(404);
  response.end('missing');
});
await listen(site);

const browser = process.env.SETTINGS_EVIDENCE_ZOOM_ONLY === '1' ? null : await chromium.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

try {
  if (!browser) throw new Error('zoom-only');
  for (const [label, viewport] of [
    ['1280', { width: 1280, height: 800 }],
    ['390', { width: 390, height: 844 }],
    ['360', { width: 360, height: 780 }],
  ]) {
    const page = await browser.newPage({ viewport });
    page.setDefaultTimeout(12000);
    await openSettings(page);
    await banner(page, '实现页初始态。未调用供应商。空白配置默认百炼，没有预设模型。');
    check(`${label} 初始没有预设面板`, !(await page.locator('#fallback-pending').isVisible()));
    check(`${label} 初始高级设置折叠`, !(await page.locator('#settings-advanced').evaluate((el) => el.open)));
    await shot(page, `settings_initial_${label}`);

    await page.locator('#settings-key').fill(key);
    await page.locator('#settings-connect').click();
    await page.getByRole('heading', { name: '请补选密钥所在地区' }).waitFor();
    await banner(page, '缺地区。未向任何地区发送密钥，没有默认北京。');
    check(`${label} 缺地区时高级设置仍折叠`, !(await page.locator('#settings-advanced').evaluate((el) => el.open)));
    await shot(page, `settings_missing_region_${label}`);

    await chooseRegion(page, 'tokyo');
    await page.locator('#settings-continue').click();
    await page.locator('#workspace-error').waitFor();
    await banner(page, '东京缺少必要工作空间。只提示这一项，高级设置保持折叠。');
    check(`${label} 缺工作空间时高级设置仍折叠`, !(await page.locator('#settings-advanced').evaluate((el) => el.open)));
    check(`${label} 缺工作空间文案具体`, (await page.locator('#settings-result').innerText()).includes('工作空间'));
    await shot(page, `settings_missing_workspace_${label}`);

    await page.unrouteAll({ behavior: 'ignoreErrors' });
    let releaseLoading;
    const loadingGate = new Promise((resolve) => { releaseLoading = resolve; });
    await page.route('https://dashscope-us.aliyuncs.com/**', async (route) => {
      await loadingGate;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': `http://127.0.0.1:${port}` },
        body: catalogBody,
      });
    });
    await openSettings(page);
    await page.locator('#settings-key').fill(key);
    await page.locator('#settings-connect').click();
    await chooseRegion(page, 'virginia');
    await page.locator('#settings-continue').click();
    await page.getByText('正在只读请求已记载的模型列表').waitFor();
    await banner(page, '加载中。请求被测试拦住，尚未返回。模拟，不是真实密钥调用。');
    await shot(page, `settings_loading_${label}`);
    releaseLoading();
    await page.locator('#settings-model-select').selectOption('mock-catalog-item');
    await page.getByText('已取得这次的模型列表').waitFor();
    await banner(page, '模拟列表成功：平台目录 mock-catalog-item。不是真实密钥，不是已验证推理。');
    const successCopy = `${await page.locator('#settings-result').innerText()}\n${await page.locator('#model-source-hint').innerText()}`;
    check(`${label} 成功列表标明目录`, successCopy.includes('平台目录'));
    check(`${label} 成功态写明不是已验证可调用`, successCopy.includes('不是已验证可调用'));
    await page.locator('#settings-model-select').scrollIntoViewIfNeeded();
    await shot(page, `settings_list_success_mock_${label}`);

    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await page.route('https://dashscope-us.aliyuncs.com/**', (route) => route.abort('failed'));
    await openSettings(page);
    await page.locator('#settings-key').fill(key);
    await page.locator('#settings-connect').click();
    await chooseRegion(page, 'virginia');
    await page.locator('#settings-continue').click();
    await page.locator('#fallback-pending').waitFor();
    await page.getByText('预设（未验证权限）').first().waitFor();
    await banner(page, '模拟网络失败后的预设回退。不是已连接。高级设置保持折叠。');
    const failureText = await page.locator('#settings-result').innerText();
    check(`${label} 失败写网络或跨域`, failureText.includes('网络或跨域访问失败'), failureText);
    check(`${label} 失败不称已取得列表`, !failureText.includes('已取得这次的模型列表'));
    check(`${label} 失败时高级设置折叠`, !(await page.locator('#settings-advanced').evaluate((el) => el.open)));
    check(`${label} 自定义模型入口可见`, await page.locator('#settings-model').isVisible());
    await page.locator('#preset-model').scrollIntoViewIfNeeded();
    await shot(page, `settings_failure_preset_${label}`);

    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await openSettings(page);
    await page.evaluate(() => {
      window.ATLAS_ASSISTANT.saveVendor('openai', { model: 'kept-openai-model', apiKey: 'sk-screenshot-not-real' });
      window.ATLAS_ASSISTANT.saveVendor('qwen', {
        region: 'singapore',
        workspaceId: 'wsdemo1',
        model: 'kept-qwen-model',
        apiKey: 'sk-screenshot-not-real',
      });
      window.ATLAS_SETTINGS.reload();
    });
    await page.getByText('kept-qwen-model').waitFor();
    await banner(page, '已有非空配置。预设没有覆盖已保存模型，地区是上次明确选择。');
    check(`${label} 旧千问配置不是预设`, !(await page.locator('#fallback-pending').isVisible()));
    check(`${label} 沿用已选地区`, (await page.locator('#inherited-region-hint').innerText()).includes('新加坡'));
    await shot(page, `settings_old_config_qwen_${label}`);
    await page.locator('[data-settings-vendor="openai"]').click();
    await page.locator('#settings-model').waitFor();
    check(`${label} 其他厂商没有灌入千问`, (await page.locator('#settings-model').inputValue()) === 'kept-openai-model');
    await banner(page, '切到 OpenAI。模型仍是 kept-openai-model，没有写入 qwen3.7-flash。');
    await shot(page, `settings_old_config_openai_${label}`);

    await page.unroute('https://dashscope-us.aliyuncs.com/**').catch(() => {});
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await page.route('https://dashscope-us.aliyuncs.com/**', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 600));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': `http://127.0.0.1:${port}` },
        body: JSON.stringify({ success: true, output: { total: 1, models: [{ model: 'mock-stale-item' }] } }),
      });
    });
    await openSettings(page);
    await page.locator('#settings-key').fill(key);
    await page.locator('#settings-connect').click();
    await chooseRegion(page, 'virginia');
    await page.evaluate(() => {
      document.getElementById('settings-continue').click();
      const select = document.getElementById('settings-region');
      select.value = 'singapore';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.waitForTimeout(900);
    const staleText = await page.locator('body').innerText();
    check(`${label} 过期响应没有回填`, !staleText.includes('mock-stale-item'), staleText.includes('请重新连接') ? '已提示重新连接' : staleText.slice(0, 180));
    await banner(page, '过期响应防护：地区已改，迟到的模拟列表没有回填。');
    await shot(page, `settings_stale_guard_${label}`);
    await page.close();
  }
} catch (error) {
  if (error.message !== 'zoom-only') throw error;
} finally {
  if (browser) await browser.close();
}

try {
  await captureNativeZoom();
} finally {
  site.close();
}

async function captureNativeZoom() {
  const profile = await mkdtemp(path.join(tmpdir(), 'settings-zoom-'));
  const chrome = spawn('/usr/bin/google-chrome', [
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--no-first-run',
    '--disable-translate',
    '--lang=zh-CN',
    `--user-data-dir=${profile}`,
    '--window-size=1440,900',
    '--window-position=40,40',
    '--remote-debugging-port=9226',
    `http://127.0.0.1:${port}/`,
  ], { stdio: 'ignore' });
  let zoomBrowser;
  try {
    for (let attempt = 0; attempt < 40 && !zoomBrowser; attempt += 1) {
      try {
        zoomBrowser = await chromium.connectOverCDP('http://127.0.0.1:9226');
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
    if (!zoomBrowser) throw new Error('9226 没有就绪');
    let page;
    for (let attempt = 0; attempt < 30 && !page; attempt += 1) {
      page = zoomBrowser.contexts()[0].pages().find((item) => item.url().includes(`127.0.0.1:${port}`));
      if (!page) await new Promise((resolve) => setTimeout(resolve, 200));
    }
    if (!page) throw new Error('原生缩放窗口没有打开');
    const zoomKey = (combo) => {
      const id = chromeWindowId();
      execFileSync('xdotool', ['windowactivate', '--sync', id]);
      execFileSync('xdotool', ['key', '--window', id, '--clearmodifiers', combo]);
    };
    zoomKey('ctrl+0');
    await page.waitForTimeout(300);
    const at100 = await page.evaluate(() => ({ width: window.innerWidth, dpr: window.devicePixelRatio, scale: window.visualViewport?.scale, font: getComputedStyle(document.documentElement).fontSize }));
    for (let step = 0; step < 5; step += 1) {
      zoomKey('ctrl+equal');
      await page.waitForTimeout(160);
    }
    const at200 = await page.evaluate(() => ({ width: window.innerWidth, dpr: window.devicePixelRatio, scale: window.visualViewport?.scale, font: getComputedStyle(document.documentElement).fontSize, zoom: getComputedStyle(document.documentElement).zoom }));
    const native = at100.width / at200.width > 1.95 && at100.width / at200.width < 2.05
      && at200.dpr / at100.dpr > 1.95 && at200.dpr / at100.dpr < 2.05
      && at200.scale === 1 && at200.font === at100.font && at200.zoom === '1';
    check('Chrome 原生页面缩放 200%', native, JSON.stringify({ at100, at200 }));
    if (!native) return;
    await page.locator('#btnAssist').click();
    await page.locator('#settings-connect').waitFor();
    await banner(page, '原生 200% 初始态。不是 CSS zoom。');
    grabWindow('settings_initial_zoom200');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check('200% 初始没有横向溢出', overflow <= 1, `overflow=${overflow}`);
    await page.locator('#settings-key').fill(key);
    await page.locator('#settings-connect').click();
    await page.getByRole('heading', { name: '请补选密钥所在地区' }).waitFor();
    await banner(page, '原生 200% 缺地区。未向供应商发送密钥。');
    grabWindow('settings_missing_region_zoom200');
    await page.route('https://dashscope-us.aliyuncs.com/**', (route) => route.abort('failed'));
    await page.locator('#settings-region').selectOption('virginia');
    await page.locator('#settings-continue').click();
    await page.locator('#preset-model').waitFor();
    await page.locator('#preset-model').scrollIntoViewIfNeeded();
    await banner(page, '原生 200% 模拟网络失败后的预设。不是已连接。');
    grabWindow('settings_failure_preset_zoom200');
  } catch (error) {
    check('Chrome 原生页面缩放 200%', false, error.message);
  } finally {
    if (zoomBrowser) await zoomBrowser.close();
    chrome.kill('SIGTERM');
  }
}

function chromeWindowId() {
  const ids = execFileSync('xdotool', ['search', '--onlyvisible', '--class', 'google-chrome'], { encoding: 'utf8' }).split('\n').map((item) => item.trim()).filter(Boolean);
  if (!ids.length) throw new Error('没有可见的 Chrome 窗口');
  return ids.at(-1);
}

function grabWindow(name) {
  const id = chromeWindowId();
  const geometry = execFileSync('xdotool', ['getwindowgeometry', '--shell', id], { encoding: 'utf8' });
  const values = Object.fromEntries(geometry.trim().split('\n').map((line) => line.split('=')));
  const file = path.join(outDir, `${name}.png`);
  execFileSync('ffmpeg', [
    '-y', '-loglevel', 'error', '-f', 'x11grab',
    '-video_size', `${values.WIDTH}x${values.HEIGHT}`,
    '-i', `${process.env.DISPLAY}+${values.X},${values.Y}`,
    '-frames:v', '1', file,
  ]);
  shots.push(file);
}

const failed = checks.filter((item) => !item.ok);
const summary = {
  node: process.version,
  execPath: process.execPath,
  note: '列表成功、加载和过期响应用 Playwright 拦截的模拟响应。无认证预检不能当作已认证浏览器调用。',
  checks,
  shots,
  failed: failed.length,
};
await writeFile(path.join(outDir, 'settings-evidence.json'), JSON.stringify(summary, null, 2));
process.stdout.write(`${JSON.stringify({ node: summary.node, execPath: summary.execPath, failed: failed.length, shots: shots.length }, null, 2)}\n`);
if (failed.length) process.exit(1);
