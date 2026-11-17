import { phases, weeks, prerequisites } from './data/curriculum.js';

export const phaseColors = ['#e8f7b6', '#dcebd4', '#e3efd5', '#e5ecd0', '#dce9dd'];
export const weekLabel = (id) => String(id).padStart(2, '0');

const ns = 'http://www.w3.org/2000/svg';
const width = 1050;
const height = 432;
const boxWidth = 157;
const boxHeight = 29;
const shortTitles = new Map([[11, '界面与无障碍'], [22, 'Roguelike 与生成'], [25, '兼容与质量测试']]);

function element(tag, attrs, value = '') {
  const node = document.createElementNS(ns, tag);
  Object.entries(attrs).forEach(([key, attr]) => node.setAttribute(key, attr));
  if (value) node.textContent = value;
  return node;
}

function edgePath(a, b) {
  const endA = a.x + boxWidth;
  if (a.x === b.x) {
    return `M${endA},${a.y} C${endA + 19},${a.y} ${endA + 19},${b.y} ${endA},${b.y}`;
  }
  const middle = endA + (b.x - endA) / 2;
  return `M${endA},${a.y} C${middle},${a.y} ${middle},${b.y} ${b.x},${b.y}`;
}

export function buildGraph(container, selectWeek) {
  const svg = element('svg', { viewBox: `0 0 ${width} ${height}`, role: 'group', 'aria-label': '28 周课程与先修关系' });
  const coords = new Map();
  for (const phase of phases) {
    const column = phase.id - 1;
    const x = 24 + column * 207;
    const color = phaseColors[column];
    const band = element('path', {
      d: `M${x - 7},16 h180 l12,15 -12,15 h-180 z`,
      class: 'graph-band', style: `--stage-color:${color}`
    });
    svg.append(band, element('text', { x: x + 82, y: 35, class: 'graph-band-text', 'text-anchor': 'middle' }, phase.title));
    const group = weeks.filter((week) => week.phase === phase.id);
    group.forEach((week, index) => {
      coords.set(week.id, { x, y: 238 + (index - (group.length - 1) / 2) * 43 });
    });
  }

  const edges = prerequisites.map(([from, to]) => {
    const path = element('path', { d: edgePath(coords.get(from), coords.get(to)), class: 'graph-edge', 'aria-hidden': 'true' });
    svg.append(path);
    return { path, from, to };
  });

  const nodes = weeks.map((week) => {
    const { x, y } = coords.get(week.id);
    const node = element('g', { class: 'graph-node', tabindex: '0', role: 'button', 'aria-label': `第 ${week.id} 周 ${week.title}` });
    node.append(
      element('rect', { x, y: y - boxHeight / 2, width: boxWidth, height: boxHeight, rx: 5 }),
      element('text', { x: x + 10, y: y + 4.25, class: 'node-number', 'aria-hidden': 'true' }, weekLabel(week.id)),
      element('text', { x: x + 32, y: y + 4.25, 'aria-hidden': 'true' }, shortTitles.get(week.id) ?? week.title),
      element('title', {}, `第 ${week.id} 周 · ${week.title}`)
    );
    node.addEventListener('click', () => selectWeek(week.id));
    node.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        selectWeek(week.id);
      }
    });
    svg.append(node);
    return { id: week.id, node };
  });

  container.append(svg);
  return (active, completed) => {
    const related = new Set();
    for (const { path, from, to } of edges) {
      const emphasized = from === active || to === active;
      path.classList.toggle('active', emphasized);
      if (emphasized) related.add(from === active ? to : from);
    }
    for (const { id, node } of nodes) {
      node.classList.toggle('selected', id === active);
      node.classList.toggle('related', related.has(id));
      node.classList.toggle('complete', completed.has(id));
      node.setAttribute('aria-pressed', String(id === active));
    }
  };
}
