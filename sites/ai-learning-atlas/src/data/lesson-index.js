import { stages } from './course.js';

export const weeklyEntries = stages
  .flatMap((stage) => stage.weeks.map((week) => ({ title: week.title, stage })))
  .map(({ title, stage }, index) => ({
    key: 'week-' + String(index + 1).padStart(2, '0'),
    week: index + 1,
    title,
    stage,
  }));

const electiveSpecs = [
  { chapter: 1, after: 1, title: '识别一个任务属于哪类人工智能问题', reason: '想快速认识领域全貌时可以学，第一天的 CSV 练习只用到工具的基本用法。' },
  { chapter: 16, after: 8, title: '没有标签，怎么给问题分组', reason: '当你手头的记录没有人标好的类别时再学。主线先用已有标签练评估。' },
  { chapter: 17, after: 8, title: '标注预算有限时先问哪条', reason: '当收集标签有成本时再学。先用固定训练材料掌握监督学习的完整过程。' },
  { chapter: 22, after: 12, title: '从一点噪声看懂扩散生成', reason: '图像生成方向会用到这套方法。文本模型和站内问答只需要前几课的通用概念。' },
  { chapter: 30, after: 15, title: '给两位读者排出不同推荐', reason: '做个性化列表时再学。手册问答先掌握按问题找证据。' },
];

export const electiveEntries = electiveSpecs.map((elective) => ({
  ...elective,
  key: 'elective-' + elective.chapter,
  stage: weeklyEntries[elective.after - 1].stage,
}));
export const lessonEntries = new Map([...weeklyEntries, ...electiveEntries].map((entry) => [entry.key, entry]));
export const weekHref = (week) => '#' + weeklyEntries[week - 1].key;

const chapterWeeks = {
  2: 1, 3: 2, 4: 4, 5: 9, 6: 3, 7: 33, 8: 34, 9: 35, 10: 36,
  11: 37, 12: 35, 13: 38, 14: 5, 15: 6, 18: 8, 19: 39, 20: 9,
  21: 11, 23: 11, 24: 25, 25: 14, 26: 10, 27: 19, 28: 21, 29: 22,
  30: 13, 31: 49, 32: 43, 33: 16, 34: 30, 35: 16, 36: 17, 37: 15,
  38: 54, 39: 57, 40: 18,
};

export function chapterLessons(chapter) {
  const main = weeklyEntries[chapterWeeks[chapter] - 1];
  return [main, ...electiveEntries.filter((entry) => entry.chapter === chapter)].filter(Boolean);
}
