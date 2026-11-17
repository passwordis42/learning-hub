import { spawn } from 'node:child_process';
import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeHubBase } from '../server/hub.mjs';

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

assertNode();
const hubBase = normalizeHubBase(process.env.HUB_BASE ?? '/');
const dist = path.join(root, 'dist');
await rm(dist, { recursive: true, force: true });
await run('npm', ['run', 'build'], path.join(root, 'sites/ai-learning-atlas'), process.env);
await run('npm', ['run', 'build'], path.join(root, 'sites/nmr-from-zero'), { ...process.env, HUB_BASE: hubBase });
await mkdir(dist, { recursive: true });
await cp(path.join(root, 'public/index.html'), path.join(dist, 'index.html'));
await cp(path.join(root, 'sites/ai-learning-atlas/dist'), path.join(dist, 'ai'), { recursive: true });
await cp(path.join(root, 'sites/nmr-from-zero/dist'), path.join(dist, 'nmr-from-zero'), { recursive: true });
await cp(path.join(root, 'sites/game-design-atlas/docs'), path.join(dist, 'game'), { recursive: true });
await writeFile(path.join(dist, '.hub-base'), hubBase);
process.stdout.write(`已汇总静态文件，HUB_BASE=${hubBase}\n`);
