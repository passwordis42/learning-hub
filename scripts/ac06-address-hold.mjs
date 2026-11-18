import { spawn } from 'node:child_process';
import http from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = process.env.AC06_OUT || '/tmp/ac06-evidence';
const key = 'sk-screenshot-not-real';
const checks = [];
const shots = [];
const catalogBody = JSON.stringify({
  success: true,
  code: null,
  message: null,
  output: { total: 1, page_no: 1, page_size: 100, models: [{ model: 'mock-catalog-item' }] },
});

function assertNode() {
  const major = Number(process.versions.node.split('.')[0]);
  if (major !== 24) {
    process.stderr.write(`需要 Node 24，当前 ${process.version} ${process.execPath}\n`);
    process.exit(1);
  }
}

function check(name, ok, detail = '') {
  checks.push({ name, ok: Boolean(ok), detail: String(detail) });
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}\n`);
}

function git(args) {
  return spawnGit(args);
}

function spawnGit(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd: root });
    let out = '';
    child.stdout.on('data', (chunk) => { out += chunk; });
    child.on('exit', (code) => (code === 0 ? resolve(out.trim()) : reject(new Error(`git ${args.join(' ')} ${code}`))));
  });
}

assertNode();
await mkdir(outDir, { recursive: true });
if (process.env.AC06_SKIP_BUILD !== '1') {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['scripts/build.mjs'], {
      cwd: root,
      stdio: 'inherit',
      env: { ...process.env, HUB_BASE: '/' },
    });
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`build ${code}`))));
  });
}
const hubBase = (await readFile(path.join(root, 'dist', '.hub-base'), 'utf8')).trim();
if (hubBase !== '/') throw new Error(`构建前缀是 ${hubBase}`);

const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2' };
const site = http.createServer(async (request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  const file = path.normalize(path.join(root, 'dist', decodeURIComponent(url.pathname)));
  const base = path.join(root, 'dist');
  for (const candidate of [file, path.join(file, 'index.html')].filter((item) => item.startsWith(base))) {
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

function fulfillCatalog(route) {
  return route.fulfill({
    status: 200,
    contentType: 'application/json',
    headers: { 'access-control-allow-origin': origin },
    body: catalogBody,
  });
}

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });

async function shot(page, name) {
  const file = path.join(outDir, name);
  await page.screenshot({ path: file });
  shots.push(file);
}

async function openSettings(page) {
  await page.goto(`${origin}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#wTitle');
  const collapsed = await page.evaluate(() => document.body.classList.contains('w-collapsed'));
  if (!collapsed) await page.locator('#wMin').click();
  await page.locator('#btnAssist').click();
  await page.locator('#settings-page').waitFor();
}

async function connectCatalog(page) {
  await page.locator('#settings-key').fill(key);
  await page.locator('#settings-connect').click();
  await page.locator('#settings-region').selectOption('virginia');
  await page.locator('#settings-continue').click();
  await page.getByText('已取得这次的模型列表').waitFor();
}

async function editorState(page) {
  return page.evaluate(() => {
    const advanced = document.getElementById('settings-advanced');
    const address = document.getElementById('settings-address');
    return {
      phase: document.getElementById('settings-page').dataset.phase,
      advancedHidden: advanced.hidden,
      advancedOpen: advanced.open,
      applyHidden: document.getElementById('apply-actions').hidden,
      modelHidden: document.getElementById('model-panel').hidden,
      value: address.value,
      placeholder: address.placeholder,
      result: document.getElementById('settings-result').innerText,
      source: document.getElementById('model-source-hint').innerText,
    };
  });
}

function cleared(state) {
  return state.phase !== 'list'
    && !state.result.includes('已取得这次的模型列表')
    && state.result.includes('请重新连接')
    && state.modelHidden
    && !state.source.includes('平台目录');
}

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const external = [];
  page.on('request', (request) => {
    if (!request.url().startsWith(origin)) external.push(request.url());
  });
  await page.route('https://dashscope-us.aliyuncs.com/**', fulfillCatalog);
  await openSettings(page);
  const blank = await editorState(page);
  check('空白初始高级设置隐藏', blank.advancedHidden && !blank.advancedOpen && blank.phase === 'idle', JSON.stringify(blank));
  check('空白初始占位文案未改', blank.placeholder === '仅在需要覆盖自动配置时填写', blank.placeholder);
  await shot(page, 'ac06_blank_advanced_hidden_1280.png');

  await connectCatalog(page);
  const listed = await editorState(page);
  check('列表成功后高级设置默认折叠', !listed.advancedHidden && !listed.advancedOpen && listed.phase === 'list', JSON.stringify({ hidden: listed.advancedHidden, open: listed.advancedOpen, phase: listed.phase }));
  check('列表成功标明平台目录 mock', listed.result.includes('已取得这次的模型列表') && listed.source.includes('平台目录') && listed.source.includes('不是已验证可调用'));
  await shot(page, 'ac06_list_advanced_collapsed_1280.png');

  await page.locator('#settings-advanced').evaluate((el) => { el.open = true; });
  await page.locator('#settings-address').click();
  await page.locator('#settings-address').press('h');
  const one = await editorState(page);
  const addressVisible = await page.locator('#settings-address').isVisible();
  const applyVisible = await page.locator('#settings-save').isVisible();
  check('输入一个字符后列表作废', cleared(one), one.result);
  check('输入一个字符后高级区仍展开且字段可达', addressVisible && applyVisible && !one.advancedHidden && one.advancedOpen && one.value === 'h', JSON.stringify(one));
  await shot(page, 'ac06_address_one_char_stays_1280.png');

  await page.locator('#settings-address').pressSequentially('ttps://custom.example/v1');
  const continued = await editorState(page);
  check('可以继续把地址输入完整', continued.value === 'https://custom.example/v1' && !continued.advancedHidden && continued.advancedOpen && cleared(continued), continued.value);
  await shot(page, 'ac06_address_continued_1280.png');

  await page.locator('#settings-address').fill('');
  const undone = await editorState(page);
  check('可以撤销半截地址且高级区仍在', undone.value === '' && !undone.advancedHidden && undone.advancedOpen && await page.locator('#settings-address').isVisible(), undone.value);
  await shot(page, 'ac06_address_undo_1280.png');
  await page.locator('#settings-connect').click();
  await page.getByText('已取得这次的模型列表').waitFor();
  const restored = await editorState(page);
  check('撤销后重新连接可以再次取得 mock 列表', restored.phase === 'list' && restored.result.includes('已取得这次的模型列表'), restored.result);

  await page.locator('#settings-advanced').evaluate((el) => { el.open = true; });
  let releaseLate;
  const lateGate = new Promise((resolve) => { releaseLate = resolve; });
  let lateFulfilled = 0;
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await page.route('https://dashscope-us.aliyuncs.com/**', async (route) => {
    await lateGate;
    lateFulfilled += 1;
    await fulfillCatalog(route);
  });
  await page.locator('#settings-connect').click();
  await page.getByText('正在只读请求已记载的模型列表').waitFor();
  await page.locator('#settings-address').press('y');
  await page.getByText('请重新连接').waitFor();
  releaseLate();
  await page.waitForTimeout(500);
  const stale = await editorState(page);
  check('延迟响应不恢复已作废列表', cleared(stale) && stale.value === 'y' && !stale.advancedHidden && stale.advancedOpen, stale.result);
  check('延迟响应确实被测试放行过', lateFulfilled === 1, String(lateFulfilled));
  await shot(page, 'ac06_stale_response_1280.png');

  async function overrideCase(side, host) {
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await page.route('https://dashscope-us.aliyuncs.com/**', fulfillCatalog);
    await openSettings(page);
    await connectCatalog(page);
    await page.locator('#settings-advanced').evaluate((el) => { el.open = true; });
    await page.locator('#settings-overrides').evaluate((el) => { el.open = true; });
    const before = external.length;
    await page.locator(`#settings-${side}-mode`).selectOption('custom');
    const still = await editorState(page);
    check(`${side} 切到空的单独配置不改变路由，列表仍在`, still.phase === 'list' && still.result.includes('已取得这次的模型列表'), still.result);
    await page.locator(`#settings-${side}-address`).press('z');
    const typed = await editorState(page);
    const visible = await page.locator(`#settings-${side}-address`).isVisible();
    const leaked = external.slice(before).filter((url) => url.includes(host));
    check(`${side} 覆盖地址一个字符作废列表且高级区仍在`, visible && typed.advancedOpen && !typed.advancedHidden && cleared(typed) && await page.locator(`#settings-${side}-address`).inputValue() === 'z', typed.result);
    check(`${side} 覆盖地址没有向该主机发请求`, leaked.length === 0, leaked.join(' '));
    await shot(page, `ac06_${side}_override_one_char_1280.png`);
    await page.locator(`#settings-${side}-address`).fill(`https://${host}/v1`);
    await page.locator(`#settings-${side}-mode`).selectOption('inherit');
    const inherited = await editorState(page);
    check(`${side} 从单独配置改回继承后列表不会自己恢复`, inherited.phase !== 'list' && !inherited.result.includes('已取得这次的模型列表'), inherited.result);
    await page.locator('#settings-connect').click();
    await page.getByText('已取得这次的模型列表').waitFor();
    await page.locator('#settings-advanced').evaluate((el) => { el.open = true; });
    await page.locator('#settings-overrides').evaluate((el) => { el.open = true; });
    await page.locator(`#settings-${side}-mode`).selectOption('custom');
    const switched = await editorState(page);
    const overrideValue = await page.locator(`#settings-${side}-address`).inputValue();
    check(`${side} 已有覆盖地址时切到单独配置会作废列表`, cleared(switched) && switched.advancedOpen && !switched.advancedHidden && overrideValue === `https://${host}/v1`, switched.result);
    await shot(page, `ac06_${side}_mode_switch_1280.png`);
  }

  await overrideCase('ai', 'ai-override.example');
  await overrideCase('game', 'game-override.example');

  const narrow = await browser.newPage({ viewport: { width: 360, height: 780 } });
  await narrow.route('https://dashscope-us.aliyuncs.com/**', fulfillCatalog);
  await openSettings(narrow);
  await connectCatalog(narrow);
  await narrow.locator('#settings-advanced').evaluate((el) => { el.open = true; });
  await narrow.locator('#settings-address').press('h');
  const narrowState = await editorState(narrow);
  check('360 输入一个字符后地址框仍可见', await narrow.locator('#settings-address').isVisible() && narrowState.value === 'h' && narrowState.advancedOpen && cleared(narrowState), narrowState.result);
  await shot(narrow, 'ac06_address_one_char_stays_360.png');
  await narrow.close();
  await page.close();
} finally {
  await browser.close();
  site.close();
}

const head = await git(['rev-parse', 'HEAD']);
const dirty = await git(['status', '--porcelain']);
const { createHash } = await import('node:crypto');
const servedSettings = createHash('sha256').update(await readFile(path.join(root, 'dist/assets/settings.js'))).digest('hex');
const sourceSettings = createHash('sha256').update(await readFile(path.join(root, 'portal/assets/settings.js'))).digest('hex');
const report = {
  gitSha: head,
  dirty,
  origin,
  port,
  hubBase,
  node: process.version,
  execPath: process.execPath,
  sourceSettingsSha256: sourceSettings,
  servedSettingsSha256: servedSettings,
  mockBoundary: '本地 Playwright 拦截 https://dashscope-us.aliyuncs.com 的目录 GET，返回 mock-catalog-item。没有真实密钥，没有推理请求。AI/游戏覆盖主机没有收到请求。',
  passed: checks.filter((item) => item.ok).length,
  failed: checks.filter((item) => !item.ok).length,
  checks,
  shots,
};
await writeFile(path.join(outDir, 'ac06-report.json'), JSON.stringify(report, null, 2));
const lines = [
  `# AC06 地址编辑保持可达`,
  '',
  `- git SHA：\`${head}\`${dirty ? `（工作区不干净：${dirty}）` : ''}`,
  `- origin：\`${origin}\`，构建前缀 \`${hubBase}\``,
  `- Node：\`${process.execPath}\` ${process.version}`,
  `- settings.js SHA256：\`${sourceSettings}\``,
  `- dist/assets/settings.js SHA256：\`${servedSettings}\``,
  `- 界限：${report.mockBoundary}`,
  `- 结果：${report.passed} 通过，${report.failed} 失败`,
  '',
  ...checks.map((item) => `- ${item.ok ? 'PASS' : 'FAIL'} ${item.name}${item.detail ? ` — ${item.detail}` : ''}`),
];
await writeFile(path.join(outDir, 'ac06-report.md'), lines.join('\n'));
process.stdout.write(`AC06 ${report.passed} pass ${report.failed} fail\n`);
if (report.failed) process.exit(1);
