import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

async function filesIn(directory) {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...await filesIn(full));
    else found.push(full);
  }
  return found;
}

test('opus redesign keeps the original ocean and the real course shell', async () => {
  const index = await readFile(path.join(root, 'portal/index.html'), 'utf8');
  const ocean = await readFile(path.join(root, 'portal/assets/opus/ocean.js'), 'utf8');
  const hub = await readFile(path.join(root, 'portal/assets/opus/hub.js'), 'utf8');
  const reader = await readFile(path.join(root, 'portal/assets/opus/reader.js'), 'utf8');
  const bind = await readFile(path.join(root, 'portal/assets/opus/catalog-bind.js'), 'utf8');
  assert.match(index, /学习入口/);
  assert.doesNotMatch(index, /开架|fonts\.googleapis|course\.html|lessons\.js|assets\/site\.js/);
  assert.match(index, /id="open-settings"/);
  assert.match(index, /id="settings-key"/);
  assert.match(ocean, /原创编写的全屏 WebGL1/);
  assert.match(ocean, /experimental-webgl/);
  assert.doesNotMatch(ocean, /THREE|WebGL2/);
  assert.doesNotMatch(hub, /asSave|lh-progress|function progressOf\(\) \{ return \{\}; \}/);
  assert.match(index, /course-progress\.js/);
  assert.match(hub, /HUB_PROGRESS/);
  assert.match(reader, /HUB_PROGRESS/);
  const progress = await readFile(path.join(root, 'portal/assets/opus/course-progress.js'), 'utf8');
  assert.match(progress, /nmr-from-zero\.progress\.v2/);
  assert.match(progress, /learning-atlas:weekly-study/);
  assert.match(progress, /game-design-atlas:learning:v1/);
  assert.doesNotMatch(progress, /localStorage\.setItem|progress\.v1|weekly-resume|day-one-experiment/);
  assert.match(hub, /document\.hidden \|\| body\.classList\.contains\('in-course'\)/);
  assert.match(bind, /ATLAS_CATALOG/);
  assert.match(reader, /id="lesson-frame"/);
  assert.match(reader, /LH_RESTORE/);
  assert.match(reader, /hub-reading-size/);
  const fit = await readFile(path.join(root, 'portal/assets/opus/fit.css'), 'utf8');
  assert.match(fit, /html:has\(body\.in-course\)[\s\S]*overflow-y:\s*auto/);
  assert.match(fit, /html:has\(body\.in-course\.assist-open\)\s*\{\s*overflow:\s*hidden/);
  assert.doesNotMatch(reader, /设计稿说明|示例正文|lessons\.js|只改变纸面标题|只改标题/);
  const bridge = await readFile(path.join(root, 'portal/assets/embed-bridge.js'), 'utf8');
  const skin = await readFile(path.join(root, 'portal/assets/embed-skin.css'), 'utf8');
  assert.match(bridge, /hub-reading-size/);
  assert.match(skin, /--hub-reading-size/);
  assert.doesNotMatch(skin, /zoom\s*:|transform\s*:\s*scale/);

  const allowed = new Set(['lh-motion', 'lh-quality', 'lh-welcome', 'lh-theme', 'lh-fs']);
  const opusFiles = await filesIn(path.join(root, 'portal/assets/opus'));
  for (const full of opusFiles) {
    const source = await readFile(full, 'utf8');
    assert.doesNotMatch(source, /sessionStorage|indexedDB/);
    for (const match of source.matchAll(/localStorage\.setItem\(\s*'([^']+)'/g)) {
      assert.equal(allowed.has(match[1]), true, `${path.basename(full)} stores ${match[1]}`);
    }
    assert.doesNotMatch(source, /localStorage\.setItem\([^)]*key/i);
  }
});
