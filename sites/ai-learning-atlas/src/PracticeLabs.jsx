import { useState } from 'react';
import './practice-labs.css';

const grid = ['S#G', '.#.', '...'];
const maxSteps = 7;
const start = { x: 0, y: 0, remaining: maxSteps, score: 0, last: '小车在起点。先选一个方向。' };
const directions = [
  { title: '向上', dx: 0, dy: -1 },
  { title: '向左', dx: -1, dy: 0 },
  { title: '向下', dx: 0, dy: 1 },
  { title: '向右', dx: 1, dy: 0 },
];
const cellNames = { S: '起点', G: '终点', '#': '障碍', '.': '空格' };

function moveCar(current, { title, dx, dy }) {
  if (current.end) return current;
  const x = current.x + dx;
  const y = current.y + dy;
  const cell = grid[y]?.[x];
  const remaining = current.remaining - 1;
  if (!cell || cell === '#') return {
    ...current,
    remaining,
    score: current.score - 4,
    end: '碰撞结束',
    last: title + '撞到障碍或边界，仍留在原格。本步扣 4 分。',
  };
  const arrived = cell === 'G';
  return {
    x, y, remaining,
    score: current.score + (arrived ? 7 : -1),
    end: arrived ? '成功到达' : remaining === 0 ? '步数用完' : null,
    last: arrived ? title + '到达终点，本步得 7 分。' : title + '进入空格，本步扣 1 分。',
  };
}

function GridLab() {
  const [car, setCar] = useState(start);
  return (
    <div className="lesson-lab">
      <p>用另一张地图试走。普通移动扣 1 分，到达得 7 分，碰撞扣 4 分。到达、碰撞或步数用完时，这趟结束。</p>
      <table className="lesson-lab-grid">
        <caption>三行三列的小车地图</caption>
        <tbody>{grid.map((row, y) => (
          <tr key={y}>{[...row].map((cell, x) => {
            const current = car.x === x && car.y === y;
            return <td key={x} data-cell={cell} data-current={current} aria-label={'第 ' + (y + 1) + ' 行第 ' + (x + 1) + ' 列，' + cellNames[cell] + (current ? '，小车在这里' : '')}>
              {current ? '小车' : cell === '.' ? '·' : cellNames[cell]}
            </td>;
          })}</tr>
        ))}</tbody>
      </table>
      <p className="lesson-lab-state" role="status">剩余 {car.remaining} 步 · 总分 {car.score}。{car.last}{car.end && ' ' + car.end + '。'}</p>
      <div className="lesson-lab-actions">
        {directions.map((direction) => <button key={direction.title} className="action secondary" type="button" disabled={Boolean(car.end)} onClick={() => setCar((current) => moveCar(current, direction))}>{direction.title}</button>)}
        <button className="action secondary" type="button" onClick={() => setCar(start)}>重新出发</button>
      </div>
    </div>
  );
}

const stations = [
  { name: '甲', base: 5 },
  { name: '乙', base: 9 },
  { name: '丙', base: 11 },
  { name: '丁', base: 15 },
];
const effect = 2;
const assignments = [[0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3]];
const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;

function AllocationLab() {
  const [chosen, setChosen] = useState([]);
  const ready = chosen.length === 2;
  const newMean = ready ? mean(chosen.map((index) => stations[index].base + effect)) : null;
  const oldMean = ready ? mean(stations.filter((_, index) => !chosen.includes(index)).map(({ base }) => base)) : null;
  function toggleStation(index) {
    setChosen((previous) => {
      if (previous.includes(index)) return previous.filter((item) => item !== index);
      return previous.length < 2 ? [...previous, index] : previous;
    });
  }
  return (
    <div className="lesson-lab">
      <p>这组模拟站点使用另一组数字。每座站改用新策略后固定多借出 2 辆。可以自己摆出一组分配，也可以让系统从六种分法中等概率抽取。</p>
      <fieldset className="lesson-lab-choices">
        <legend>新策略组选择两个站点</legend>
        {stations.map(({ name, base }, index) => {
          const selected = chosen.includes(index);
          return <label key={name}>
            <input type="checkbox" checked={selected} disabled={ready && !selected} onChange={() => toggleStation(index)} />
            {name}站 · 原本 {base} 辆{ready && ' · 实际 ' + (selected ? base + effect : base) + ' 辆'}
          </label>;
        })}
      </fieldset>
      <p className="lesson-lab-state" role="status">{ready
        ? '新策略组均值 ' + newMean + ' 辆，对照组均值 ' + oldMean + ' 辆。此次估计 ' + (newMean - oldMean) + ' 辆，模拟器设定效果为 2 辆。'
        : '选好两座站后，这里会显示两个组的均值和差。'}</p>
      <div className="lesson-lab-actions">
        <button className="action secondary" type="button" onClick={() => setChosen(assignments[Math.floor(Math.random() * assignments.length)])}>随机抽签</button>
        <button className="action secondary" type="button" onClick={() => setChosen([])}>清空分组</button>
      </div>
      <p>单次分组可能恰好让较忙的站点集中在一组。多换几组看看。这里的差只用于检查设定好的模型。</p>
    </div>
  );
}

export default function PracticeLabs({ week }) {
  if (week !== 39 && week !== 55) return null;
  return (
    <details className="review-box lesson-lab-wrap">
      <summary>{week === 39 ? '再试一张地图' : '试着改变分组'}</summary>
      {week === 39 ? <GridLab /> : <AllocationLab />}
    </details>
  );
}
