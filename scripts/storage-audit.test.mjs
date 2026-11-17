import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const runtimeRoots = [
  'sites/ai-learning-atlas/src',
  'sites/ai-learning-atlas/server',
  'sites/nmr-from-zero/src',
  'sites/game-design-atlas/docs',
  'sites/game-design-atlas/server',
];
const storageFiles = new Set([
  'sites/ai-learning-atlas/src/App.jsx',
  'sites/nmr-from-zero/src/App.tsx',
  'sites/nmr-from-zero/src/progress.ts',
  'sites/game-design-atlas/docs/app.js',
  'sites/game-design-atlas/docs/experiments.js',
  'sites/game-design-atlas/docs/records.js',
]);

async function filesIn(directory) {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...await filesIn(full));
    else if (entry.isFile()) found.push(full);
  }
  return found;
}

test('shared-origin storage keys do not collide and no other web storage is used', async () => {
  const hits = [];
  for (const relativeRoot of runtimeRoots) {
    for (const full of await filesIn(path.join(root, relativeRoot))) {
      const relative = path.relative(root, full).split(path.sep).join('/');
      const source = await readFile(full, 'utf8');
      if (/sessionStorage|indexedDB|caches\.|serviceWorker|openDatabase/i.test(source)) {
        hits.push(`${relative} uses storage outside localStorage`);
      }
      if (source.includes('localStorage') && !storageFiles.has(relative)) hits.push(`${relative} writes unexpected localStorage`);
    }
  }
  assert.deepEqual(hits, []);

  const ai = await readFile(path.join(root, 'sites/ai-learning-atlas/src/App.jsx'), 'utf8');
  const aiKeys = [...ai.matchAll(/useProgress\('([^']+)'/g)].map((match) => `learning-atlas:${match[1]}`).sort();
  const nmr = await readFile(path.join(root, 'sites/nmr-from-zero/src/progress.ts'), 'utf8');
  const nmrKeys = [...nmr.matchAll(/export const (?:LEGACY_)?STORAGE_KEY = '([^']+)'/g)].map((match) => match[1]).sort();
  const experiments = await readFile(path.join(root, 'sites/game-design-atlas/docs/experiments.js'), 'utf8');
  const records = await readFile(path.join(root, 'sites/game-design-atlas/docs/records.js'), 'utf8');
  const gameKeys = [
    experiments.match(/const storageKey = '([^']+)'/)[1],
    records.match(/export const recordsKey = '([^']+)'/)[1],
    records.match(/export const resumeKey = '([^']+)'/)[1],
  ].sort();
  const all = [...aiKeys, ...nmrKeys, ...gameKeys];
  assert.equal(new Set(all).size, all.length);
  assert.deepEqual(aiKeys, [
    'learning-atlas:chapters',
    'learning-atlas:day-one-checklist',
    'learning-atlas:day-one-complete',
    'learning-atlas:day-one-experiment',
    'learning-atlas:day-one-guide',
    'learning-atlas:day-one-judgment-draft',
    'learning-atlas:day-one-reflection',
    'learning-atlas:day-one-scope',
    'learning-atlas:weekly-resume',
    'learning-atlas:weekly-study',
  ]);
  assert.deepEqual(nmrKeys, ['nmr-from-zero.progress.v1', 'nmr-from-zero.progress.v2']);
  assert.deepEqual(gameKeys, [
    'game-design-atlas:experiments:v1',
    'game-design-atlas:learning:v1',
    'game-design-atlas:resume:v1',
  ]);
});
