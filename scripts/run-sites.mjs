import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const sites = [
  { dir: 'sites/ai-learning-atlas', lock: true },
  { dir: 'sites/nmr-from-zero', lock: true },
  { dir: 'sites/game-design-atlas', lock: false },
];

function assertNode() {
  const major = Number(process.versions.node.split('.')[0]);
  if (major !== 24) {
    process.stderr.write(`learning-hub 需要 Node 24，当前是 ${process.versions.node}。\n`);
    process.exit(1);
  }
}

function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit' });
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(' ')} failed in ${cwd}`));
    });
  });
}

assertNode();
const action = process.argv[2];
if (action !== 'ci' && action !== 'test') {
  process.stderr.write('用法：node scripts/run-sites.mjs ci|test\n');
  process.exit(1);
}

let failed = 0;
for (const site of sites) {
  const cwd = path.join(root, site.dir);
  if (action === 'ci') {
    if (!site.lock) {
      process.stdout.write(`跳过 ${site.dir}：上游没有 package-lock.json，也没有依赖。\n`);
      continue;
    }
    await access(path.join(cwd, 'package-lock.json'));
    await run('npm', ['ci'], cwd);
    continue;
  }
  try {
    await run('npm', ['test'], cwd);
  } catch (error) {
    failed += 1;
    process.stderr.write(`${error.message}\n`);
  }
}
if (failed) process.exit(1);
