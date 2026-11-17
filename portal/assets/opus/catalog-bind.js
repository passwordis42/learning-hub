/* 用正式目录替换设计稿里的示例章节。岛屿坐标、配色和插画仍来自设计稿。 */
(function () {
  var catalog = window.ATLAS_CATALOG || {};
  var base = {
    ai: {
      id: 'ai', code: 'AI', name: 'AI 岛', fullName: 'AI 学习图谱', facility: 'AI 图谱设施',
      blurb: '从一份数据出发，动手练清洗、建模与评估。',
      tagline: '从一份数据开始，理解模型，再构建自己的 AI 工具。',
      accent: '#2bb3a3', heroBg: '#0e4a52', tint: [0.42, 0.74, 0.58],
      x: -11, z: -3, r: 4.4, seed: 1.7, origin: 'ai/', unitsLabel: '站内课程'
    },
    nmr: {
      id: 'nmr', code: 'NMR', name: 'NMR 岛', fullName: '从零看懂核磁共振', facility: 'NMR 信号实验站',
      blurb: '从电磁感应、自旋到成像，用交互实验读懂核磁信号。',
      tagline: '沿着自旋、信号与成像，读懂核磁共振的工作方式。',
      accent: '#7a6cf0', heroBg: '#231a5c', tint: [0.5, 0.66, 0.62],
      x: 3.5, z: -12.5, r: 3.9, seed: 4.2, origin: 'nmr-from-zero/', unitsLabel: '站内课程'
    },
    game: {
      id: 'game', code: 'GAME', name: '游戏设计岛', fullName: '游戏设计学习图谱', facility: 'GAME 关卡工坊',
      blurb: '拆解玩家体验，靠试玩把想法打磨成可玩的作品。',
      tagline: '试做机制与关卡，再通过试玩把想法变成可玩的作品。',
      accent: '#f2775a', heroBg: '#7a2f1e', tint: [0.62, 0.72, 0.4],
      x: 11.5, z: 2, r: 4.4, seed: 2.9, origin: 'game/', unitsLabel: '站内课程'
    }
  };
  var planned = (window.HUB.COURSES || []).filter(function (c) { return c.planned; });
  var courses = ['ai', 'nmr', 'game'].map(function (id) {
    var course = base[id];
    var modules = catalog[id] || [];
    course.chapters = modules.map(function (mod) {
      return {
        t: mod.title,
        g: mod.group || '',
        id: mod.id,
        local: mod.local,
        href: '?view=reader&course=' + id + '&module=' + encodeURIComponent(mod.id)
      };
    });
    course.total = modules.length;
    course.enter = '?view=reader&course=' + id;
    course.href = course.enter;
    return course;
  });
  window.HUB.COURSES = courses.concat(planned);
  window.HUB_REAL = { courses: courses };
})();
