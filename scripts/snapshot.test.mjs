import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(await readFile(path.join(root, 'provenance/source-manifest.json'), 'utf8'));
const ignoredDirs = new Set(['node_modules', 'dist']);
const ignoredFiles = new Set(['tsconfig.tsbuildinfo']);

async function filesIn(directory) {
  const found = [];
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (ignoredDirs.has(entry.name) || ignoredFiles.has(entry.name)) continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...await filesIn(full));
    else if (entry.isFile()) found.push(full);
  }
  return found;
}

function blob(file) {
  return execFileSync('git', ['hash-object', file], { encoding: 'utf8' }).trim();
}

test('pinned snapshots match upstream blobs except the documented NMR base adaptation', async () => {
  assert.equal(manifest.adaptations.length, 1);
  const adaptation = manifest.adaptations[0];
  assert.equal(adaptation.path, 'sites/nmr-from-zero/vite.config.ts');
  const seen = new Set();
  for (const source of manifest.sources) {
    assert.match(source.sha, /^[0-9a-f]{40}$/);
    for (const file of source.files) {
      const relative = path.posix.join(source.dest, file.path);
      seen.add(relative);
      const full = path.join(root, relative);
      const actual = blob(full);
      if (relative === adaptation.path) {
        assert.equal(file.blob, adaptation.originalBlob);
        assert.notEqual(actual, file.blob);
        const sourceText = await readFile(full, 'utf8');
        assert.match(sourceText, /function siteBase\(\)/);
        assert.match(sourceText, /return '\/nmr-from-zero\/'/);
        assert.match(sourceText, /return `\$\{raw\}nmr-from-zero\/`/);
      } else {
        assert.equal(actual, file.blob, relative);
      }
    }
  }
  for (const source of manifest.sources) {
    const present = await filesIn(path.join(root, source.dest));
    for (const full of present) {
      const relative = path.relative(root, full).split(path.sep).join('/');
      assert.equal(seen.has(relative), true, `unexpected file ${relative}`);
    }
  }
});
