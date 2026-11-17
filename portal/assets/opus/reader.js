/* 纸面阅读壳：目录和纸面来自设计稿，正文 iframe 使用正式课程。 */
(function () {
  var shell = document.getElementById('courseShell');
  var main = document.getElementById('courseMain');
  var hub = document.getElementById('hubScene');
  if (!shell || !main) return;

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }
  function courseBy(id) {
    return (window.HUB_REAL && window.HUB_REAL.courses || []).filter(function (c) { return c.id === id; })[0];
  }
  function chapter(course, moduleId) {
    return (course.chapters || []).filter(function (ch) { return ch.id === moduleId; })[0] || course.chapters[0];
  }
  function groups(course) {
    var out = [];
    var map = {};
    (course.chapters || []).forEach(function (ch, index) {
      var name = ch.g || '目录';
      if (!map[name]) { map[name] = { name: name, items: [] }; out.push(map[name]); }
      map[name].items.push({ ch: ch, index: index });
    });
    return out;
  }
  function frameSrc(local) {
    if (!local) return '';
    var parts = String(local).split('#');
    var path = parts[0];
    var hash = parts[1] ? '#' + parts[1] : '';
    return path + (path.indexOf('?') >= 0 ? '&' : '?') + 'embed=1' + hash;
  }
  function motionOn() {
    return window.LH_MOTION ? window.LH_MOTION.on : !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  var restoreSession = null;
  function release(session) {
    if (!session || session.done) return;
    session.done = true;
    session.clean();
  }
  window.LH_RESTORE = function (top) {
    if (restoreSession) release(restoreSession);
    var session = { top: top || 0, done: false, height: -1, quiet: 0, sawFrame: false, applying: false };
    restoreSession = session;
    var cleanups = [];
    session.clean = function () { cleanups.forEach(function (fn) { fn(); }); if (restoreSession === session) restoreSession = null; };
    var frame = document.getElementById('lesson-frame');
    function apply() {
      if (session.done) return;
      var max = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
      var goal = Math.min(session.top, max);
      if (Math.abs(window.scrollY - goal) > 1) {
        session.applying = true;
        window.scrollTo({ top: goal, behavior: 'instant' });
        session.applying = false;
      }
    }
    function noteLayout() {
      if (session.done) return;
      if (document.documentElement.scrollHeight !== session.height) session.quiet = 0;
      apply();
    }
    if ('ResizeObserver' in window) {
      var observer = new ResizeObserver(noteLayout);
      observer.observe(document.documentElement);
      if (frame) observer.observe(frame);
      cleanups.push(function () { observer.disconnect(); });
    }
    document.fonts && document.fonts.addEventListener && document.fonts.addEventListener('loadingdone', noteLayout);
    document.fonts && document.fonts.ready && document.fonts.ready.then(function () { if (!session.done) noteLayout(); });
    function user(event) { if (event.isTrusted && !session.applying) release(session); }
    addEventListener('wheel', user, { passive: true });
    addEventListener('touchmove', user, { passive: true });
    function onKey(event) {
      if (!event.isTrusted || session.done) return;
      if (event.target && event.target.closest && event.target.closest('input,textarea,select,[contenteditable="true"]')) return;
      if (['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' '].indexOf(event.key) >= 0) release(session);
    }
    addEventListener('keydown', onKey);
    cleanups.push(function () {
      removeEventListener('wheel', user);
      removeEventListener('touchmove', user);
      removeEventListener('keydown', onKey);
      document.fonts && document.fonts.removeEventListener && document.fonts.removeEventListener('loadingdone', noteLayout);
    });
    function pump() {
      if (session.done) return;
      var height = document.documentElement.scrollHeight;
      var max = Math.max(0, height - window.innerHeight);
      var fontsReady = !document.fonts || document.fonts.status === 'loaded';
      var images = [].filter.call(document.querySelectorAll('#courseShell img'), function (img) { return !img.complete; });
      var shown = false;
      if (frame && frame.isConnected) {
        shown = frame.checkVisibility ? frame.checkVisibility() : frame.offsetParent !== null;
      }
      var tallEnough = max + 1 >= session.top;
      var frameReady = !frame || !frame.isConnected || tallEnough || (session.sawFrame && shown);
      if (height === session.height) session.quiet += 1; else { session.height = height; session.quiet = 0; }
      apply();
      if (fontsReady && !images.length && frameReady && session.quiet >= 2) release(session);
      else requestAnimationFrame(pump);
    }
    requestAnimationFrame(pump);
    var safety = setTimeout(function () { release(session); }, 12000);
    cleanups.push(function () { clearTimeout(safety); });
  };
  addEventListener('message', function (event) {
    if (event.origin !== location.origin || !event.data || event.data.type !== 'hub-embed-height') return;
    var frame = document.getElementById('lesson-frame');
    if (!frame || event.source !== frame.contentWindow) return;
    frame.style.height = Math.max(240, Number(event.data.height) || 0) + 'px';
    if (restoreSession && !restoreSession.done) {
      restoreSession.sawFrame = true;
      restoreSession.quiet = 0;
    }
  });

  var harbor = null;
  addEventListener('resize', function () { if (harbor) harbor.drawn = false; });
  function stopHarbor() {
    if (!harbor) return;
    harbor.stop();
    harbor = null;
  }
  function startHarbor(course) {
    stopHarbor();
    var wrap = main.querySelector('.harbor');
    if (!wrap || !window.Ocean) return;
    var canvas = wrap.querySelector('canvas');
    var ocean = Ocean.create(canvas, { pitch: 0.78, calm: true });
    if (!ocean) wrap.classList.add('harbor-fallback');
    else ocean.setIslands([{ x: course.x, z: course.z, r: course.r, seed: course.seed, tint: course.tint }]);
    var art = wrap.querySelector('.facility-art');
    var visible = true;
    var time = 10;
    var last = performance.now();
    var raf = 0;
    var io = new IntersectionObserver(function (entries) { visible = entries[0].isIntersecting; }, { threshold: 0 });
    io.observe(wrap);
    function camFor() {
      var w = wrap.clientWidth;
      var h = wrap.clientHeight;
      var ratio = w / Math.max(h, 1);
      var dist = ratio < 1 ? 30 : 22;
      return {
        x: course.x - (ratio < 1 ? 0 : dist * 0.32 * Math.min(ratio, 2.2) / 1.6),
        z: course.z + (ratio < 1 ? dist * 0.12 : 1),
        dist: dist
      };
    }
    function frame(now) {
      if (!harbor) return;
      var dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (!document.hidden && visible && (motionOn() || !harbor.drawn)) {
        if (motionOn()) time += dt;
        var cam = camFor();
        if (ocean) {
          ocean.state.cam.x = cam.x;
          ocean.state.cam.z = cam.z;
          ocean.state.cam.dist = cam.dist;
          ocean.state.time = time;
          ocean.state.sel = -1;
          ocean.render();
        }
        var projected = Ocean.project(cam, 0.78, wrap.clientWidth, wrap.clientHeight, course.x, 0, course.z);
        if (projected && art) {
          art.style.left = projected.x + 'px';
          art.style.top = projected.y + 'px';
          art.style.width = (projected.scale * course.r * 2.3) + 'px';
        }
        harbor.drawn = true;
      }
      raf = requestAnimationFrame(frame);
    }
    harbor = { drawn: false, stop: function () { cancelAnimationFrame(raf); io.disconnect(); } };
    raf = requestAnimationFrame(frame);
  }

  var TOOLS = {
    ai: [['图谱总览', 'ai/#map'], ['第一天', 'ai/#day-1'], ['AI 学伴', 'ai/#tutor']],
    nmr: [['第 1 节', 'nmr-from-zero/#/learn/1-1'], ['波的实验', 'nmr-from-zero/#/labs/waves']],
    game: [['第 1 周', 'game/#plan/01'], ['设计助手', 'game/#coach']]
  };

  function lessonLink(ch, current) {
    var currentAttr = current && ch.id === current.id ? ' aria-current="page"' : '';
    var cls = current && ch.id === current.id ? ' class="now"' : '';
    return '<li' + cls + ' data-t="' + esc(ch.t + ' ' + ch.g) + '"><a href="' + esc(ch.href) + '" data-lesson-module="' + esc(ch.id) + '"' + currentAttr + '>' + esc(ch.t) + '</a></li>';
  }
  function switcher(course) {
    document.getElementById('switcher').innerHTML = (window.HUB_REAL.courses || []).map(function (item) {
      var shortName = item.name || item.code;
      return '<a data-course="' + esc(item.id) + '" href="' + esc(item.href) + '" style="--c:' + esc(item.accent) + '"' + (item.id === course.id ? ' aria-current="page"' : '') + ' title="' + esc(item.fullName) + '"><i>' + esc(item.code) + '</i><span>' + esc(shortName) + '</span></a>';
    }).join('');
  }
  function paintBack(course, toDirectory) {
    var back = document.getElementById('backLink');
    if (!back) return;
    if (toDirectory) {
      back.href = course.href;
      var label = back.querySelector('.lbl');
      if (label) label.textContent = '课程目录';
      back.onclick = function (event) {
        event.preventDefault();
        window.LH_ROUTE(course.href);
      };
    } else {
      back.href = location.pathname + '#' + course.id;
      var homeLabel = back.querySelector('.lbl');
      if (homeLabel) homeLabel.textContent = '返回群岛';
      back.onclick = function (event) {
        event.preventDefault();
        window.LH_ROUTE(location.pathname + '#' + course.id);
      };
    }
  }

  function showDirectory(course) {
    stopHarbor();
    document.title = course.fullName + ' · 学习入口';
    switcher(course);
    paintBack(course, false);
    var tocBtn = document.getElementById('btnToc');
    if (tocBtn) tocBtn.hidden = true;
    document.body.classList.remove('toc-open');
    var tools = TOOLS[course.id] || [];
    main.innerHTML =
      '<section class="harbor" style="--accent:' + esc(course.accent) + '" aria-label="' + esc(course.facility) + '海景">' +
        '<canvas aria-hidden="true"></canvas><div class="fallback"></div>' +
        '<div class="facility-art">' + (window.HUB.ART[course.id] || '') + '</div>' +
        '<div class="harbor-title"><div class="eyebrow"><i></i>' + esc(course.facility) + ' · ' + esc(course.unitsLabel) + '</div><h1>' + esc(course.fullName) + '</h1><p>' + esc(course.tagline) + '</p></div>' +
      '</section>' +
      '<div class="chart"><div class="chart-sheet">' +
        '<div class="chart-head"><div class="voyage">' +
          '<div><b>' + course.chapters.length + '</b><span>目录条目</span></div>' +
          '<div><b>课内</b><span>进度保存在各课自己的记录里</span></div>' +
        '</div><div class="chart-actions">' +
          (course.chapters[0] ? '<a class="btn-primary" href="' + esc(course.chapters[0].href) + '">从第一节开始</a>' : '') +
          '<a class="btn-ghost" href="' + esc(course.origin) + '">在独立页面打开</a>' +
        '</div></div>' +
        '<div class="tools"><span class="lbl">原课程入口</span>' + tools.map(function (tool) {
          return '<a class="tool" href="' + esc(tool[1]) + '">' + esc(tool[0]) + '</a>';
        }).join('') + '</div>' +
        '<div class="dir-search"><label class="search"><input id="dirSearch" type="search" placeholder="搜索本课程目录" aria-label="搜索本课程目录"></label></div>' +
        '<div class="stages">' + groups(course).map(function (group) {
          return '<section class="stage"><h3>' + esc(group.name) + '<small>' + group.items.length + ' 项</small></h3><ol class="lessons">' +
            group.items.map(function (item) { return lessonLink(item.ch, null); }).join('') + '</ol></section>';
        }).join('') + '</div>' +
        '<p class="data-row">这里只排列正式目录。正文、公式、实验、小测和进度仍在原来的课程页面里。</p>' +
      '</div></div>';
    var search = document.getElementById('dirSearch');
    if (search) search.addEventListener('input', function () {
      var query = search.value.trim().toLowerCase();
      [].forEach.call(main.querySelectorAll('.lessons li'), function (item) {
        item.hidden = Boolean(query) && item.dataset.t.toLowerCase().indexOf(query) < 0;
      });
      [].forEach.call(main.querySelectorAll('.stage'), function (stage) {
        stage.hidden = !stage.querySelector('li:not([hidden])');
      });
    });
    document.getElementById('tideBar').style.width = '0%';
    document.getElementById('topbar').classList.remove('solid');
    startHarbor(course);
    window.scrollTo(0, 0);
  }

  function showReader(course, moduleId) {
    stopHarbor();
    var current = chapter(course, moduleId);
    if (!current) { showDirectory(course); return; }
    document.title = current.t + ' · 学习入口';
    switcher(course);
    paintBack(course, true);
    var tocBtn = document.getElementById('btnToc');
    if (tocBtn) { tocBtn.hidden = false; tocBtn.setAttribute('aria-expanded', 'false'); }
    document.body.classList.remove('toc-open');
    var index = course.chapters.indexOf(current);
    var prev = course.chapters[index - 1];
    var next = course.chapters[index + 1];
    var wave = '<svg class="wave-rule" viewBox="0 0 600 14" preserveAspectRatio="none" aria-hidden="true"><path d="M0 7 Q 15 0 30 7 T 60 7 T 90 7 T 120 7 T 150 7 T 180 7 T 210 7 T 240 7 T 270 7 T 300 7 T 330 7 T 360 7 T 390 7 T 420 7 T 450 7 T 480 7 T 510 7 T 540 7 T 570 7 T 600 7" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>';
    main.innerHTML =
      '<div class="reader" style="--accent:' + esc(course.accent) + '">' +
        '<aside class="toc learning-sidebar" id="lesson-nav" aria-label="课程目录">' +
          '<div class="toc-head"><span class="badge">' + esc(course.code) + '</span><span><b>' + esc(course.fullName) + '</b><small>' + course.chapters.length + ' 项</small></span></div>' +
          '<label class="search"><input id="tocSearch" type="search" placeholder="搜索课程与概念" aria-label="搜索课程与概念"></label>' +
          groups(course).map(function (group) {
            return '<div class="toc-group"><h4>' + esc(group.name) + '</h4><ol class="lessons">' +
              group.items.map(function (item) { return lessonLink(item.ch, current); }).join('') + '</ol></div>';
          }).join('') +
        '</aside><div class="toc-scrim" id="tocScrim"></div>' +
        '<article class="lesson lesson-article">' +
          '<header class="lesson-head"><div class="crumbs"><a data-hub-route href="' + esc(location.pathname + '#' + course.id) + '">群岛</a><span>›</span><a href="' + esc(course.href) + '">' + esc(course.fullName) + '</a><span>›</span><span>' + esc(current.g) + '</span></div>' +
          '<h1 id="lt">' + esc(current.t) + '</h1>' +
          '<div class="meta"><span class="pill accent">' + esc(course.facility) + '</span><span class="pill">' + esc(current.g) + '</span><span class="pill">正式课程</span></div></header>' +
          wave +
          '<iframe id="lesson-frame" class="lesson-embed" title="' + esc(current.t) + '" src="' + esc(frameSrc(current.local)) + '"></iframe>' +
          '<nav class="pager" aria-label="上一节 / 下一节">' +
            (prev ? '<a class="prev" href="' + esc(prev.href) + '"><small>上一节</small><b>' + esc(prev.t) + '</b></a>' : '<span></span>') +
            (next ? '<a class="next" href="' + esc(next.href) + '"><small>下一节</small><b>' + esc(next.t) + '</b></a>' : '<a class="next" href="' + esc(course.href) + '"><small>回到</small><b>课程目录</b></a>') +
          '</nav>' +
        '</article>' +
        '<aside class="rail" aria-label="本课工具">' +
          '<div class="box"><h4>这一节</h4><p>正文、公式、实验和小测在左侧纸面里的正式课程中，不使用设计稿示例。</p></div>' +
          '<div class="box"><h4>阅读字号</h4><div class="fs-ctl"><button id="fsDown" type="button" aria-label="缩小纸面字号">A−</button><button id="fsUp" type="button" aria-label="放大纸面字号">A+</button></div><p>这只改变纸面标题字号，不是浏览器缩放。</p></div>' +
          '<div class="box"><h4>原课程</h4><a class="mini" href="' + esc(course.origin) + '">在独立页面打开</a></div>' +
        '</aside></div>';
    var search = document.getElementById('tocSearch');
    if (search) search.addEventListener('input', function () {
      var query = search.value.trim().toLowerCase();
      [].forEach.call(main.querySelectorAll('.toc .lessons li'), function (item) {
        item.hidden = Boolean(query) && item.dataset.t.toLowerCase().indexOf(query) < 0;
      });
    });
    var scrim = document.getElementById('tocScrim');
    if (scrim) scrim.addEventListener('click', function () {
      document.body.classList.remove('toc-open');
      if (tocBtn) tocBtn.setAttribute('aria-expanded', 'false');
    });
    function setFs(delta) {
      var currentSize = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--fs'), 10) || 18;
      var next = Math.max(15, Math.min(24, currentSize + delta));
      document.documentElement.style.setProperty('--fs', next + 'px');
      try { localStorage.setItem('lh-fs', String(next)); } catch (err) {}
    }
    var down = document.getElementById('fsDown');
    var up = document.getElementById('fsUp');
    if (down) down.addEventListener('click', function () { setFs(-1); });
    if (up) up.addEventListener('click', function () { setFs(1); });
    document.getElementById('topbar').classList.add('solid');
    document.getElementById('tideBar').style.width = '0%';
    window.scrollTo(0, 0);
  }

  function show(courseId, moduleId) {
    var course = courseBy(courseId) || courseBy('ai');
    if (!course) return;
    document.body.classList.add('in-course', 'course');
    shell.hidden = false;
    if (hub) hub.hidden = false;
    if (moduleId) showReader(course, moduleId);
    else showDirectory(course);
    if (!document.body.classList.contains('assist-open')) document.body.dataset.view = 'reader';
  }

  function render() {
    var query = new URLSearchParams(location.search);
    if (query.get('view') === 'reader') show(query.get('course'), query.get('module'));
    else {
      stopHarbor();
      document.body.classList.remove('in-course', 'course', 'toc-open');
      shell.hidden = true;
      main.innerHTML = '';
      document.title = '学习入口 · 群岛';
      if (!document.body.classList.contains('assist-open')) document.body.dataset.view = 'hub';
      var id = location.hash.replace('#', '');
      if (id && window.LH_SELECT) window.LH_SELECT(id);
      window.dispatchEvent(new Event('resize'));
    }
  }
  window.LH_ROUTE = function (href) {
    var url = new URL(href, location.href);
    history.pushState(null, '', url.pathname + url.search + url.hash);
    render();
  };
  window.LH_RENDER = render;
  addEventListener('popstate', render);
  addEventListener('click', function (event) {
    var link = event.target.closest && event.target.closest('a[data-hub-route]');
    if (!link || event.metaKey || event.ctrlKey || event.shiftKey || event.button) return;
    event.preventDefault();
    window.LH_ROUTE(link.getAttribute('href'));
  });
  addEventListener('scroll', function () {
    var bar = document.getElementById('topbar');
    var tide = document.getElementById('tideBar');
    if (!bar || !document.body.classList.contains('in-course')) return;
    var reading = Boolean(main.querySelector('.reader'));
    bar.classList.toggle('solid', window.scrollY > 30 || reading);
    if (reading && tide) {
      var height = document.documentElement.scrollHeight - window.innerHeight;
      tide.style.width = (height > 0 ? window.scrollY / height * 100 : 0) + '%';
    }
  }, { passive: true });
  var tocButton = document.getElementById('btnToc');
  if (tocButton) tocButton.addEventListener('click', function () {
    document.body.classList.toggle('toc-open');
    this.setAttribute('aria-expanded', String(document.body.classList.contains('toc-open')));
  });
  var themeButton = document.getElementById('btnTheme');
  if (themeButton) themeButton.addEventListener('click', function () {
    var next = document.documentElement.dataset.theme === 'night' ? 'sand' : 'night';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('lh-theme', next); } catch (err) {}
  });
  var motionButton = document.getElementById('btnCourseMotion');
  function paintCourseMotion() {
    if (!motionButton) return;
    var on = motionOn();
    motionButton.setAttribute('aria-pressed', String(!on));
    motionButton.setAttribute('aria-label', on ? '暂停动态' : '继续动态');
  }
  if (motionButton) motionButton.addEventListener('click', function () {
    if (window.LH_MOTION) window.LH_MOTION.toggle();
    paintCourseMotion();
  });
  paintCourseMotion();
  try {
    var storedSize = localStorage.getItem('lh-fs');
    if (storedSize) document.documentElement.style.setProperty('--fs', storedSize + 'px');
  } catch (err) {}
  render();
})();
