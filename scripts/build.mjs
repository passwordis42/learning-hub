import { spawn } from 'node:child_process';
import { cp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeHubBase } from '../server/hub.mjs';
import { renderPublicBailianScript } from '../portal/assets/public-bailian.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function assertNode() {
  const major = Number(process.versions.node.split('.')[0]);
  if (major !== 24) {
    process.stderr.write(`learning-hub 需要 Node 24，当前是 ${process.versions.node}。\n`);
    process.exit(1);
  }
}

function run(command, args, cwd, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: 'inherit' });
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(' ')} failed in ${cwd}`));
    });
  });
}

function siteEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  delete env.LEARNING_HUB_PUBLIC_BAILIAN_KEY;
  return env;
}

assertNode();
const hubBase = normalizeHubBase(process.env.HUB_BASE ?? '/');
const dist = path.join(root, 'dist');
await rm(dist, { recursive: true, force: true });
await run('npm', ['run', 'build'], path.join(root, 'sites/ai-learning-atlas'), siteEnv());
await run('npm', ['run', 'build'], path.join(root, 'sites/nmr-from-zero'), siteEnv({ HUB_BASE: hubBase }));
await mkdir(dist, { recursive: true });
for (const name of await readdir(path.join(root, 'portal'))) {
  await cp(path.join(root, 'portal', name), path.join(dist, name), { recursive: true });
}
await cp(path.join(root, 'sites/ai-learning-atlas/dist'), path.join(dist, 'ai'), { recursive: true });
await cp(path.join(root, 'sites/nmr-from-zero/dist'), path.join(dist, 'nmr-from-zero'), { recursive: true });
await cp(path.join(root, 'sites/game-design-atlas/docs'), path.join(dist, 'game'), { recursive: true });
await cp(path.join(root, 'sites/game-design-atlas/AI-DEVELOPMENT.md'), path.join(dist, 'game', 'AI-DEVELOPMENT.md'));
await writeFile(path.join(dist, '.hub-base'), hubBase);
await writeFile(path.join(dist, 'assets/public-bailian-config.js'), renderPublicBailianScript(process.env));
const published = Boolean(String(process.env.LEARNING_HUB_PUBLIC_BAILIAN_KEY || '').trim());
process.stdout.write(`已汇总静态文件，HUB_BASE=${hubBase}\n`);
process.stdout.write(published
  ? '公开百炼配置已写入 dist/assets/public-bailian-config.js。构建日志不包含密钥。\n'
  : '未设置 LEARNING_HUB_PUBLIC_BAILIAN_KEY，发布页保持手填密钥。\n');
