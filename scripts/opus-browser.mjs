import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = '/opt/cursor/artifacts/opus-redesign';
const checks = [];
const shots = [];

function check(name, ok, detail = '') {
  checks.push({ name, ok: Boolean(ok), detail });
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}\n`);
}

function serve(directory, port) {
  const child = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1', '--directory', directory], { stdio: 'ignore' });
  return child;
}

function run(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, env, stdio: 'inherit' });
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`))));
  });
}

async function shot(page, name) {
  const file = path.join(outDir, name);
  await page.screenshot({ path: file, fullPage: false });
  shots.push(file);
}

await run(process.execPath, ['scripts/build.mjs'], { ...process.env, HUB_BASE: '/' });
const designPort = 8911;
const hubPort = 8912;
const designServer = serve('/tmp/learning-hub-opus-design', designPort);
const hubServer = serve(path.join(root, 'dist'), hubPort);
await new Promise((resolve) => setTimeout(resolve, 300));
const browser = await chromium.launch({
  executablePath: '/usr/local/bin/google-chrome',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader'],
});

try {
  const reference = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await reference.goto(`http://127.0.0.1:${designPort}/index.html`, { waitUntil: 'domcontentloaded' });
  await reference.waitForTimeout(800);
  await shot(reference, 'design_home.png');
  await reference.goto(`http://127.0.0.1:${designPort}/course.html#/ai`, { waitUntil: 'domcontentloaded' });
  await reference.waitForTimeout(600);
  await shot(reference, 'design_directory.png');
  await reference.goto(`http://127.0.0.1:${designPort}/course.html#/ai/4`, { waitUntil: 'domcontentloaded' });
  await reference.waitForTimeout(400);
  await shot(reference, 'design_reader.png');
  await reference.close();

  async function openHub(viewport, query = '') {
    const page = await browser.newPage({ viewport });
    const errors = [];
    const fontHosts = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    page.on('request', (request) => {
      if (request.url().includes('fonts.googleapis') || request.url().includes('fonts.gstatic')) fontHosts.push(request.url());
    });
    await page.goto(`http://127.0.0.1:${hubPort}/index.html${query}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !document.querySelector('#veil'));
    return { page, errors, fontHosts };
  }

  const desktop = await openHub({ width: 1280, height: 800 });
  const homeText = await desktop.page.locator('body').innerText();
  check('首页名称是学习入口', homeText.includes('学习入口') && !homeText.includes('开架'));
  check('未选岛时设施预览关闭', await desktop.page.locator('#dock').getAttribute('aria-hidden') === 'true');
  check('海面画布存在', await desktop.page.locator('#sea').evaluate((node) => node.width > 0));
  const webgl = await desktop.page.evaluate(() => {
    const canvas = document.querySelector('#sea');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    return Boolean(gl && !document.body.classList.contains('no-gl'));
  });
  check('桌面首页使用 WebGL1 海面', webgl);
  await shot(desktop.page, 'home_desktop.png');
  check('首页没有请求 Google Fonts', desktop.fontHosts.length === 0, desktop.fontHosts.join(' '));
  check('首页脚本没有抛错', desktop.errors.length === 0, desktop.errors.join(' | '));

  await desktop.page.locator('#btnList').focus();
  await desktop.page.keyboard.press('Enter');
  await desktop.page.waitForFunction(() => document.body.classList.contains('drawer-open'));
  await desktop.page.keyboard.press('Escape');
  await desktop.page.waitForFunction(() => !document.body.classList.contains('drawer-open'));
  check('目录可用 Enter 打开并用 Esc 关闭', true);
  await desktop.page.locator('.w-isle:not(.planned)').first().focus();
  await desktop.page.keyboard.press('Enter');
  await desktop.page.waitForFunction(() => document.querySelector('#dock')?.getAttribute('aria-hidden') === 'false');
  const dockText = await desktop.page.locator('#dock').innerText();
  check('选岛后才出现设施预览', dockText.includes('选岛后才出现本预览') && dockText.includes('AI 学习图谱'));
  await shot(desktop.page, 'island_desktop.png');
  await desktop.page.keyboard.press('Escape');
  await desktop.page.waitForFunction(() => document.querySelector('#dock')?.getAttribute('aria-hidden') === 'true');
  check('Esc 可以取消选岛', true);

  await desktop.page.locator('.w-isle:not(.planned)').first().click();
  await desktop.page.locator('#dock a.btn-primary').click();
  await desktop.page.waitForFunction(() => document.querySelector('.harbor') && document.body.innerText.includes('AI 学习图谱'));
  const directoryText = await desktop.page.locator('#courseMain').innerText();
  check('课程目录使用正式章节而不是示例课文', directoryText.includes('图谱总览') && !directoryText.includes('示例正文') && !directoryText.includes('设计稿说明'));
  await shot(desktop.page, 'directory_desktop.png');
  await desktop.page.locator('a[data-lesson-module="ai-tutor"]').click();
  await desktop.page.waitForFunction(() => document.querySelector('#lesson-frame')?.contentDocument?.body?.innerText.includes('AI 学伴'));
  check('阅读页嵌入正式课程', true);
  await shot(desktop.page, 'reader_desktop.png');
  await desktop.page.locator('#switcher a[data-course="nmr"]').click();
  await desktop.page.waitForFunction(() => document.querySelector('.harbor') && document.body.innerText.includes('从零看懂核磁共振'));
  check('课程切换进入另一门课的目录', true);
  await desktop.page.locator('#open-settings').click();
  await desktop.page.waitForFunction(() => document.body.dataset.view === 'settings' && document.activeElement?.id === 'settings-back');
  const stored = await desktop.page.evaluate(() => Object.keys(localStorage));
  check('打开设置不把密钥写入 localStorage', stored.every((key) => !/key|token|secret/i.test(key)), stored.join(','));
  await desktop.page.keyboard.press('Escape');
  await desktop.page.waitForFunction(() => document.body.dataset.view === 'reader');
  const backFocus = await desktop.page.evaluate(() => document.activeElement?.id);
  check('关闭设置后焦点回到打开它的按钮', backFocus === 'open-settings', backFocus);
  await desktop.page.close();

  for (const [width, name] of [[360, '360'], [390, '390']]) {
    const phone = await openHub({ width, height: 800 });
    const overflow = await phone.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(`${name} 首页没有横向溢出`, overflow <= 1, `overflow=${overflow}`);
    await shot(phone.page, `home_${name}.png`);
    await phone.page.locator('.w-isle:not(.planned)').nth(1).click();
    await phone.page.waitForFunction(() => document.querySelector('#dock')?.getAttribute('aria-hidden') === 'false');
    await shot(phone.page, `island_${name}.png`);
    await phone.page.locator('#dock a.btn-primary').click();
    await phone.page.waitForSelector('.harbor');
    const phoneOverflow = await phone.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(`${name} 课程目录没有横向溢出`, phoneOverflow <= 1, `overflow=${phoneOverflow}`);
    await shot(phone.page, `directory_${name}.png`);
    check(`${name} 没有脚本错误`, phone.errors.length === 0, phone.errors.join(' | '));
    await phone.page.close();
  }

  const fallback = await openHub({ width: 1280, height: 800 }, '?demo=nogl');
  await fallback.page.waitForFunction(() => document.body.classList.contains('no-gl'));
  await shot(fallback.page, 'home_nogl.png');
  await fallback.page.locator('#btnList').click();
  await fallback.page.locator('#courseList summary', { hasText: '游戏设计学习图谱' }).click();
  await fallback.page.locator('#courseList a.mini[href*="course=game"]').click();
  await fallback.page.waitForFunction(() => document.body.innerText.includes('游戏设计学习图谱'));
  check('海景降级后仍可从目录进入课程', true);
  await shot(fallback.page, 'directory_nogl.png');
  check('降级页没有脚本错误', fallback.errors.length === 0, fallback.errors.join(' | '));
  await fallback.page.close();
} finally {
  await browser.close();
  designServer.kill('SIGTERM');
  hubServer.kill('SIGTERM');
}

const report = [
  '# Opus 改版浏览器对照',
  '',
  '模拟浏览器为本机 headless Chrome。200% 原生缩放不在这份脚本里，由 scripts/zoom-browser.mjs 用真实窗口和 Ctrl+= 验证。这里没有测量设备 FPS。',
  '',
  ...checks.map((item) => `- ${item.ok ? 'PASS' : 'FAIL'} ${item.name}${item.detail ? ` — ${item.detail}` : ''}`),
  '',
  '## 截图',
  '',
  ...shots.map((file) => `- \`${file}\``),
  '',
  '原稿截图来自医生上传的静态稿，正文是排版示例。实现截图里的目录和 iframe 是正式课程。',
].join('\n');
await mkdir(outDir, { recursive: true });
await writeFile(path.join(outDir, 'report.md'), report);
process.stdout.write(`${report}\n`);
if (checks.some((item) => !item.ok)) process.exit(1);
