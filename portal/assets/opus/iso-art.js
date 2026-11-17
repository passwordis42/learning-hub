/*
 * 2.5D 等轴设施插画生成器（原创）
 * 统一光照：太阳在左后上方 → 顶面最亮、左侧面（朝 +y）次亮、右侧面（朝 +x）最暗，阴影投向右前方。
 * 坐标：x 向右下、y 向左下、z 向上；落地原点在 (100,165)，viewBox 200×200。
 */
(function (g) {
  'use strict';
  var S = 0.866, OX = 100, OY = 165, uid = 0;
  function P(x, y, z) { return [OX + (x - y) * S, OY + (x + y) * 0.5 - z]; }
  function f(n) { return Math.round(n * 10) / 10; }
  function pts(a) { return a.map(function (p) { var q = P(p[0], p[1], p[2]); return f(q[0]) + ',' + f(q[1]); }).join(' '); }

  function Art() {
    this.id = 'iso' + (++uid); this.n = 0; this.els = [];
    this.defs = [
      '<linearGradient id="' + this.id + 'ao" x1="0" y1="0" x2="0" y2="1"><stop offset=".3" stop-color="#0b2a33" stop-opacity="0"/><stop offset="1" stop-color="#0b2a33" stop-opacity=".2"/></linearGradient>',
      '<filter id="' + this.id + 'blur" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="3.2"/></filter>',
      '<radialGradient id="' + this.id + 'sh"><stop offset="0" stop-color="#0b2a33" stop-opacity=".38"/><stop offset="1" stop-color="#0b2a33" stop-opacity="0"/></radialGradient>'
    ];
  }
  var A = Art.prototype;
  A.add = function (s) { this.els.push(s); return this; };
  A.poly = function (a, fill, extra) { return this.add('<polygon points="' + pts(a) + '" fill="' + fill + '"' + (extra ? ' ' + extra : '') + '/>'); };
  A.gid = function () { return this.id + 'g' + (++this.n); };
  /* 投影：把一个底面矩形向右前方拉伸并模糊 */
  A.shadow = function (x, y, w, d, len, op) {
    var k = len || 10;
    return this.add('<polygon filter="url(#' + this.id + 'blur)" opacity="' + (op || 0.32) + '" fill="#0b2a33" points="' + pts([[x, y, 0], [x + w + k, y, 0], [x + w + k, y + d + k * 0.7, 0], [x, y + d + k * 0.7, 0]]) + '" transform="translate(0,1)"/>');
  };
  A.box = function (x, y, z, w, d, h, c, o) {
    o = o || {};
    var x1 = x + w, y1 = y + d, z1 = z + h, ao = 'url(#' + this.id + 'ao)';
    var R = [[x1, y, z], [x1, y1, z], [x1, y1, z1], [x1, y, z1]], L = [[x, y1, z], [x1, y1, z], [x1, y1, z1], [x, y1, z1]];
    this.poly(R, c.r); this.poly(L, c.l);
    if (!o.flat && h > 3) { this.poly(R, ao); this.poly(L, ao); }
    this.poly([[x, y, z1], [x1, y, z1], [x1, y1, z1], [x, y1, z1]], c.t);
    this.add('<polyline points="' + pts([[x, y1, z1], [x1, y1, z1], [x1, y, z1]]) + '" fill="none" stroke="rgba(255,255,255,' + (o.edge == null ? 0.55 : o.edge) + ')" stroke-width=".9" stroke-linejoin="round"/>');
    return this;
  };
  A.isoEllipse = function (x, y, z, r, attrs) {
    var p = P(x, y, z);
    return this.add('<ellipse cx="' + f(p[0]) + '" cy="' + f(p[1]) + '" rx="' + f(r * 1.2247) + '" ry="' + f(r * 0.7071) + '" ' + attrs + '/>');
  };
  A.cyl = function (x, y, z, r, h, c) {
    var b = P(x, y, z), t = P(x, y, z + h), rx = f(r * 1.2247), ry = f(r * 0.7071), gid = this.gid();
    this.defs.push('<linearGradient id="' + gid + '" x1="0" x2="1"><stop offset="0" stop-color="' + c.l + '"/><stop offset=".28" stop-color="' + (c.hi || c.l) + '"/><stop offset=".62" stop-color="' + (c.m || c.l) + '"/><stop offset="1" stop-color="' + c.r + '"/></linearGradient>');
    this.add('<path d="M' + f(b[0] - rx) + ',' + f(t[1]) + ' L' + f(b[0] - rx) + ',' + f(b[1]) + ' A' + rx + ',' + ry + ' 0 0 0 ' + f(b[0] + rx) + ',' + f(b[1]) + ' L' + f(b[0] + rx) + ',' + f(t[1]) + ' Z" fill="url(#' + gid + ')"/>');
    this.add('<ellipse cx="' + f(t[0]) + '" cy="' + f(t[1]) + '" rx="' + rx + '" ry="' + ry + '" fill="' + c.t + '"/>');
    this.add('<path d="M' + f(t[0] - rx) + ',' + f(t[1]) + ' A' + rx + ',' + ry + ' 0 0 0 ' + f(t[0] + rx) + ',' + f(t[1]) + '" fill="none" stroke="rgba(255,255,255,.6)" stroke-width=".9"/>');
    return this;
  };
  /* 圆柱上的环带 */
  A.band = function (x, y, z0, z1, r, fill) {
    var a = P(x, y, z0), b = P(x, y, z1), rx = f(r * 1.2247), ry = f(r * 0.7071);
    return this.add('<path d="M' + f(a[0] - rx) + ',' + f(a[1]) + ' A' + rx + ',' + ry + ' 0 0 0 ' + f(a[0] + rx) + ',' + f(a[1]) + ' L' + f(b[0] + rx) + ',' + f(b[1]) + ' A' + rx + ',' + ry + ' 0 0 1 ' + f(b[0] - rx) + ',' + f(b[1]) + ' Z" fill="' + fill + '"/>');
  };
  /* 低多边形圆锥树 */
  A.cone = function (x, y, z, r, h, cl, cr) {
    var b = P(x, y, z), ap = P(x, y, z + h), rx = r * 1.2247, ry = r * 0.7071;
    this.add('<ellipse cx="' + f(b[0] + 3) + '" cy="' + f(b[1] + 2) + '" rx="' + f(rx) + '" ry="' + f(ry) + '" fill="#0b2a33" opacity=".22" filter="url(#' + this.id + 'blur)"/>');
    this.add('<polygon points="' + f(b[0] - rx) + ',' + f(b[1]) + ' ' + f(ap[0]) + ',' + f(ap[1]) + ' ' + f(b[0]) + ',' + f(b[1] + ry) + '" fill="' + cl + '"/>');
    this.add('<polygon points="' + f(b[0]) + ',' + f(b[1] + ry) + ' ' + f(ap[0]) + ',' + f(ap[1]) + ' ' + f(b[0] + rx) + ',' + f(b[1]) + '" fill="' + cr + '"/>');
    return this;
  };
  A.sphere = function (x, y, z, r, c0, c1, cls) {
    var p = P(x, y, z), gid = this.gid();
    this.defs.push('<radialGradient id="' + gid + '" cx=".36" cy=".32" r=".75"><stop offset="0" stop-color="' + c0 + '"/><stop offset="1" stop-color="' + c1 + '"/></radialGradient>');
    return this.add('<circle' + (cls ? ' class="' + cls + '"' : '') + ' cx="' + f(p[0]) + '" cy="' + f(p[1]) + '" r="' + r + '" fill="url(#' + gid + ')"/>');
  };
  /* 贴在立面上的局部坐标：faceL = 朝 +y 的左立面（u→+x, v→向下），faceR = 朝 +x 的右立面（u→-y, v→向下） */
  A.faceL = function (x, y, z) { var p = P(x, y, z); return 'matrix(0.866,0.5,0,1,' + f(p[0]) + ',' + f(p[1]) + ')'; };
  A.faceR = function (x, y, z) { var p = P(x, y, z); return 'matrix(0.866,-0.5,0,1,' + f(p[0]) + ',' + f(p[1]) + ')'; };
  A.line = function (a, b, stroke, w, extra) { var p = P(a[0], a[1], a[2]), q = P(b[0], b[1], b[2]); return this.add('<line x1="' + f(p[0]) + '" y1="' + f(p[1]) + '" x2="' + f(q[0]) + '" y2="' + f(q[1]) + '" stroke="' + stroke + '" stroke-width="' + (w || 1.5) + '" stroke-linecap="round"' + (extra ? ' ' + extra : '') + '/>'); };
  A.svg = function () { return '<svg viewBox="0 0 200 200" aria-hidden="true"><defs>' + this.defs.join('') + '</defs>' + this.els.join('') + '</svg>'; };

  /* 共用：石砌底座 */
  A.plinth = function (r) {
    r = r || 34;
    var p = P(0, 0, 0);
    this.add('<ellipse cx="' + (p[0] + 8) + '" cy="' + (p[1] + 6) + '" rx="' + (r * 1.5) + '" ry="' + (r * 0.85) + '" fill="url(#' + this.id + 'sh)"/>');
    this.box(-r, -r, 0, r * 2, r * 2, 6, { t: '#efe6d1', l: '#dccfb2', r: '#c3b293' });
    this.box(-r + 5, -r + 5, 6, r * 2 - 10, r * 2 - 10, 1.4, { t: '#f7f1e3', l: '#e6dbc2', r: '#d6c8aa' }, { edge: 0.8 });
    return this;
  };

  var C = {
    white: { t: '#ffffff', l: '#f1f6f5', r: '#c6d6d3' },
    teal: { t: '#5fd6c4', l: '#2fb5a4', r: '#1f8a7d' },
    tealDark: { t: '#2d6f73', l: '#1d5559', r: '#133f43' },
    ink: { t: '#2a4a55', l: '#1a3540', r: '#10252d' },
    lav: { t: '#ffffff', l: '#f1eeff', r: '#c4bde6' },
    violet: { t: '#a094ff', l: '#7a6cf0', r: '#5747c9' },
    cream: { t: '#fff8ee', l: '#fbefe0', r: '#dcc6ab' },
    die: { t: '#ffffff', l: '#f6f0e6', r: '#d6cbbb' }
  };

  var ART = {};

  /* ============ AI 图谱设施：知识图谱灯塔 ============ */
  (function () {
    var a = new Art();
    a.plinth(34);
    // 后侧小屋
    a.shadow(12, -30, 16, 14, 10);
    a.box(12, -30, 7.4, 16, 14, 13, C.white).box(11, -31, 20.4, 18, 16, 2.6, C.teal);
    // 左侧实验楼
    a.shadow(-30, 6, 18, 18, 10);
    a.box(-30, 6, 7.4, 18, 18, 16, C.white).box(-31, 5, 23.4, 20, 20, 2.6, C.teal);
    a.add('<g transform="' + a.faceL(-30, 24, 20) + '"><rect class="win" x="3" y="0" width="4" height="5" rx=".8" fill="#2a6f78"/><rect class="win" x="10" y="0" width="4" height="5" rx=".8" fill="#2a6f78"/></g>');
    a.add('<g transform="' + a.faceR(-12, 24, 20) + '"><rect x="4" y="0" width="4" height="5" rx=".8" fill="#1d4d55"/><rect x="11" y="0" width="4" height="5" rx=".8" fill="#1d4d55"/></g>');
    // 主塔
    a.shadow(-14, -14, 28, 28, 22, 0.38);
    a.box(-14, -14, 7.4, 28, 28, 9, C.tealDark);
    a.box(-10, -10, 16.4, 20, 20, 58, C.white);
    a.box(-10.7, -10.7, 36, 21.4, 21.4, 4, C.teal, { flat: true });
    a.box(-10.7, -10.7, 56, 21.4, 21.4, 4, C.teal, { flat: true });
    a.add('<g transform="' + a.faceL(-10, 10, 33) + '"><rect class="win" x="7" y="0" width="6" height="9" rx="3" fill="#123a42"/></g>');
    a.add('<g transform="' + a.faceL(-10, 10, 52) + '"><rect class="win" x="8" y="0" width="4" height="5" rx="2" fill="#123a42"/></g>');
    a.add('<g transform="' + a.faceR(10, 10, 52) + '"><rect x="8" y="0" width="4" height="5" rx="2" fill="#0d2c33"/></g>');
    a.box(-13, -13, 74.4, 26, 26, 4, C.ink);
    a.box(-7, -7, 78.4, 14, 14, 7, { t: '#bff8ec', l: '#7fe3d2', r: '#46b9a8' }, { edge: 0.8 });
    // 光球 + 环绕的知识节点
    var o = P(0, 0, 100);
    a.add('<g class="fx"><circle class="pulse" cx="' + f(o[0]) + '" cy="' + f(o[1]) + '" r="22" fill="#8ff5df" opacity=".32"/></g>');
    a.sphere(0, 0, 100, 11, '#ffffff', '#5fd6c4', 'core');
    var rx = f(38 * 1.2247), ry = f(38 * 0.7071);
    var orbit = 'M' + f(o[0] - rx) + ',' + f(o[1]) + ' A' + rx + ',' + ry + ' 0 1 0 ' + f(o[0] + rx) + ',' + f(o[1]) + ' A' + rx + ',' + ry + ' 0 1 0 ' + f(o[0] - rx) + ',' + f(o[1]);
    a.add('<g class="fx">');
    a.add('<path d="' + orbit + '" fill="none" stroke="#dffcf5" stroke-width="1" stroke-dasharray="2 4" opacity=".75"/>');
    var rx2 = f(24 * 1.2247), ry2 = f(24 * 0.7071), o2 = P(0, 0, 116);
    var orbit2 = 'M' + f(o2[0] + rx2) + ',' + f(o2[1]) + ' A' + rx2 + ',' + ry2 + ' 0 1 1 ' + f(o2[0] - rx2) + ',' + f(o2[1]) + ' A' + rx2 + ',' + ry2 + ' 0 1 1 ' + f(o2[0] + rx2) + ',' + f(o2[1]);
    a.add('<path d="' + orbit2 + '" fill="none" stroke="#dffcf5" stroke-width="1" stroke-dasharray="2 4" opacity=".55"/>');
    [[orbit, 0, 4.2, 9], [orbit, -3, 3.4, 9], [orbit, -6, 3.8, 9], [orbit2, -1.5, 3, 7], [orbit2, -5, 2.6, 7]].forEach(function (n) {
      a.add('<g><circle r="' + n[2] + '" fill="#ffffff"/><circle r="' + (n[2] * 0.45) + '" fill="#2fb5a4"/><animateMotion dur="' + n[3] + 's" begin="' + n[1] + 's" repeatCount="indefinite" path="' + n[0] + '"/></g>');
    });
    a.add('</g>');
    // 前景树
    a.cone(26, 20, 7.4, 4.5, 15, '#4f9a6c', '#2f6f4f');
    a.cone(30, 10, 7.4, 3.6, 12, '#5aa676', '#357a56');
    a.cone(-26, -24, 7.4, 4, 13, '#4f9a6c', '#2f6f4f');
    ART.ai = a.svg();
  })();

  /* ============ NMR 信号实验站：超导磁体 ============ */
  (function () {
    var a = new Art();
    a.plinth(34);
    // 后侧控制室
    a.shadow(10, -31, 22, 16, 10);
    a.box(10, -31, 7.4, 22, 16, 16, C.lav).box(9, -32, 23.4, 24, 18, 2.6, C.violet);
    a.add('<g transform="' + a.faceL(10, -15, 19) + '"><rect class="win" x="3" y="0" width="7" height="5" rx="1" fill="#ffd27a"/><rect x="13" y="0" width="5" height="9" rx="1" fill="#4b4378"/></g>');
    a.line([24, -24, 26], [24, -24, 52], '#4b4378', 1.6);
    a.isoEllipse(24, -24, 52, 4, 'fill="none" stroke="#4b4378" stroke-width="1.4"');
    a.add('<g class="fx"><circle class="pulse" cx="' + f(P(24, -24, 54)[0]) + '" cy="' + f(P(24, -24, 54)[1]) + '" r="2.6" fill="#ffd27a"/></g>');
    // 线缆
    var c1 = P(6, -6, 9), c2 = P(14, -18, 8);
    a.add('<path d="M' + f(c1[0]) + ',' + f(c1[1]) + ' Q' + f((c1[0] + c2[0]) / 2) + ',' + f(c1[1] + 6) + ' ' + f(c2[0]) + ',' + f(c2[1]) + '" stroke="#3b3560" stroke-width="2" fill="none"/>');
    // 磁体
    a.shadow(-26, -24, 40, 40, 26, 0.36);
    a.box(-24, -22, 7.4, 36, 36, 4, { t: '#e2def5', l: '#cbc5e8', r: '#a69fcf' });
    [[-18, -16], [6, -16], [-18, 8], [6, 8]].forEach(function (q) { a.box(q[0], q[1], 11.4, 4, 4, 5, { t: '#8a84b0', l: '#6f6a8c', r: '#55507a' }, { flat: true }); });
    a.cyl(-6, -4, 16.4, 20, 60, { l: '#e9e5fb', hi: '#ffffff', m: '#e3dff7', r: '#a59dd6', t: '#fbfaff' });
    a.band(-6, -4, 34, 41, 20.2, '#7a6cf0');
    a.band(-6, -4, 56, 58.5, 20.2, '#9a8ff5');
    a.isoEllipse(-6, -4, 76.4, 13, 'fill="#e6e2f8"');
    a.isoEllipse(-6, -4, 76.4, 7, 'fill="#3b3466"');
    a.add('<g class="fx">'); a.isoEllipse(-6, -4, 76.4, 4, 'fill="#cfc8ff" class="pulse"'); a.add('</g>');
    // 共振环
    a.add('<g class="fx">');
    a.isoEllipse(-6, -4, 92, 28, 'class="pulse" fill="none" stroke="#d8d2ff" stroke-width="1.4" opacity=".75"');
    a.isoEllipse(-6, -4, 104, 18, 'class="pulse d2" fill="none" stroke="#f1eeff" stroke-width="1.4" opacity=".85"');
    a.isoEllipse(-6, -4, 114, 9, 'class="pulse d3" fill="none" stroke="#ffffff" stroke-width="1.2" opacity=".9"');
    a.add('</g>');
    // 前侧信号屏（立体面板，谱线贴在右立面）
    a.shadow(18, 8, 4, 24, 10);
    a.box(20, 12, 7.4, 3, 20, 4, C.ink);
    a.box(20.5, 10, 11.4, 2.5, 24, 22, C.ink);
    a.add('<g transform="' + a.faceR(23, 34, 33.4) + '"><rect x="1.6" y="1.6" width="20.8" height="18.8" rx="1.5" fill="#1b1640"/>' +
      '<path class="spec fx" d="M3 17 L7 17 L8.5 15 L10 17 L11.5 17 L13 5 L14.5 17 L16 17 L17 12.5 L18 17 L21 17" fill="none" stroke="#9ef3ff" stroke-width="1" stroke-linejoin="round" style="stroke-dasharray:60;stroke-dashoffset:60"/></g>');
    a.cone(-28, 22, 7.4, 4, 13, '#5aa676', '#357a56');
    a.cone(28, -6, 7.4, 3.4, 11, '#4f9a6c', '#2f6f4f');
    ART.nmr = a.svg();
  })();

  /* ============ GAME 关卡工坊 ============ */
  (function () {
    var a = new Art();
    a.plinth(34);
    var roofF = '#ff8a66', roofB = '#c9533a', ridge = 50, x0 = -26, x1 = 12, y0 = -28, y1 = -4, zt = 33.4, ym = (y0 + y1) / 2;
    a.shadow(x0, y0, x1 - x0, y1 - y0, 26, 0.36);
    // 后坡
    a.poly([[x0 - 2, y0 - 3, zt - 2], [x1 + 2, y0 - 3, zt - 2], [x1 + 2, ym, ridge], [x0 - 2, ym, ridge]], roofB);
    // 右立面 + 山墙
    a.poly([[x1, y0, 7.4], [x1, y1, 7.4], [x1, y1, zt], [x1, ym, ridge], [x1, y0, zt]], C.cream.r);
    a.poly([[x1, y0, 7.4], [x1, y1, 7.4], [x1, y1, zt], [x1, ym, ridge], [x1, y0, zt]], 'url(#' + a.id + 'ao)');
    a.add('<g transform="' + a.faceR(x1, y1, 26) + '"><rect class="win" x="8" y="0" width="8" height="8" rx="1" fill="#ffd27a"/><path d="M12 0 V8 M8 4 H16" stroke="#e0b25f" stroke-width="1"/></g>');
    // 左立面
    a.poly([[x0, y1, 7.4], [x1, y1, 7.4], [x1, y1, zt], [x0, y1, zt]], C.cream.l);
    a.poly([[x0, y1, 7.4], [x1, y1, 7.4], [x1, y1, zt], [x0, y1, zt]], 'url(#' + a.id + 'ao)');
    a.add('<g transform="' + a.faceL(x0, y1, zt) + '">' +
      '<rect class="win" x="6" y="9" width="9" height="9" rx="1" fill="#ffd27a"/><path d="M10.5 9 V18 M6 13.5 H15" stroke="#e0b25f" stroke-width="1"/>' +
      '<path d="M22 26 V15 a5 5 0 0 1 10 0 V26 Z" fill="#7a3b2b"/><circle cx="30" cy="20" r=".9" fill="#ffd27a"/></g>');
    // 前坡
    a.poly([[x0 - 2, y1 + 3, zt - 2], [x1 + 2, y1 + 3, zt - 2], [x1 + 2, ym, ridge], [x0 - 2, ym, ridge]], roofF);
    a.add('<polyline points="' + pts([[x0 - 2, y1 + 3, zt - 2], [x1 + 2, y1 + 3, zt - 2], [x1 + 2, ym, ridge]]) + '" fill="none" stroke="rgba(255,255,255,.55)" stroke-width="1"/>');
    a.line([x0 - 2, ym, ridge], [x1 + 2, ym, ridge], '#ffd0bd', 1.6);
    // 旗
    var fp = P(-16, ym, ridge), ft = P(-16, ym, ridge + 24);
    a.line([-16, ym, ridge], [-16, ym, ridge + 24], '#4a3a30', 1.6);
    a.add('<path class="flag act" d="M' + f(ft[0]) + ',' + f(ft[1]) + ' L' + f(ft[0] + 18) + ',' + f(ft[1] + 5) + ' L' + f(ft[0]) + ',' + f(ft[1] + 11) + ' Z" fill="#ffd27a"/>');
    // 试玩格子
    for (var i = 0; i < 3; i++) for (var j = 0; j < 3; j++) {
      var dark = (i + j) % 2 === 0;
      a.box(-30 + i * 8, 6 + j * 8, 7.4, 8, 8, 1.2, dark ? { t: '#a9c9a9', l: '#88ad8c', r: '#6d9372' } : { t: '#f6efe0', l: '#e3d7bd', r: '#d1c3a4' }, { edge: 0.25 });
    }
    var pl = P(-18, 18, 8.6);
    a.add('<g class="float"><ellipse cx="' + f(pl[0]) + '" cy="' + f(pl[1]) + '" rx="5" ry="2.4" fill="#0b2a33" opacity=".25"/></g>');
    a.add('<g class="float act" style="animation-duration:.9s">');
    a.box(-21, 15, 10.6, 6, 6, 6, { t: '#ff9c7d', l: '#f2775a', r: '#c9533a' }, { edge: 0.6 });
    a.add('</g>');
    // 骰子
    a.shadow(12, 8, 18, 18, 16, 0.36);
    a.box(12, 8, 7.4, 18, 18, 18, C.die);
    var pt = P(21, 17, 25.4);
    a.add('<ellipse cx="' + f(pt[0]) + '" cy="' + f(pt[1]) + '" rx="3.4" ry="2" fill="#f2775a"/>');
    a.add('<g transform="' + a.faceL(12, 26, 25.4) + '" fill="#2b3a45"><circle cx="4.5" cy="4.5" r="1.7"/><circle cx="13.5" cy="13.5" r="1.7"/></g>');
    a.add('<g transform="' + a.faceR(30, 26, 25.4) + '" fill="#1f2b33"><circle cx="4.5" cy="4.5" r="1.6"/><circle cx="13.5" cy="4.5" r="1.6"/><circle cx="9" cy="9" r="1.6"/><circle cx="4.5" cy="13.5" r="1.6"/><circle cx="13.5" cy="13.5" r="1.6"/></g>');
    // 漂浮星形宝石（左亮右暗两半，带立体感）
    var sc = P(26, -14, 64);
    var star = [];
    for (var k = 0; k < 10; k++) { var ang = -Math.PI / 2 + k * Math.PI / 5, rr = k % 2 ? 5.5 : 12; star.push([sc[0] + Math.cos(ang) * rr, sc[1] + Math.sin(ang) * rr]); }
    var sp = star.map(function (q) { return f(q[0]) + ',' + f(q[1]); });
    a.add('<g class="float act"><g class="spin act">' +
      '<polygon points="' + sp.join(' ') + '" fill="#f0b443"/>' +
      '<polygon points="' + f(sc[0]) + ',' + f(sc[1]) + ' ' + sp.slice(5).join(' ') + ' ' + sp[0] + '" fill="#ffe08a"/>' +
      '<polygon points="' + sp.join(' ') + '" fill="none" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/></g></g>');
    a.cone(-28, -26, 7.4, 4.2, 14, '#5aa676', '#357a56');
    a.cone(30, -28, 7.4, 3.4, 11, '#4f9a6c', '#2f6f4f');
    ART.game = a.svg();
  })();

  /* ============ 预留航道：浮标 ============ */
  (function () {
    var a = new Art();
    var p = P(0, 0, 0);
    a.add('<g class="float">');
    a.isoEllipse(0, 0, 0, 14, 'fill="#0b2a33" opacity=".22" filter="url(#' + a.id + 'blur)"');
    a.cyl(0, 0, 0, 10, 8, { l: '#ff9677', hi: '#ffb39b', m: '#f2775a', r: '#b84a31', t: '#ff9c7d' });
    a.cyl(0, 0, 8, 7, 18, { l: '#ff9677', hi: '#ffb39b', m: '#f2775a', r: '#b84a31', t: '#ff9c7d' });
    a.band(0, 0, 14, 20, 7.1, '#ffffff');
    a.line([0, 0, 26], [0, 0, 46], '#3b4a54', 1.6);
    a.sphere(0, 0, 48, 4.2, '#fff6cf', '#f2b443', 'pulse');
    a.box(2, 6, 30, 22, 1.5, 11, { t: '#fbf7ee', l: '#f8f3e8', r: '#d8cfbd' });
    a.add('<g transform="' + a.faceL(2, 7.5, 41) + '"><text x="11" y="7.6" text-anchor="middle" font-size="6" font-weight="800" fill="#3b4a54" font-family="sans-serif">筹建中</text></g>');
    a.add('</g>');
    ART.planned = a.svg();
  })();

  g.HUB.ART = ART;
})(window);
