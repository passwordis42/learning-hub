(function () {
  'use strict';
  var COURSES = HUB.COURSES, ART = HUB.ART, HERO = HUB.HERO;
  var $ = function (s) { return document.querySelector(s); };
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href*="view=reader"]');
    if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
    e.preventDefault();
    if (window.LH_ROUTE) window.LH_ROUTE(a.getAttribute('href'));
  });
  var body = document.body;
  var canvas = $('#sea');
  var PITCH = 0.9;
  setTimeout(function () {
    var veil = document.getElementById('veil');
    if (veil && !veil.classList.contains('gone')) veil.classList.add('gone');
  }, 3000);

  /* ---------- 状态 ---------- */
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var stored = localStorage.getItem('lh-motion');
  var motionOn = stored ? stored === 'on' : !reduce;
  var quality = localStorage.getItem('lh-quality') || 'high';
  var cam = { x: 0, z: -3, dist: 44 };
  var camT = { x: 0, z: -3, dist: 44 };
  var sel = -1, hov = -1;
  var vel = { x: 0, z: 0, d: 0 };
  var SNAP = /demo=snap/.test(location.search);
  if (SNAP) { var stl = document.createElement('style'); stl.textContent = '*,*::before,*::after{transition:none!important}'; document.head.appendChild(stl); }
  var dirty = true;

  function homeView() {
    var a = innerWidth / innerHeight;
    var d = 47 * Math.min(2.2, Math.max(1, 1.45 / a));
    return { x: 0, z: a < 1 ? -4.5 : -8, dist: d };
  }
  var hv = homeView(); cam.x = camT.x = hv.x; cam.z = camT.z = hv.z; cam.dist = camT.dist = hv.dist + 14; // 入场推镜

  function progressOf(courseId) {
    var course = COURSES.filter(function (item) { return item.id === courseId; })[0];
    if (!course || !window.HUB_PROGRESS) return { done: [], map: {} };
    var map = window.HUB_PROGRESS.present(courseId, course.chapters.map(function (chapter) { return chapter.id; }));
    return { done: Object.keys(map), map: map };
  }
  function paintWelcome() {
    [].forEach.call(document.querySelectorAll('.w-isle[data-course]'), function (button) {
      var course = COURSES.filter(function (item) { return item.id === button.getAttribute('data-course'); })[0];
      var meter = button.querySelector('.meter');
      if (!course || !meter || courseDisabled(course)) return;
      meter.textContent = '已完成 ' + progressOf(course.id).done.length + ' / ' + course.total;
    });
  }

  /* ---------- 海洋 ---------- */
  var ocean = Ocean.create(canvas, { pitch: PITCH, quality: quality, onFallback: toFallback });
  function toFallback() { body.classList.add('no-gl'); ocean = null; dirty = true; }
  if (!ocean) toFallback();
  else ocean.setIslands(COURSES);

  /* ---------- 场景锚点（设施 + 名牌） ----------
   * 结构：.anchor（每帧 translate3d）> .fac-pos（每帧 scale，无过渡）> .facility（悬停/选中过渡）
   *                                   > .tag-pos（每帧位移，无过渡）> .tag（悬停/选中过渡）
   * 每帧只写 transform，不改 CSS 变量和尺寸，避免与过渡打架造成卡顿。 */
  function courseDisabled(course) { return !!(course && course.disabled); }
  var anchors = COURSES.map(function (c, i) {
    var el = document.createElement('div');
    el.className = 'anchor' + (c.planned ? ' planned' : '') + (c.disabled ? ' is-disabled' : '');
    el.style.setProperty('--accent', c.accent);
    el.style.setProperty('--r', c.r);
    var meta = c.disabled ? '已下线' : (c.planned ? '新课程预留' : c.facility);
    var label = c.disabled
      ? (c.fullName + '已下线，不能进入这门课。')
      : (c.planned ? '预留航道：新课程筹建中' : c.fullName + '课程岛，' + c.facility + '。' + (c.blurb || ''));
    el.innerHTML =
      '<div class="fac-pos"><div class="land"></div><div class="facility">' +
        '<div class="boot" aria-hidden="true"><i class="b-beam"></i><i class="burst"></i><i class="burst b2"></i><i class="spark s1"></i><i class="spark s2"></i><i class="spark s3"></i><i class="spark s4"></i><i class="spark s5"></i></div>' +
        (ART[c.planned ? 'planned' : c.id] || '') + '</div></div>' +
      '<div class="tag-pos"><button class="tag" type="button"' + (c.disabled ? ' aria-disabled="true"' : '') + ' aria-label="' + label + '">' +
      '<span class="badge" style="font-size:' + (c.code.length > 2 ? '.62rem' : '.78rem') + '">' + c.code + '</span>' +
      '<span class="t-col"><span class="t-name">' + (c.planned ? '预留航道' : c.name) + '</span><span class="t-meta">' + meta + '</span>' +
      '<span class="t-desc"><span>' + (c.disabled ? '这门课已下线，不能进入。' : (c.blurb || '')) + '</span></span></span></button></div>';
    var tag = el.querySelector('.tag');
    tag.addEventListener('click', function (e) {
      e.stopPropagation();
      if (courseDisabled(c)) { e.preventDefault(); return; }
      select(i);
    });
    tag.addEventListener('keydown', function (e) {
      if (!courseDisabled(c) || (e.key !== 'Enter' && e.key !== ' ')) return;
      e.preventDefault();
      e.stopPropagation();
    });
    tag.addEventListener('mouseenter', function () { if (!courseDisabled(c)) setHover(i); });
    tag.addEventListener('mouseleave', function () { setHover(-1); });
    tag.addEventListener('focus', function () { if (!courseDisabled(c)) setHover(i); });
    tag.addEventListener('blur', function () { setHover(-1); });
    $('#anchors').appendChild(el);
    return el;
  });
  var anchorParts = anchors.map(function (a) { return { fac: a.querySelector('.fac-pos'), tag: a.querySelector('.tag-pos'), box: null }; });

  /* ---------- 小地图 ---------- */
  (function buildMinimap() {
    var s = '<circle r="44" fill="#d7ecec"/><circle r="44" fill="none" stroke="#0f2533" stroke-opacity=".15"/>' +
      '<g stroke="#0f2533" stroke-opacity=".12">' + [0, 45, 90, 135].map(function (a) { return '<path d="M0 -44 V44" transform="rotate(' + a + ')"/>'; }).join('') + '</g>' +
      '<text y="-35" text-anchor="middle" font-size="7" font-weight="800" fill="#f2775a" font-family="serif">N</text>';
    COURSES.forEach(function (c, i) {
      var disabled = courseDisabled(c);
      s += '<circle class="mm-isl' + (disabled ? ' is-disabled' : '') + '" data-i="' + i + '" cx="' + (c.x * 1.3).toFixed(1) + '" cy="' + (c.z * 1.3).toFixed(1) + '" r="' + (c.r * 1.1).toFixed(1) + '" fill="' + (c.planned ? '#efe3c4' : (disabled ? '#8d9898' : c.accent)) + '" ' + (c.planned ? 'stroke="#8aa3b1" stroke-dasharray="1.5 1.5"' : '') + (disabled ? ' role="button" tabindex="0" aria-disabled="true" aria-label="' + c.name + '已下线，不能进入" stroke="#5c6b73" stroke-width="0.6"' : '') + '><title>' + (c.planned ? '预留航道' : (disabled ? c.name + '已下线' : c.name)) + '</title></circle>';
    });
    s += '<clipPath id="mmc"><circle r="44"/></clipPath><polygon id="mmView" clip-path="url(#mmc)" fill="rgba(15,37,51,.08)" stroke="#0f2533" stroke-width="1" stroke-linejoin="round"/>';
    $('#mm').innerHTML = s;
    function minimapActivate(e) {
      var t = e.target.closest('.mm-isl');
      if (!t) return;
      var i = +t.dataset.i;
      if (courseDisabled(COURSES[i])) { e.preventDefault(); e.stopPropagation(); return; }
      if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return;
      if (e.type === 'keydown') e.preventDefault();
      select(i);
    }
    $('#mm').addEventListener('click', minimapActivate);
    $('#mm').addEventListener('keydown', minimapActivate);
  })();

  /* ---------- 航线面板 ---------- */
  (function buildWelcome() {
    function gem(c) {
      var top = c.planned ? '#f3ead6' : c.accent;
      return '<svg viewBox="0 0 40 40" aria-hidden="true">' +
        '<polygon points="20,3 35,11.5 35,28.5 20,37 5,28.5 5,11.5" fill="' + (c.planned ? '#d8ccb2' : c.accent) + '"/>' +
        '<polygon points="20,20 35,11.5 35,28.5 20,37" fill="rgba(0,0,0,.22)"/>' +
        '<polygon points="20,3 35,11.5 20,20 5,11.5" fill="rgba(255,255,255,.28)"/>' +
        (c.planned ? '<polygon points="20,3 35,11.5 35,28.5 20,37 5,28.5 5,11.5" fill="none" stroke="#8aa3b1" stroke-dasharray="2 2"/>' : '') +
        '</svg>';
    }
    var real = COURSES.filter(function (c) { return !c.planned && !c.disabled; });
    var planned = COURSES.filter(function (c) { return c.planned; });
    $('#wCount').textContent = real.length + ' 座课程岛';
    var rows = COURSES.filter(function (c) { return !c.planned; }).map(function (c) {
      var i = COURSES.indexOf(c);
      if (courseDisabled(c)) {
        return '<li><button type="button" class="w-isle is-disabled" aria-disabled="true" data-i="' + i + '" data-course="' + c.id + '" style="--accent:' + c.accent + '" aria-label="' + c.fullName + '已下线，不能进入"><span class="gem">' + gem(c) + '<b style="font-size:.44rem">' + c.code + '</b></span>' +
          '<span class="txt"><strong>' + c.fullName + '</strong><small>' + c.facility + '</small></span>' +
          '<span class="meter">已下线</span></button></li>';
      }
      return '<li><button class="w-isle" data-i="' + i + '" data-course="' + c.id + '" style="--accent:' + c.accent + '"><span class="gem">' + gem(c) + '<b' + (c.code.length > 3 ? ' style="font-size:.44rem"' : '') + '>' + c.code + '</b></span>' +
        '<span class="txt"><strong>' + c.fullName + '</strong><small>' + c.facility + '</small></span>' +
        '<span class="meter">已完成 0 / ' + c.total + '</span>' +
        '<svg class="go" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg></button></li>';
    });
    if (planned.length) {
      var pi = COURSES.indexOf(planned[0]);
      rows.push('<li><button class="w-isle planned" data-i="' + pi + '"><span class="gem">' + gem(planned[0]) + '<b style="color:#6b8291">+</b></span>' +
        '<span class="txt"><strong>预留航道</strong><small>' + planned.length + ' 处浅滩，留给之后的新课程</small></span>' +
        '<svg class="go" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg></button></li>');
    }
    $('#wIsles').innerHTML = rows.join('');
    [].forEach.call(document.querySelectorAll('.w-isle'), function (b) {
      var i = +b.dataset.i;
      b.addEventListener('click', function (e) {
        if (courseDisabled(COURSES[i])) { e.preventDefault(); e.stopPropagation(); return; }
        select(i);
      });
      b.addEventListener('keydown', function (e) {
        if (!courseDisabled(COURSES[i]) || (e.key !== 'Enter' && e.key !== ' ')) return;
        e.preventDefault();
        e.stopPropagation();
      });
      b.addEventListener('mouseenter', function () { if (!courseDisabled(COURSES[i])) setHover(i); });
      b.addEventListener('focus', function () { if (!courseDisabled(COURSES[i])) setHover(i); });
      b.addEventListener('mouseleave', function () { setHover(-1); });
      b.addEventListener('blur', function () { setHover(-1); });
    });
    var saved = localStorage.getItem('lh-welcome');
    var collapsed = saved ? saved === 'min' : innerHeight <= 560;
    function applyW() {
      body.classList.toggle('w-collapsed', collapsed);
      $('#wMin').setAttribute('aria-expanded', String(!collapsed));
      $('#wMin').title = collapsed ? '展开航线面板' : '收起航线面板';
    }
    $('#wMin').addEventListener('click', function () { collapsed = !collapsed; localStorage.setItem('lh-welcome', collapsed ? 'min' : 'open'); applyW(); });
    applyW();
    paintWelcome();
  })();

  /* ---------- 文字目录（键盘 / 读屏 / 降级入口，含全站搜索） ---------- */
  function renderCatalog(q) {
    q = (q || '').trim().toLowerCase();
    $('#courseList').innerHTML = COURSES.map(function (c, i) {
      if (courseDisabled(c)) {
        var hay = (c.fullName + ' ' + c.facility + ' ' + c.name + ' 已下线').toLowerCase();
        if (q && hay.indexOf(q) < 0) return '';
        return '<div class="cat-course is-disabled" style="--accent:' + c.accent + '"><button type="button" class="course-row is-disabled" data-i="' + i + '" aria-disabled="true"><span class="badge" style="font-size:.62rem">' + c.code + '</span><span><b>' + c.fullName + '</b><span>已下线 · 不能进入</span></span></button></div>';
      }
      if (c.planned) return q ? '' : '<button class="course-row planned" data-i="' + i + '" style="--accent:' + c.accent + '"><span class="badge">+</span><span><b>预留航道</b><span>筹建中 · 新课程从这里登陆</span></span></button>';
      var p = progressOf(c.id);
      var hits = c.chapters.map(function (ch, k) { return { ch: ch, k: k }; }).filter(function (o) { return !q || (o.ch.t + o.ch.g).toLowerCase().indexOf(q) >= 0; });
      var courseHit = !q || (c.fullName + c.facility + c.tagline).toLowerCase().indexOf(q) >= 0;
      if (q && !hits.length && !courseHit) return '';
      return '<details class="cat-course" style="--accent:' + c.accent + '"' + (q ? ' open' : '') + '>' +
        '<summary class="course-row"><span class="badge" style="font-size:' + (c.code.length > 2 ? '.62rem' : '.85rem') + '">' + c.code + '</span><span><b>' + c.fullName + '</b><span>' + c.facility + ' · 共 ' + c.total + ' 项 · 已完成 ' + p.done.length + '</span></span><i class="chev" aria-hidden="true"></i></summary>' +
        '<ol class="cat-list">' + hits.map(function (o) { return '<li' + (p.map[o.ch.id] ? ' class="done"' : '') + '><a href="' + o.ch.href + '"><span>' + o.ch.t + '</span><small>' + o.ch.g + '</small></a></li>'; }).join('') +
        (!q && c.total > c.chapters.length ? '<li class="more"><a href="' + c.href + '">查看全部 ' + c.total + ' 项 →</a></li>' : '') + '</ol>' +
        '<div class="cat-actions"><button class="mini" data-fly="' + i + '">在海上查看</button><a class="mini" href="' + c.href + '">进入课程</a></div></details>';
    }).join('') || '<p class="empty">没有找到“' + q + '”。换个关键词试试。</p>';
  }
  renderCatalog('');
  $('#catSearch').addEventListener('input', function (e) { renderCatalog(e.target.value); });
  $('#catClear').addEventListener('click', function () { $('#catSearch').value = ''; renderCatalog(''); $('#catSearch').focus(); });
  $('#courseList').addEventListener('click', function (e) {
    var b = e.target.closest('button.course-row, [data-fly]');
    if (!b) return;
    var i = +(b.dataset.i || b.dataset.fly);
    if (courseDisabled(COURSES[i])) { e.preventDefault(); e.stopPropagation(); return; }
    e.preventDefault(); closeDrawer(); select(i);
  });
  $('#courseList').addEventListener('keydown', function (e) {
    var b = e.target.closest && e.target.closest('button.course-row');
    if (!b || (e.key !== 'Enter' && e.key !== ' ')) return;
    if (!courseDisabled(COURSES[+b.dataset.i])) return;
    e.preventDefault();
    e.stopPropagation();
  });
  function openDrawer() {
    if (body.classList.contains('assist-open')) { requestCloseAssist(); return; }
    renderCatalog($('#catSearch').value);
    body.classList.add('drawer-open');
    $('#btnList').setAttribute('aria-expanded', 'true');
    setTimeout(function () { $('#catSearch').focus(); }, 50);
  }
  function closeDrawer() { body.classList.remove('drawer-open'); $('#btnList').setAttribute('aria-expanded', 'false'); }
  $('#btnList').addEventListener('click', function () { body.classList.contains('drawer-open') ? closeDrawer() : openDrawer(); });
  $('#scrim').addEventListener('click', function () {
    if (body.classList.contains('assist-open')) requestCloseAssist();
    else closeDrawer();
  });

  /* ---------- 助手设置：沿用页面内存里的四厂商配置，不另存密钥 ---------- */
  var assistOpener = null;
  var assistPin = null;
  function pinAssistScroll() {
    if (!body.classList.contains('assist-open')) return;
    var top = body._assistScroll || 0;
    if (Math.abs(window.scrollY - top) > 1) window.scrollTo({ top: top, behavior: 'instant' });
  }
  function openAssist() {
    /* 访客不能打开网络配置页。预设在页面加载时写入内存，不从这里进入。 */
  }
  function closeAssist() {
    if (!body.classList.contains('assist-open')) return;
    if (assistPin) removeEventListener('scroll', assistPin);
    assistPin = null;
    body.classList.remove('assist-open');
    $('#btnAssist').setAttribute('aria-expanded', 'false');
    var courseBtn = document.getElementById('open-settings');
    if (courseBtn) courseBtn.setAttribute('aria-expanded', 'false');
    body.dataset.view = body.classList.contains('in-course') ? 'reader' : 'hub';
    var scroll = body._assistScroll || 0;
    var opener = assistOpener;
    if (window.LH_RESTORE) window.LH_RESTORE(scroll);
    var focusNode = opener && document.body.contains(opener) ? opener : (body.classList.contains('in-course') ? courseBtn : $('#btnAssist'));
    if (focusNode) focusNode.focus({ preventScroll: true });
  }
  function requestCloseAssist() {
    if (window.ATLAS_SETTINGS && window.ATLAS_SETTINGS.confirmLeave) window.ATLAS_SETTINGS.confirmLeave(closeAssist);
    else closeAssist();
  }
  $('#btnAssist').addEventListener('click', function () {
    body.classList.contains('assist-open') ? requestCloseAssist() : openAssist($('#btnAssist'));
  });
  var openSettings = document.getElementById('open-settings');
  if (openSettings) openSettings.addEventListener('click', function () {
    body.classList.contains('assist-open') ? requestCloseAssist() : openAssist(openSettings);
  });
  $('#assistClose').addEventListener('click', requestCloseAssist);
  var settingsBack = document.getElementById('settings-back');
  if (settingsBack) settingsBack.addEventListener('click', requestCloseAssist);

  /* ---------- 选中 / 设施预览 ---------- */
  function setHover(i) {
    if (hov === i) return;
    hov = i; dirty = true;
    anchors.forEach(function (a, k) { a.classList.toggle('is-hover', k === i); });
    canvas.style.cursor = i >= 0 ? 'pointer' : '';
  }

  function fillDock(c) {
    var dock = $('#dock');
    dock.style.setProperty('--accent', c.accent);
    $('#dockHero').style.setProperty('--hero-bg', c.heroBg || '#d9eef0');
    $('#dockHero').innerHTML = (HERO[c.planned ? 'planned' : c.id] || '') +
      '<span class="hero-label"><i></i>' + c.facility + (c.planned ? '' : ' · 运行中') + '</span>';
    var html = '<div class="eyebrow" style="margin-top:1.1rem">' + (c.planned ? 'RESERVED · 预留' : c.code + ' · 课程岛') + '</div>' +
      '<h2>' + (c.planned ? '预留航道' : c.fullName) + '</h2><p class="sub">' + c.tagline + '</p>';
    var actions = '';
    if (!c.planned) {
      var p = progressOf(c.id); var n = c.total || c.chapters.length || 1; var done = (p.done || []).length;
      var startIdx = 0;
      c.chapters.forEach(function (ch, idx) {
        if (c.firstStudyId && ch.id === c.firstStudyId) startIdx = idx;
      });
      var nextIdx = -1;
      for (var m = startIdx; m < c.chapters.length; m++) {
        var cand = c.chapters[m];
        if (!p.map[cand.id] && cand.id !== 'ai-tutor' && cand.id !== 'game-coach' && cand.kind !== 'document') {
          nextIdx = m;
          break;
        }
      }
      if (nextIdx < 0) nextIdx = startIdx;
      var rec = c.chapters[nextIdx] || c.chapters[0];
      var recLabel = done > 0 ? '推荐继续' : '新手起步第一课';
      var recSub = done > 0
        ? (rec.g + ' · 已完成 ' + done + ' 节，点击下方可继续推进')
        : (rec.g + ' · 也可先在目录查看全景路线图');
      html += '<div class="stats"><div class="stat"><b>' + n + '</b><span>目录条目</span></div><div class="stat"><b id="dockDone">' + done + '</b><span>已完成</span></div></div>' +
        '<a class="now-card" href="' + rec.href + '" style="display:block;text-decoration:none;color:inherit"><span class="eyebrow">' + recLabel + '</span><b>' + rec.t + '</b><small>' + recSub + '</small></a>' +
        '<div class="eyebrow" style="display:flex;justify-content:space-between">教学目录<span style="letter-spacing:.06em;text-transform:none">已完成 ' + done + '</span></div>' +
        '<label class="search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4-4"/></svg><input id="dockSearch" type="search" placeholder="搜索目录" aria-label="搜索 ' + c.fullName + ' 目录"></label>' +
        '<ol class="route" id="dockRoute">' + c.chapters.map(function (ch, k) {
          var cls = p.map[ch.id] ? 'done' : (nextIdx === k ? 'now' : '');
          return '<li class="' + cls + '" data-t="' + ch.t + ' ' + ch.g + '"><a href="' + ch.href + '">' + ch.t + '</a></li>';
        }).join('') + (n > c.chapters.length ? '<li class="more">… 其余 ' + (n - c.chapters.length) + ' 项在课程目录中</li>' : '') + '</ol>' +
        '<div class="links"><a href="' + c.origin + '" target="_blank" rel="noopener">课程原站 ↗</a><a href="https://github.com/passwordis42/learning-hub" target="_blank" rel="noopener">GitHub ↗</a></div>';
      actions = '<a class="btn-primary" href="' + c.enter + '">登岛 · 进入课程<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg></a>' +
        '<a class="btn-ghost" href="' + (rec && rec.href || c.enter) + '">' + (done > 0 ? '继续下一课' : '直接开始第一课') + '</a>';
    } else {
      html += '<ol class="route"><li>在 <code>assets/data.js</code> 的课程列表中追加一项</li><li>给出岛屿坐标、半径与主题色</li><li>（可选）绘制岛上设施插画</li></ol>';
      actions = '<button class="btn-ghost" id="dockBack" style="flex:1">返回群岛</button>';
    }
    $('#dockBody').innerHTML = html;
    $('#dockActions').innerHTML = actions;
    var back = $('#dockBack'); if (back) back.addEventListener('click', deselect);
    var ds = $('#dockSearch');
    if (ds) ds.addEventListener('input', function () {
      var q = ds.value.trim().toLowerCase();
      [].forEach.call(document.querySelectorAll('#dockRoute li[data-t]'), function (li) { li.hidden = q && li.dataset.t.toLowerCase().indexOf(q) < 0; });
    });
    $('#dockBody').scrollTop = 0;
  }

  function select(i) {
    if (i < 0 || i >= COURSES.length || courseDisabled(COURSES[i])) return;
    var c = COURSES[i];
    var switching = sel >= 0 && sel !== i;
    if (sel === i) return;
    sel = i; dirty = true; selT = 0;
    body.classList.add('has-sel');
    $('#dock').setAttribute('aria-hidden', 'false');
    anchors.forEach(function (a, k) {
      a.classList.toggle('is-selected', k === i);
      a.classList.remove('booting');
    });
    // 重新触发“启动”动效
    void anchors[i].offsetWidth; anchors[i].classList.add('booting');
    clearTimeout(select.bt); select.bt = setTimeout(function () { anchors[i].classList.remove('booting'); }, 1600);
    // 换岛时面板内容做一次交叉淡入，而不是瞬间替换
    if (switching) {
      var card = $('#dock .panel-card');
      card.classList.add('swapping');
      clearTimeout(select.t);
      select.t = setTimeout(function () { fillDock(c); card.classList.remove('swapping'); }, 180);
    } else fillDock(c);
    flyTo(c);
    try { history.replaceState(null, '', location.pathname + location.search + '#' + c.id); } catch (e) {}
  }
  window.LH_SELECT = function (id) {
    var idx = COURSES.findIndex(function (c) { return c.id === id && !courseDisabled(c); });
    if (idx >= 0) select(idx);
  };
  /* 让被选中的岛精确落在“可视区域”的中心：
     桌面 = 屏幕正中（若会被右侧面板挡住则左移到刚好不挡）；手机 = 底部抽屉上方区域的中心 */
  function flyTo(c) {
    var W = innerWidth, H = innerHeight, mobile = W <= 760;
    var d = Math.max(c.planned ? 24 : 32, c.r * 7.6) * (W / H < 1 ? 1.35 : 1);
    var sx = W * 0.40, sy = H * 0.58;   // 略偏左于画面中心，给右侧面板留出呼吸感
    var dockEl = $('#dock');
    if (mobile) {
      var sheet = Math.min(H * 0.72, dockEl.offsetHeight || H * 0.6);
      sx = W / 2; sy = (H - sheet) * 0.62;
    } else {
      var dockLeft = W - dockEl.offsetWidth - 28;
      var T0 = { x: c.x, z: c.z, dist: d };
      var p0 = Ocean.project(T0, PITCH, W, H, c.x, 0, c.z);
      var half = p0 ? p0.scale * c.r * 1.25 : 200;
      if (sx + half > dockLeft - 16) sx = Math.max((dockLeft) / 2, dockLeft - 16 - half);
      if (H <= 560) sy = H * 0.6;
    }
    var T = { x: c.x, z: c.z, dist: d };
    for (var n = 0; n < 2; n++) {
      var w = Ocean.unproject(T, PITCH, W, H, sx, sy);
      if (!w) break;
      T.x += c.x - w.x; T.z += c.z - w.z;
    }
    camT.x = T.x; camT.z = T.z; camT.dist = d;
  }
  function deselect() {
    if (sel < 0) return;
    sel = -1; dirty = true;
    body.classList.remove('has-sel');
    $('#dock').setAttribute('aria-hidden', 'true');
    anchors.forEach(function (a) { a.classList.remove('is-selected', 'booting'); });
    var h = homeView(); camT.x = h.x; camT.z = h.z; camT.dist = h.dist;
    try { history.replaceState(null, '', location.pathname); } catch (e) {}
  }
  $('#dockClose').addEventListener('click', deselect);
  $('#btnHome').addEventListener('click', function () { if (sel >= 0) deselect(); else { var h = homeView(); camT.x = h.x; camT.z = h.z; camT.dist = h.dist; } });

  /* ---------- 拾取 ---------- */
  function pick(sx, sy) {
    var w = Ocean.unproject(cam, PITCH, innerWidth, innerHeight, sx, sy);
    if (w) {
      for (var i = 0; i < COURSES.length; i++) {
        var c = COURSES[i];
        var dx = w.x - c.x, dz = w.z - c.z;
        if (Math.sqrt(dx * dx + dz * dz) < c.r * 1.12) return i;
      }
    }
    // 也允许点在设施插画上（使用每帧缓存的屏幕包围盒，避免强制回流）
    for (var k = 0; k < anchorParts.length; k++) {
      var b = anchorParts[k].box;
      if (b && sx > b.l && sx < b.r && sy > b.t && sy < b.b) return k;
    }
    return -1;
  }

  /* ---------- 拖拽 / 缩放 / 捏合 ---------- */
  var pointers = {}, dragStart = null, moved = 0, pinch0 = 0, dist0 = 0;
  canvas.addEventListener('pointerdown', function (e) {
    canvas.setPointerCapture(e.pointerId);
    pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
    var ids = Object.keys(pointers);
    if (ids.length === 1) { dragStart = { x: e.clientX, y: e.clientY, cx: camT.x, cz: camT.z }; moved = 0; }
    if (ids.length === 2) { var a = pointers[ids[0]], b = pointers[ids[1]]; pinch0 = Math.hypot(a.x - b.x, a.y - b.y); dist0 = camT.dist; }
  });
  canvas.addEventListener('pointermove', function (e) {
    if (!pointers[e.pointerId]) {
      if (e.pointerType === 'mouse') {
        var hovered = pick(e.clientX, e.clientY);
        setHover(hovered >= 0 && courseDisabled(COURSES[hovered]) ? -1 : hovered);
      }
      return;
    }
    pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
    var ids = Object.keys(pointers);
    if (ids.length === 2) {
      var a = pointers[ids[0]], b = pointers[ids[1]];
      var d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch0 > 0) camT.dist = clampDist(dist0 * pinch0 / d);
      moved = 99; return;
    }
    if (!dragStart) return;
    moved = Math.max(moved, Math.hypot(e.clientX - dragStart.x, e.clientY - dragStart.y));
    if (moved > 5) {
      canvas.classList.add('dragging');
      var w0 = Ocean.unproject(cam, PITCH, innerWidth, innerHeight, dragStart.x, dragStart.y);
      var w1 = Ocean.unproject(cam, PITCH, innerWidth, innerHeight, e.clientX, e.clientY);
      if (w0 && w1) {
        camT.x = clampPan(dragStart.cx - (w1.x - w0.x), 34);
        camT.z = clampPan(dragStart.cz - (w1.z - w0.z), 30);
        cam.x = camT.x; cam.z = camT.z; vel.x = vel.z = 0; camMoved = true;
        // 拖拽时用新的相机重新计算起点，保证跟手
        dragStart = { x: e.clientX, y: e.clientY, cx: camT.x, cz: camT.z };
        dirty = true;
      }
    }
  });
  function endPointer(e) {
    var wasSingle = Object.keys(pointers).length === 1;
    delete pointers[e.pointerId];
    canvas.classList.remove('dragging');
    if (wasSingle && dragStart && moved <= 5) {
      var i = pick(e.clientX, e.clientY);
      if (!(i >= 0 && courseDisabled(COURSES[i]))) {
        if (i >= 0) select(i); else deselect();
      }
    }
    if (!Object.keys(pointers).length) dragStart = null;
    pinch0 = 0;
  }
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('pointerleave', function () { setHover(-1); });
  canvas.addEventListener('wheel', function (e) { e.preventDefault(); camT.dist = clampDist(camT.dist * Math.exp(e.deltaY * 0.0012)); }, { passive: false });
  function clampDist(d) { return Math.max(18, Math.min(78, d)); }
  function clampPan(v, m) { return Math.max(-m, Math.min(m, v)); }
  $('#zoomIn').addEventListener('click', function () { camT.dist = clampDist(camT.dist * 0.8); });
  $('#zoomOut').addEventListener('click', function () { camT.dist = clampDist(camT.dist * 1.25); });

  /* 降级模式下，锚点本身可点击 */
  $('#anchors').addEventListener('click', function (e) {
    if (!body.classList.contains('no-gl')) return;
    var a = e.target.closest('.anchor');
    if (!a) return;
    var i = anchors.indexOf(a);
    if (i >= 0 && courseDisabled(COURSES[i])) { e.preventDefault(); e.stopPropagation(); return; }
    select(i);
  });

  /* ---------- 键盘 ---------- */
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      if (document.querySelector('dialog[open]')) return;
      if (body.classList.contains('drawer-open')) closeDrawer();
      else if (body.classList.contains('assist-open')) requestCloseAssist();
      else if (body.classList.contains('in-course') && window.LH_ROUTE) window.LH_ROUTE(location.pathname);
      else deselect();
    }
    var step = camT.dist * 0.06;
    if (e.target.closest && e.target.closest('input,textarea')) return;
    if (e.key === 'ArrowLeft') camT.x = clampPan(camT.x - step, 34);
    if (e.key === 'ArrowRight') camT.x = clampPan(camT.x + step, 34);
    if (e.key === 'ArrowUp') camT.z = clampPan(camT.z - step, 30);
    if (e.key === 'ArrowDown') camT.z = clampPan(camT.z + step, 30);
    if (e.key === '+' || e.key === '=') camT.dist = clampDist(camT.dist * 0.85);
    if (e.key === '-') camT.dist = clampDist(camT.dist * 1.18);
  });

  /* ---------- 动态开关 / 画质 ---------- */
  function applyMotion() {
    var b = $('#btnMotion');
    b.setAttribute('aria-pressed', String(!motionOn));
    b.querySelector('.lbl').textContent = motionOn ? '暂停动态' : '继续动态';
    b.querySelector('svg').innerHTML = motionOn
      ? '<rect x="6" y="5" width="4" height="14" rx="1.2"/><rect x="14" y="5" width="4" height="14" rx="1.2"/>'
      : '<path d="M7 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L8.5 4.64A1 1 0 0 0 7 5.5z"/>';
    body.classList.toggle('motion-off', !motionOn);
    [].forEach.call(document.querySelectorAll('svg'), function (s) { if (s.pauseAnimations) { motionOn ? s.unpauseAnimations() : s.pauseAnimations(); } });
    dirty = true;
  }
  window.LH_MOTION = {
    get on() { return motionOn; },
    toggle: function () {
      motionOn = !motionOn;
      try { localStorage.setItem('lh-motion', motionOn ? 'on' : 'off'); } catch (err) {}
      applyMotion();
      toast(motionOn ? '海面恢复流动' : '已暂停全部动态，可随时继续');
    }
  };
  $('#btnMotion').addEventListener('click', function () { window.LH_MOTION.toggle(); });
  function applyQuality() {
    if (ocean) ocean.state.scale = quality === 'low' ? 0.5 : 1;
    $('#btnQuality').title = '画质：' + (quality === 'low' ? '省电' : '高');
    $('#btnQuality').setAttribute('aria-label', $('#btnQuality').title);
    $('#btnQuality').style.opacity = quality === 'low' ? .7 : 1;
    dirty = true;
  }
  $('#btnQuality').addEventListener('click', function () {
    quality = quality === 'low' ? 'high' : 'low'; localStorage.setItem('lh-quality', quality); applyQuality();
    toast(quality === 'low' ? '已切换省电画质' : '已切换高画质');
  });
  applyMotion(); applyQuality();

  var tt; function toast(s) { var t = $('#toast'); t.textContent = s; t.classList.add('show'); clearTimeout(tt); tt = setTimeout(function () { t.classList.remove('show'); }, 2200); }

  /* ---------- 主循环 ---------- */
  var time = 8, selT = 0, last = performance.now(), slowFrames = 0, camMoved = true;
  function frame(now) {
    if (document.hidden || body.classList.contains('in-course')) { last = now; requestAnimationFrame(frame); return; }
    var dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (motionOn) { time += dt; dirty = true; }
    if (sel >= 0 && motionOn) selT += dt;

    // 镜头：临界阻尼弹簧（起步柔和、收尾无回弹；中途换目标时保留速度，衔接丝滑）
    // 远距离换岛时临时拉高镜头，形成“拉远—推近”的弧线运镜
    var travel = Math.hypot(camT.x - cam.x, camT.z - cam.z);
    var distGoal = camT.dist + (dragStart ? 0 : Math.min(9, travel * 0.32));
    var moving = travel + Math.abs(cam.dist - distGoal) + Math.abs(vel.x) + Math.abs(vel.z) + Math.abs(vel.d) > 0.003;
    if (SNAP) { cam.x = camT.x; cam.z = camT.z; cam.dist = camT.dist; vel.x = vel.z = vel.d = 0; moving = false; camMoved = true; dirty = true; }
    if (moving) {
      var w = 6.2, ex = Math.exp(-w * dt);
      var e, tmp;
      e = cam.x - camT.x; tmp = (vel.x + w * e) * dt; vel.x = (vel.x - w * tmp) * ex; cam.x = camT.x + (e + tmp) * ex;
      e = cam.z - camT.z; tmp = (vel.z + w * e) * dt; vel.z = (vel.z - w * tmp) * ex; cam.z = camT.z + (e + tmp) * ex;
      e = cam.dist - distGoal; tmp = (vel.d + w * e) * dt; vel.d = (vel.d - w * tmp) * ex; cam.dist = distGoal + (e + tmp) * ex;
      dirty = true; camMoved = true;
    }
    if (dirty) {
      if (ocean) {
        var s = ocean.state;
        s.cam.x = cam.x; s.cam.z = cam.z; s.cam.dist = cam.dist;
        s.time = time; s.selT = sel >= 0 ? (motionOn ? selT : 1.0) : 0; s.sel = sel; s.hov = hov;
        ocean.render();
      }
      if (camMoved) { layoutAnchors(); camMoved = false; }
      dirty = false;
      // 自动降级：持续掉帧时降低渲染分辨率
      if (ocean && motionOn && quality === 'high') {
        if (dt > 0.034) slowFrames++; else slowFrames = Math.max(0, slowFrames - 1);
        if (slowFrames > 90) { ocean.state.scale = Math.max(0.55, ocean.state.scale - 0.15); slowFrames = 0; }
      }
    }
    requestAnimationFrame(frame);
  }

  function layoutAnchors() {
    var W = innerWidth, H = innerHeight;
    COURSES.forEach(function (c, i) {
      var p = Ocean.project(cam, PITCH, W, H, c.x, 0, c.z);
      var a = anchors[i];
      if (!p || p.x < -300 || p.x > W + 300 || p.y < -300 || p.y > H + 300) { a.style.visibility = 'hidden'; return; }
      a.style.visibility = '';
      var s = p.scale * c.r / (c.planned ? 95 : 54);
      a.style.transform = 'translate3d(' + p.x.toFixed(1) + 'px,' + p.y.toFixed(1) + 'px,0)';
      var parts = anchorParts[i];
      parts.fac.style.transform = 'scale(' + s.toFixed(4) + ')';
      parts.tag.style.transform = 'translate3d(0,' + (-142 * s).toFixed(1) + 'px,0)';
      parts.box = { l: p.x - 45 * s, r: p.x + 45 * s, t: p.y - 125 * s, b: p.y + 20 * s };
      var z = String(Math.round(1000 - p.depth));
      if (a.style.zIndex !== z) a.style.zIndex = z;
      var far = s < 0.32;
      if (a._far !== far) { a._far = far; a.classList.toggle('far', far); }    });
    // 小地图视野框
    var pts = [[0, 0], [W, 0], [W, H], [0, H]].map(function (q) { return Ocean.unproject(cam, PITCH, W, H, q[0], q[1]); });
    var v = $('#mmView');
    if (v && pts.every(Boolean)) v.setAttribute('points', pts.map(function (q) { return (q.x * 1.3).toFixed(1) + ',' + (q.z * 1.3).toFixed(1); }).join(' '));
  }

  function refreshProgress() {
    paintWelcome();
    if ($('#catSearch')) renderCatalog($('#catSearch').value);
    if (sel >= 0 && COURSES[sel] && !COURSES[sel].planned) fillDock(COURSES[sel]);
  }
  window.LH_REFRESH_PROGRESS = refreshProgress;
  addEventListener('storage', function (event) {
    if (event.key === 'learning-atlas:weekly-study' || event.key === 'learning-atlas:day-one-complete' || event.key === 'nmr-from-zero.progress.v2' || event.key === 'game-design-atlas:learning:v1') refreshProgress();
  });

  addEventListener('resize', function () { if (sel < 0) { var h = homeView(); camT.x = h.x; camT.z = h.z; camT.dist = h.dist; } else flyTo(COURSES[sel]); dirty = true; camMoved = true; });
  document.addEventListener('visibilitychange', function () { last = performance.now(); });

  // 入场：先渲染一帧再揭幕；若海景失败也照样揭幕
  requestAnimationFrame(function (n) {
    last = n; frame(n);
    var h = homeView(); camT.dist = h.dist;
    setTimeout(function () { $('#veil').classList.add('gone'); setTimeout(function () { var v = $('#veil'); if (v) v.remove(); }, 1500); }, 350);
    var m = location.hash.replace('#', '');
    var idx = COURSES.findIndex(function (c) { return c.id === m && !courseDisabled(c); });
    if (idx >= 0) setTimeout(function () { select(idx); }, 600);
    if (/demo=catalog/.test(location.search)) setTimeout(openDrawer, 400);
    /* demo=assist 不再打开配置页。 */
    if (/demo=nogl/.test(location.search)) toFallback();
    var hm = location.search.match(/demo=hover(\d)/); if (hm) setTimeout(function () { setHover(+hm[1]); }, 400);
  });
})();
