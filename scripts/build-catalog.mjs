import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => readFileSync(path.join(root, relative), 'utf8');
const ai = [];

const nmrText = read('sites/nmr-from-zero/src/content/course.ts');
const nmr = [{ id: 'nmr-path', title: '学习路线', group: '入口', local: 'nmr-from-zero/#/path' }];
let stage = '课程';
for (const line of nmrText.replaceAll('\r', '').split('\n')) {
  const stageTitle = line.match(/^\s*"title": "([^"]+)",$/);
  const lesson = line.match(/^\s*"id": "(\d+-\d+)",$/);
  if (stageTitle && !lesson) {
    const nearby = nmrText.slice(Math.max(0, nmrText.indexOf(line) - 80), nmrText.indexOf(line));
    if (/"id": \d+,/.test(nearby)) stage = stageTitle[1];
  }
  if (lesson) {
    const titleLine = nmrText.slice(nmrText.indexOf(line), nmrText.indexOf(line) + 180).match(/"title": "([^"]+)"/);
    nmr.push({
      id: `nmr-${lesson[1]}`,
      title: `${lesson[1]} ${titleLine ? titleLine[1] : lesson[1]}`,
      group: stage,
      local: `nmr-from-zero/#/learn/${lesson[1]}`,
    });
  }
}
const labs = [
  ['waves', '波与相位叠加'],
  ['spin', '磁化进动与激发'],
  ['relaxation', '弛豫与回波'],
  ['sampling', '采样与频谱'],
  ['field', '磁场与匀场'],
  ['coil', '线圈调谐'],
  ['timing', '收发时序'],
  ['imaging', '空间编码与重建'],
];
for (const [id, title] of labs) {
  nmr.push({ id: `nmr-lab-${id}`, title, group: '实验', local: `nmr-from-zero/#/labs/${id}` });
}
nmr.push(
  { id: 'nmr-build', title: '硬件工坊', group: '工坊与资料', local: 'nmr-from-zero/#/build', note: '十个制造步骤在工坊内部切换，不另开门户条目。' },
  { id: 'nmr-projects', title: '开源项目审计', group: '工坊与资料', local: 'nmr-from-zero/#/projects' },
  { id: 'nmr-hardware', title: '整机地图', group: '工坊与资料', local: 'nmr-from-zero/#/hardware' },
  { id: 'nmr-resources', title: '资料库', group: '工坊与资料', local: 'nmr-from-zero/#/resources' },
  { id: 'nmr-glossary', title: '术语表', group: '工坊与资料', local: 'nmr-from-zero/#/glossary' },
);

const game = [{ id: 'game-graph', title: '知识图谱', group: '入口', local: 'game/#graph' }];
const curriculumText = read('sites/game-design-atlas/docs/data/curriculum.js');
const phaseTitles = new Map(
  [...curriculumText.matchAll(/\{\s*id:\s*(\d+),\s*title:\s*'([^']+)'/g)].map((match) => [match[1], match[2]])
);
const weekTitles = [...curriculumText.matchAll(/id: (\d+), phase: (\d+), title: '([^']+)'/g)];
for (const match of weekTitles) {
  const phaseTitle = phaseTitles.get(match[2]);
  game.push({
    id: `game-w${match[1].padStart(2, '0')}`,
    title: `第 ${match[1].padStart(2, '0')} 周 · ${match[3]}`,
    group: phaseTitle ? `阶段 ${match[2]} · ${phaseTitle}` : `阶段 ${match[2]}`,
    local: `game/#plan/${match[1].padStart(2, '0')}`,
  });
}
game.push(
  { id: 'game-coach', title: 'AI 学习工坊', group: '工坊', local: 'game/#coach', note: '提问、评审和委托实现仍在本节里。密钥未配置时会明确说未配置。' },
  { id: 'game-ai-dev', title: 'AI 开发守则', group: '资料', kind: 'document', local: 'game/AI-DEVELOPMENT.md', note: '这是仓库里的 Markdown 原文，不是互动课。' },
);

const genreLabs = [
  'genre-platform', 'genre-shooter', 'genre-puzzle', 'genre-rpg',
  'genre-management', 'genre-sandbox', 'genre-rogue', 'genre-coop',
];
const labsByWeekMap = new Map();
for (const file of ['docs/data/lessons-01-09.js', 'docs/data/lessons-10-18.js', 'docs/data/lessons-19-28.js']) {
  const text = read(`sites/game-design-atlas/${file}`);
  for (const part of text.split(/\n  (?=\d+: \{)/)) {
    const week = part.match(/^(\d+): \{/);
    const lab = part.match(/lab: '([^']+)'/);
    if (week && lab) labsByWeekMap.set(Number(week[1]), { week: Number(week[1]), lab: lab[1], file });
  }
}
for (let i = 0; i < genreLabs.length; i += 1) {
  const weekNum = 16 + i;
  labsByWeekMap.set(weekNum, { week: weekNum, lab: genreLabs[i], file: 'docs/data/lessons.js' });
}
const labsByWeek = [...labsByWeekMap.values()].sort((a, b) => a.week - b.week);

const catalog = { ai, nmr, game };
writeFileSync(path.join(root, 'portal/data/catalog.js'), `window.ATLAS_CATALOG = ${JSON.stringify(catalog, null, 2)};\n`);
writeFileSync(path.join(root, 'portal/data/game-labs.json'), `${JSON.stringify(labsByWeek, null, 2)}\n`);
console.log(`ai ${ai.length} nmr ${nmr.length} game ${game.length} labs ${labsByWeek.length}`);
