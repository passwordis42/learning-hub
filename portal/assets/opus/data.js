/*
 * 课程与岛屿数据 —— 新增课程只需在 COURSES 中追加一项（并可选给出设施插画）。
 * x / z 为海面世界坐标，r 为岛屿半径；planned: true 表示预留航道（筹建中）。
 * 全部插画为本项目原创 SVG。
 */
(function (g) {
  'use strict';

  /* ---------- 原创设施插画（场景内，200×200，底部中心为落地点） ---------- */
  var ART = {};

  ART.ai = '<svg viewBox="0 0 200 200" aria-hidden="true">' +
    '<ellipse cx="100" cy="184" rx="58" ry="13" fill="#d9ccb0"/><ellipse cx="100" cy="181" rx="52" ry="10" fill="#efe6d2"/>' +
    // 侧屋
    '<path d="M40 176 L40 156 L58 148 L76 156 L76 176 Z" fill="#e8f1ee"/><path d="M58 148 L76 156 L76 176 L58 182 Z" fill="#b9cfca"/><path d="M40 156 L58 148 L58 182 L40 176Z" fill="#f6fbf9"/>' +
    '<path d="M37 156 L58 145 L79 156 L58 150 Z" fill="#2c8f86"/>' +
    '<path d="M134 178 L134 164 L148 158 L162 164 L162 178 L148 184Z" fill="#b9cfca"/><path d="M134 164 L148 158 L148 184 L134 178Z" fill="#f6fbf9"/>' +
    // 塔身
    '<path d="M84 178 L90 70 L100 66 L100 182 Z" fill="#fbfdfc"/><path d="M100 66 L110 70 L116 178 L100 182 Z" fill="#c9dbd6"/>' +
    '<path d="M86.6 140 L113.4 140 L113.9 148 L86.1 148Z" fill="#2bb3a3" opacity=".9"/>' +
    '<path d="M88.4 104 L111.6 104 L112 110 L88 110Z" fill="#2bb3a3" opacity=".9"/>' +
    '<rect x="96" y="120" width="8" height="12" rx="4" fill="#0f3a44"/>' +
    // 顶部光球 + 图谱网络
    '<path d="M88 72 L112 72 L106 62 L94 62Z" fill="#0f3a44"/>' +
    '<circle class="pulse" cx="100" cy="50" r="17" fill="#7cf0d8" opacity=".25"/>' +
    '<circle cx="100" cy="50" r="10" fill="#bff8ea"/><circle cx="97" cy="47" r="4" fill="#fff"/>' +
    '<g stroke="#e9fffa" stroke-width="1.6" fill="none" opacity=".9">' +
    '<path class="flow" d="M100 50 L58 30 L40 58"/><path class="flow" d="M100 50 L146 26 L168 54"/><path class="flow" d="M100 50 L132 84"/><path class="flow" d="M100 50 L66 88"/><path class="flow" d="M58 30 L100 12 L146 26"/>' +
    '</g>' +
    '<g fill="#fff"><circle class="pulse" cx="58" cy="30" r="5"/><circle class="pulse d1" cx="146" cy="26" r="5"/><circle class="pulse d2" cx="40" cy="58" r="4"/><circle class="pulse d3" cx="168" cy="54" r="4"/><circle class="pulse d1" cx="132" cy="84" r="3.5"/><circle class="pulse d2" cx="66" cy="88" r="3.5"/><circle class="pulse d3" cx="100" cy="12" r="4"/></g>' +
    '<g fill="#2bb3a3"><circle cx="58" cy="30" r="2.2"/><circle cx="146" cy="26" r="2.2"/><circle cx="100" cy="12" r="2"/></g>' +
    '</svg>';

  ART.nmr = '<svg viewBox="0 0 200 200" aria-hidden="true">' +
    '<ellipse cx="100" cy="184" rx="60" ry="13" fill="#d9ccb0"/><ellipse cx="100" cy="181" rx="54" ry="10" fill="#efe6d2"/>' +
    // 共振环
    '<ellipse class="pulse" cx="96" cy="70" rx="62" ry="16" fill="none" stroke="#c9c2ff" stroke-width="1.5" opacity=".7"/>' +
    '<ellipse class="pulse d2" cx="96" cy="70" rx="44" ry="11" fill="none" stroke="#efeaff" stroke-width="1.5" opacity=".8"/>' +
    // 磁体
    '<path d="M70 168 L70 178 M122 168 L122 178" stroke="#6f6a8c" stroke-width="5"/>' +
    '<path d="M62 84 L62 164 A34 10 0 0 0 96 174 L96 74 A34 10 0 0 1 62 84Z" fill="#f7f5ff"/>' +
    '<path d="M96 74 L96 174 A34 10 0 0 0 130 164 L130 84 A34 10 0 0 0 96 74Z" fill="#c8c2e6"/>' +
    '<ellipse cx="96" cy="84" rx="34" ry="10" fill="#ffffff"/><ellipse cx="96" cy="84" rx="12" ry="3.6" fill="#4b4378"/>' +
    '<path d="M62 120 A34 10 0 0 0 130 120 L130 128 A34 10 0 0 1 62 128Z" fill="#7a6cf0"/>' +
    '<path d="M62 100 A34 10 0 0 0 130 100 L130 103 A34 10 0 0 1 62 103Z" fill="#7a6cf0" opacity=".55"/>' +
    // 控制小屋
    '<path d="M134 178 L134 158 L150 152 L166 158 L166 178 L150 184Z" fill="#c8c2e6"/><path d="M134 158 L150 152 L150 184 L134 178Z" fill="#f7f5ff"/><rect x="139" y="163" width="7" height="6" rx="1" fill="#ffd27a"/>' +
    // 天线 + 谱线面板
    '<path d="M150 152 L150 112" stroke="#4b4378" stroke-width="2"/>' +
    '<g class="float"><rect x="128" y="76" width="56" height="34" rx="7" fill="#1b1640" opacity=".88"/>' +
    '<path class="spec" d="M133 103 L141 103 L144 100 L147 103 L152 103 L155 84 L158 103 L163 103 L166 95 L169 103 L179 103" fill="none" stroke="#9ef3ff" stroke-width="1.8" stroke-linejoin="round"/></g>' +
    '<circle class="pulse" cx="96" cy="84" r="4" fill="#bdb4ff"/>' +
    '</svg>';

  ART.game = '<svg viewBox="0 0 200 200" aria-hidden="true">' +
    '<ellipse cx="100" cy="184" rx="60" ry="13" fill="#d9ccb0"/><ellipse cx="100" cy="181" rx="54" ry="10" fill="#efe6d2"/>' +
    // 工坊主体
    '<path d="M52 176 L52 124 L96 108 L96 184Z" fill="#fff7ec"/><path d="M96 108 L140 124 L140 176 L96 184Z" fill="#e7d3bd"/>' +
    '<path d="M46 126 L74 86 L102 108 L96 112Z" fill="#ff8c69"/><path d="M74 86 L118 98 L146 126 L102 108Z" fill="#e2603f"/>' +
    '<path d="M74 86 L102 108 L96 112 L46 126 Z" fill="#f2775a"/>' +
    '<rect x="64" y="140" width="18" height="16" rx="2" fill="#ffd27a"/><path d="M64 148 L82 148 M73 140 L73 156" stroke="#e7b766" stroke-width="1.5"/>' +
    '<path d="M108 182 L108 150 A9 9 0 0 1 126 150 L126 179Z" fill="#7a3b2b"/>' +
    // 旗
    '<path d="M74 86 L74 52" stroke="#4a3a30" stroke-width="2"/><path class="flag" d="M74 53 L100 58 L74 66Z" fill="#ffd27a"/>' +
    // 骰子
    '<g transform="translate(148 150)"><path d="M0 -24 L20 -16 L0 -8 L-20 -16Z" fill="#ffffff"/><path d="M-20 -16 L0 -8 L0 16 L-20 8Z" fill="#f3ece0"/><path d="M0 -8 L20 -16 L20 8 L0 16Z" fill="#d8cdbd"/>' +
    '<circle cx="0" cy="-16" r="2.6" fill="#f2775a"/><circle cx="-14" cy="-6" r="2" fill="#2b3a45"/><circle cx="-6" cy="6" r="2" fill="#2b3a45"/><circle cx="6" cy="-4" r="2" fill="#2b3a45"/><circle cx="14" cy="-8" r="2" fill="#2b3a45"/><circle cx="14" cy="4" r="2" fill="#2b3a45"/><circle cx="6" cy="8" r="2" fill="#2b3a45"/></g>' +
    // 漂浮的星形宝石
    '<g class="float"><path class="spin" d="M150 66 L156 80 L171 82 L160 92 L163 107 L150 99 L137 107 L140 92 L129 82 L144 80Z" fill="#ffd27a" stroke="#fff" stroke-width="2" stroke-linejoin="round"/></g>' +
    '</svg>';

  ART.planned = '<svg viewBox="0 0 200 200" aria-hidden="true">' +
    '<g class="float"><ellipse cx="100" cy="182" rx="20" ry="6" fill="#0d3b52" opacity=".25"/>' +
    '<path d="M86 176 L90 140 L110 140 L114 176 A14 5 0 0 1 86 176Z" fill="#f2775a"/><path d="M89 158 L111 158 L112 166 L88 166Z" fill="#fff"/>' +
    '<path d="M100 140 L100 112" stroke="#3b4a54" stroke-width="2.5"/><circle class="pulse" cx="100" cy="108" r="6" fill="#ffd27a"/>' +
    '<rect x="104" y="118" width="40" height="18" rx="4" fill="#f8f3e8" stroke="#3b4a54" stroke-width="1.5" stroke-dasharray="3 3"/>' +
    '<text x="124" y="131" text-anchor="middle" font-size="10" font-weight="700" fill="#3b4a54" font-family="sans-serif">筹建中</text></g>' +
    '</svg>';

  /* ---------- 选中后右侧"设施预览"大图（更丰富的动态） ---------- */
  var HERO = {};
  HERO.ai = '<svg viewBox="0 0 400 184" preserveAspectRatio="xMidYMid slice" aria-hidden="true">' +
    '<defs><radialGradient id="hai" cx="50%" cy="40%" r="70%"><stop offset="0" stop-color="#1f8f8a"/><stop offset="1" stop-color="#0a3243"/></radialGradient></defs>' +
    '<rect width="400" height="184" fill="url(#hai)"/>' +
    '<g stroke="#9ff5e4" stroke-width="1.2" fill="none" opacity=".55">' +
    '<path class="flow" d="M200 92 L120 50 L60 80 L30 140"/><path class="flow" d="M200 92 L290 40 L360 70"/><path class="flow" d="M200 92 L270 140 L340 150"/><path class="flow" d="M200 92 L130 140 L80 160"/><path class="flow" d="M120 50 L200 20 L290 40"/><path class="flow" d="M60 80 L130 140"/><path class="flow" d="M290 40 L270 140"/></g>' +
    '<g fill="#e9fffa"><circle class="pulse" cx="120" cy="50" r="6"/><circle class="pulse d1" cx="60" cy="80" r="4"/><circle class="pulse d2" cx="30" cy="140" r="3"/><circle class="pulse d3" cx="290" cy="40" r="6"/><circle class="pulse d1" cx="360" cy="70" r="4"/><circle class="pulse d2" cx="270" cy="140" r="5"/><circle class="pulse d3" cx="340" cy="150" r="3"/><circle class="pulse" cx="130" cy="140" r="4"/><circle class="pulse d2" cx="80" cy="160" r="3"/><circle class="pulse d1" cx="200" cy="20" r="4"/></g>' +
    '<circle class="pulse" cx="200" cy="92" r="30" fill="#7cf0d8" opacity=".25"/><circle cx="200" cy="92" r="15" fill="#c8fbef"/><circle cx="195" cy="87" r="5" fill="#fff"/>' +
    '<g font-family="sans-serif" font-size="10" font-weight="700" fill="#dffbf4" opacity=".85"><text x="132" y="46">感知机</text><text x="300" y="36">注意力</text><text x="280" y="136">嵌入</text><text x="66" y="76">梯度</text></g>' +
    '</svg>';
  HERO.nmr = '<svg viewBox="0 0 400 184" preserveAspectRatio="xMidYMid slice" aria-hidden="true">' +
    '<defs><linearGradient id="hnmr" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3b2f8f"/><stop offset="1" stop-color="#150f3a"/></linearGradient></defs>' +
    '<rect width="400" height="184" fill="url(#hnmr)"/>' +
    '<g stroke="#ffffff" opacity=".08">' + Array.apply(null, Array(9)).map(function (_, i) { return '<path d="M0 ' + (20 + i * 20) + ' H400"/>'; }).join('') + '</g>' +
    // FID：自由感应衰减信号（左）→ 傅里叶变换后的谱峰（右）
    '<path class="spec" style="stroke-dasharray:1400;stroke-dashoffset:1400;animation-duration:5.5s" d="' + (function () { var d = 'M14 92'; for (var x = 0; x <= 200; x += 2) { d += ' L' + (14 + x) + ' ' + (92 - Math.sin(x * 0.32) * 62 * Math.exp(-x / 60)).toFixed(1); } return d; })() + '" fill="none" stroke="#9ef3ff" stroke-width="2" stroke-linejoin="round"/>' +
    '<path d="M228 92 H246" stroke="#cfc9ff" stroke-width="2" marker-end="url(#ar)"/><defs><marker id="ar" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0 L10 5 L0 10z" fill="#cfc9ff"/></marker></defs>' +
    '<path class="spec" style="stroke-dasharray:600;stroke-dashoffset:600;animation-duration:5.5s;animation-delay:.6s" d="M258 150 L300 150 L308 146 L314 150 L322 150 L328 46 L334 150 L346 150 L350 128 L354 150 L388 150" fill="none" stroke="#ffd27a" stroke-width="2.2" stroke-linejoin="round"/>' +
    '<g font-family="sans-serif" font-size="10" fill="#cfc9ff" font-weight="700"><text x="16" y="172">FID · 时间域</text><text x="300" y="172">频谱 · 频率域</text></g>' +
    '<circle class="pulse" cx="328" cy="46" r="5" fill="#ffd27a"/>' +    '</svg>';
  HERO.game = '<svg viewBox="0 0 400 184" preserveAspectRatio="xMidYMid slice" aria-hidden="true">' +
    '<defs><linearGradient id="hg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff9a6e"/><stop offset="1" stop-color="#b8432c"/></linearGradient></defs>' +
    '<rect width="400" height="184" fill="url(#hg)"/>' +
    '<g opacity=".18" fill="#fff">' + Array.apply(null, Array(40)).map(function (_, i) { return '<circle cx="' + ((i * 53) % 400) + '" cy="' + ((i * 37) % 184) + '" r="' + (1 + (i % 3)) + '"/>'; }).join('') + '</g>' +
    // 循环图：核心玩法循环
    '<g fill="none" stroke="#fff3e6" stroke-width="2" opacity=".9"><path class="flow" d="M200 40 A60 52 0 1 1 199 40"/></g>' +
    '<g font-family="sans-serif" font-weight="800" font-size="11" fill="#5a2516" text-anchor="middle">' +
    '<g class="float"><rect x="166" y="24" width="68" height="28" rx="14" fill="#fff7ec"/><text x="200" y="42">目标</text></g>' +
    '<g class="float" style="animation-delay:-.8s"><rect x="248" y="78" width="68" height="28" rx="14" fill="#ffd27a"/><text x="282" y="96">挑战</text></g>' +
    '<g class="float" style="animation-delay:-1.6s"><rect x="166" y="132" width="68" height="28" rx="14" fill="#fff7ec"/><text x="200" y="150">反馈</text></g>' +
    '<g class="float" style="animation-delay:-2.4s"><rect x="84" y="78" width="68" height="28" rx="14" fill="#ffd27a"/><text x="118" y="96">奖励</text></g></g>' +
    '<path class="spin" d="M200 78 L205 89 L217 90 L208 98 L211 110 L200 104 L189 110 L192 98 L183 90 L195 89Z" fill="#fff" />' +
    '</svg>';
  HERO.planned = '<svg viewBox="0 0 400 184" preserveAspectRatio="xMidYMid slice" aria-hidden="true">' +
    '<rect width="400" height="184" fill="#d9eef0"/>' +
    '<g fill="none" stroke="#0e4a63" stroke-width="1.5" stroke-dasharray="5 6" opacity=".45"><ellipse class="spin" cx="200" cy="92" rx="70" ry="70"/><ellipse cx="200" cy="92" rx="120" ry="58"/></g>' +
    '<g class="float"><path d="M186 120 L190 80 L210 80 L214 120Z" fill="#f2775a"/><path d="M189 98 L211 98 L212 106 L188 106Z" fill="#fff"/><circle class="pulse" cx="200" cy="72" r="7" fill="#ffd27a"/></g>' +
    '</svg>';

  /* ---------- 课程 ---------- */
  var ORIGIN = 'https://passwordis42.github.io/learning-hub/';
  function ch(list) { return list.map(function (t) { var m = t.split('|'); return { t: m[0], g: m[1] || '' }; }); }
  var COURSES = [
    {
      id: 'ai', code: 'AI', name: 'AI 岛', fullName: 'AI 学习图谱',
      facility: 'AI 图谱设施',
      blurb: '从一份数据出发，动手练清洗、建模与评估，最后搭出属于自己的 AI 小工具。',
      tagline: '从一份数据开始，理解模型，再构建自己的 AI 工具。先动手，也练习判断。',
      accent: '#2bb3a3', heroBg: '#0e4a52', tint: [0.42, 0.74, 0.58],
      x: -11, z: -3, r: 4.4, seed: 1.7,
      total: 66, unitsLabel: '站内课 58 · 实战 1', time: '约 58 周',
      origin: ORIGIN + 'ai/',
      chapters: ch(['图谱总览|总览', '第一天：让 AI 写第一个 CSV 清洗脚本|入门实战', 'AI 学伴|工具', '第 01 周 · 用三种样本检查清洗规则|阶段 1 · 数据与脚本', '第 02 周 · 拆函数、读报错、检查改动|阶段 1 · 数据与脚本', '第 03 周 · 用图表检验统计直觉|阶段 1 · 数据与脚本', '第 04 周 · 用一排数字表示一条记录|阶段 2 · 表示与基线', '第 05 周 · 划分数据并检查泄漏|阶段 2 · 表示与基线', '第 06 周 · 建立可以手算的基线|阶段 2 · 表示与基线', '第 07 周 · 用词频训练逻辑回归|阶段 3 · 第一个模型', '第 08 周 · 在留出的测试题上验收|阶段 3 · 第一个模型', '第 09 周 · 用一个数字认识误差与梯度|阶段 3 · 第一个模型', '第 10 周 · 把文字变成数字，再训练小网络|阶段 4 · 神经网络', '第 11 周 · 分词、注意力与 Transformer|阶段 4 · 神经网络', '第 12 周 · 用损失曲线诊断训练|阶段 4 · 神经网络'])
    },
    {
      id: 'nmr', code: 'NMR', name: 'NMR 岛', fullName: '从零看懂核磁共振',
      facility: 'NMR 信号实验站',
      blurb: '从电磁感应、自旋到成像，用交互实验把看不见的核磁信号变得可以理解。',
      tagline: '从电磁感应与相位出发，沿着自旋、信号与成像，读懂核磁共振的工作方式。',
      accent: '#7a6cf0', heroBg: '#231a5c', tint: [0.5, 0.66, 0.62],
      x: 3.5, z: -12.5, r: 3.9, seed: 4.2,
      total: 50, unitsLabel: '12 阶段 · 36 节 · 8 组实验', time: '36 节',
      origin: ORIGIN + 'nmr-from-zero/',
      chapters: ch(['学习路线|总览', '1-1 仪器里有什么，在哪里测量？|阶段 1 · 认识仪器', '1-2 样品怎样影响电路的读数？|阶段 1 · 认识仪器', '1-3 一次发射与接收怎样进行？|阶段 1 · 认识仪器', '2-1 读懂振幅、频率和相位|阶段 2 · 信号语言', '2-2 用箭头和时间常数读变化|阶段 2 · 信号语言', '2-3 用线圈验证电磁感应|阶段 2 · 信号语言', '3-1 自旋不是一个正在转的小球|阶段 3 · 自旋', '3-2 大量微小磁矩如何留下一个总量|阶段 3 · 自旋', '3-3 拉莫尔频率：磁场给出的节拍|阶段 3 · 自旋', '4-1 小小的 B₁ 如何影响强大的 B₀|阶段 4 · 激发', '4-2 坐上旋转的观察台|阶段 4 · 激发', '4-3 把脉冲变成准确的角度|阶段 4 · 激发', '5-1 T₁ 与 T₂：两条不同的时间线|阶段 5 · 弛豫', '5-2 FID 与 T₂*：总信号为什么更快消失|阶段 5 · 弛豫'])
    },
    {
      id: 'game', code: 'GAME', name: '游戏设计岛', fullName: '游戏设计学习图谱',
      facility: 'GAME 关卡工坊',
      blurb: '拆解玩家体验，做纸面与 PC 原型，靠一轮轮试玩把想法打磨成可玩的作品。',
      tagline: '拆解玩家体验，试做机制与关卡，再通过试玩，把想法变成可玩的作品。',
      accent: '#f2775a', heroBg: '#7a2f1e', tint: [0.62, 0.72, 0.4],
      x: 11.5, z: 2, r: 4.4, seed: 2.9,
      total: 31, unitsLabel: '28 周 · 8 品类实验 · 4 项目', time: '28 周',
      origin: ORIGIN + 'game/',
      chapters: ch(['知识图谱|总览', '第 01 周 · 游戏设计基础|阶段 1 · 理解玩家', '第 02 周 · 玩家心理与定位|阶段 1 · 理解玩家', '第 03 周 · 纸面规则原型|阶段 1 · 理解玩家', '第 04 周 · 证据与设计提案|阶段 1 · 理解玩家', '第 05 周 · 最小 PC 原型|阶段 2 · 原型与手感', '第 06 周 · 操作手感与反馈|阶段 2 · 原型与手感', '第 07 周 · 系统、数值与经济|阶段 2 · 原型与手感', '第 08 周 · 单机制复测|阶段 2 · 原型与手感', '第 09 周 · 关卡灰盒|阶段 3 · 关卡与节奏', '第 10 周 · 教学、节奏与难度|阶段 3 · 关卡与节奏', '第 11 周 · 界面、引导与无障碍|阶段 3 · 关卡与节奏', '第 12 周 · 叙事与任务|阶段 3 · 关卡与节奏', '第 13 周 · 美术、动画与声音|阶段 3 · 关卡与节奏', '第 14 周 · 首轮关卡试玩|阶段 3 · 关卡与节奏'])
    },
    { id: 'p1', planned: true, blurb: '为下一门课程预留的浅滩，新课程会从这里登陆。', code: '+', name: '预留航道', fullName: '新课程', facility: '筹建中的码头', tagline: '这片浅滩为下一门课程预留。新增课程时只需在数据中追加一座岛，场景、小地图、目录会自动生成。', accent: '#8aa3b1', x: -1.5, z: 10, r: 1.9, seed: 6.1, chapters: [] },
    { id: 'p2', planned: true, blurb: '远方的沙洲，等待新的课程。', code: '+', name: '预留航道', fullName: '新课程', facility: '筹建中的码头', tagline: '远方的沙洲，等待下一门课程登陆。', accent: '#8aa3b1', x: -26, z: -17, r: 1.7, seed: 3.3, chapters: [] },
    { id: 'p3', planned: true, blurb: '远方的沙洲，等待新的课程。', code: '+', name: '预留航道', fullName: '新课程', facility: '筹建中的码头', tagline: '远方的沙洲，等待下一门课程登陆。', accent: '#8aa3b1', x: 24, z: -22, r: 1.8, seed: 5.4, chapters: [] }
  ];
  COURSES.forEach(function (c) { if (!c.planned) c.href = '?view=reader&course=' + c.id; });
  g.HUB = { COURSES: COURSES, ART: ART, HERO: HERO, ORIGIN: ORIGIN };
})(window);
