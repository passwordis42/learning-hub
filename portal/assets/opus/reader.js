/* 课程目录与纸面学习工作台：统一海图视觉与正式课程内嵌体验。 */
(function () {
  var shell = document.getElementById('courseShell');
  var main = document.getElementById('courseMain');
  var hub = document.getElementById('hubScene');
  if (!shell || !main) return;

  var activeCourse = null;
  var activeChapter = null;

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
  function currentTheme() {
    return document.documentElement.dataset.theme === 'night' ? 'night' : 'sand';
  }
  function clampReading(value) {
    var size = parseInt(value, 10);
    if (!size) return 18;
    return Math.max(15, Math.min(24, size));
  }
  function currentReading() {
    return clampReading(getComputedStyle(document.documentElement).getPropertyValue('--fs'));
  }
  function frameSrc(local, course) {
    if (!local) return '';
    var parts = String(local).split('#');
    var path = parts[0];
    var hash = parts[1] ? '#' + parts[1] : '';
    var accent = course && course.accent ? encodeURIComponent(course.accent) : '';
    var params = 'embed=1&theme=' + encodeURIComponent(currentTheme()) + '&fs=' + currentReading() + (accent ? '&accent=' + accent : '');
    return path + (path.indexOf('?') >= 0 ? '&' : '?') + params + hash;
  }
  function motionOn() {
    return window.LH_MOTION ? window.LH_MOTION.on : !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }
  function updateFsBadge(px) {
    var badge = document.getElementById('fsVal');
    if (badge) badge.textContent = px + 'px';
  }
  function publishReading(px) {
    var next = clampReading(px);
    document.documentElement.style.setProperty('--fs', next + 'px');
    updateFsBadge(next);
    try { localStorage.setItem('lh-fs', String(next)); } catch (err) {}
    var frame = document.getElementById('lesson-frame');
    if (frame && frame.contentWindow && frame.contentWindow !== window) {
      frame.contentWindow.postMessage({ type: 'hub-reading-size', px: next }, location.origin);
    }
    return next;
  }
  function publishTheme() {
    var frame = document.getElementById('lesson-frame');
    if (frame && frame.contentWindow && frame.contentWindow !== window) {
      frame.contentWindow.postMessage({
        type: 'hub-theme',
        theme: currentTheme(),
        accent: activeCourse && activeCourse.accent ? activeCourse.accent : '#2bb3a3'
      }, location.origin);
    }
  }

  function doneMap(course) {
    if (!window.HUB_PROGRESS || !course) return {};
    return window.HUB_PROGRESS.present(course.id, (course.chapters || []).map(function (ch) { return ch.id; }));
  }
  function recommendChapter(course, done) {
    var chapters = course.chapters || [];
    if (!chapters.length) return null;
    var startIdx = 0;
    chapters.forEach(function (ch, idx) {
      if (course.firstStudyId && ch.id === course.firstStudyId) startIdx = idx;
    });
    for (var i = startIdx; i < chapters.length; i++) {
      var item = chapters[i];
      if (!done[item.id] && item.id !== 'ai-tutor' && item.id !== 'game-coach' && item.kind !== 'document') {
        return item;
      }
    }
    return chapters[startIdx] || chapters[0];
  }
  function normalizeEmbedHash(rawHash) {
    var h = String(rawHash || '').trim();
    if (!h) return '';
    var qIdx = h.indexOf('?');
    if (qIdx >= 0) h = h.slice(0, qIdx);
    return h.replace(/\/+$/, '');
  }
  function findChapterByHash(course, rawHash) {
    if (!course || !rawHash) return null;
    var clean = normalizeEmbedHash(rawHash);
    if (!clean) return null;
    var chapters = course.chapters || [];
    for (var i = 0; i < chapters.length; i++) {
      var parts = String(chapters[i].local || '').split('#');
      var chHash = parts[1] ? normalizeEmbedHash('#' + parts[1]) : '';
      if (chHash && chHash === clean) return chapters[i];
    }
    if (course.id === 'game' && /^#coach(\/|$)/.test(clean)) {
      return chapters.filter(function (ch) { return ch.id === 'game-coach'; })[0] || null;
    }
    return null;
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
      if (frame && frame.isConnected && !frame.hidden) {
        shown = frame.checkVisibility ? frame.checkVisibility() : frame.offsetParent !== null;
      }
      var tallEnough = max + 1 >= session.top;
      var frameReady = !frame || !frame.isConnected || frame.hidden || tallEnough || (session.sawFrame && shown);
      if (height === session.height) session.quiet += 1; else { session.height = height; session.quiet = 0; }
      apply();
      if (fontsReady && !images.length && frameReady && session.quiet >= 2) release(session);
      else requestAnimationFrame(pump);
    }
    requestAnimationFrame(pump);
    var safety = setTimeout(function () { release(session); }, 12000);
    cleanups.push(function () { clearTimeout(safety); });
  };

  function renderPagerHtml(course, current) {
    var index = course.chapters.indexOf(current);
    var prev = course.chapters[index - 1];
    var next = course.chapters[index + 1];
    return (
      (prev ? '<a class="prev" href="' + esc(prev.href) + '"><small>← 上一节 · ' + esc(prev.g) + '</small><b>' + esc(prev.t) + '</b></a>' : '<span class="pager-empty"></span>') +
      (next ? '<a class="next" href="' + esc(next.href) + '"><small>下一节 · ' + esc(next.g) + ' →</small><b>' + esc(next.t) + '</b></a>' : '<a class="next" href="' + esc(course.href) + '"><small>本课目录已到末尾</small><b>返回课程总目录 →</b></a>')
    );
  }

  function refreshLiveProgress() {
    if (!activeCourse || !main.querySelector('.reader')) return;
    var done = doneMap(activeCourse);
    var doneCount = Object.keys(done).length;
    var summary = document.getElementById('tocDoneSummary');
    if (summary) summary.textContent = '已完成 ' + doneCount + ' / ' + activeCourse.chapters.length;
    var fill = document.getElementById('tocMeterFill');
    if (fill) fill.style.width = (activeCourse.chapters.length ? Math.round(doneCount / activeCourse.chapters.length * 100) : 0) + '%';
    [].forEach.call(main.querySelectorAll('.toc .lessons a[data-lesson-module]'), function (a) {
      var id = a.getAttribute('data-lesson-module');
      var li = a.parentElement;
      if (!li) return;
      li.classList.toggle('done', Boolean(done[id]));
      var isNow = Boolean(activeChapter && activeChapter.id === id);
      li.classList.toggle('now', isNow);
      if (isNow) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    var donePill = document.getElementById('lessonDonePill');
    if (donePill && activeChapter) {
      donePill.hidden = !done[activeChapter.id];
    }
  }

  function syncActiveChapterInPlace(nextChapter) {
    if (!activeCourse || !nextChapter || (activeChapter && activeChapter.id === nextChapter.id)) {
      refreshLiveProgress();
      return;
    }
    activeChapter = nextChapter;
    document.title = nextChapter.t + ' · 学习入口';
    var titleEl = document.getElementById('lt');
    if (titleEl) titleEl.textContent = nextChapter.t;
    var frame = document.getElementById('lesson-frame');
    if (frame) frame.title = nextChapter.t;
    var crumbGroup = document.getElementById('crumbGroup');
    if (crumbGroup) crumbGroup.textContent = nextChapter.g;
    var groupPill = document.getElementById('lessonGroupPill');
    if (groupPill) groupPill.textContent = nextChapter.g;
    var posPill = document.getElementById('lessonPosPill');
    if (posPill) {
      var idx = activeCourse.chapters.indexOf(nextChapter);
      posPill.textContent = '目录 ' + (idx + 1) + ' / ' + activeCourse.chapters.length;
    }
    var extLink = document.getElementById('lessonStandaloneLink');
    if (extLink) extLink.href = nextChapter.local || activeCourse.origin;
    var pager = main.querySelector('nav.pager');
    if (pager) pager.innerHTML = renderPagerHtml(activeCourse, nextChapter);
    refreshLiveProgress();
    var nowLink = main.querySelector('.toc .lessons li.now');
    if (nowLink && nowLink.scrollIntoView) {
      nowLink.scrollIntoView({ block: 'nearest' });
    }
    try { history.replaceState(null, '', nextChapter.href); } catch (err) {}
    if (!restoreSession && window.scrollY > 180) {
      window.scrollTo({ top: 0, behavior: motionOn() ? 'smooth' : 'auto' });
    }
  }

  addEventListener('message', function (event) {
    if (event.origin !== location.origin || !event.data) return;
    var frame = document.getElementById('lesson-frame');
    if (!frame || event.source !== frame.contentWindow) return;
    if (event.data.type === 'hub-embed-height') {
      frame.style.height = Math.max(760, Number(event.data.height) || 0) + 'px';
      if (restoreSession && !restoreSession.done) {
        restoreSession.sawFrame = true;
        restoreSession.quiet = 0;
      }
      refreshLiveProgress();
    } else if (event.data.type === 'hub-embed-route') {
      var matched = findChapterByHash(activeCourse, event.data.hash);
      if (matched) syncActiveChapterInPlace(matched);
      else refreshLiveProgress();
    } else if (event.data.type === 'hub-embed-scroll-top') {
      if (!restoreSession && !document.body.classList.contains('assist-open')) {
        var head = main.querySelector('.lesson-article');
        var targetTop = head ? Math.max(0, head.getBoundingClientRect().top + window.scrollY - 76) : 0;
        if (window.scrollY > targetTop + 140) {
          window.scrollTo({ top: targetTop, behavior: motionOn() ? 'smooth' : 'auto' });
        }
      }
    } else if (event.data.type === 'hub-embed-progress') {
      refreshLiveProgress();
    }
  });
  addEventListener('storage', function () {
    refreshLiveProgress();
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

  var QUICK_ENTRIES = {
    ai: [['图谱总览', 'ai-map'], ['第一天起步', 'ai-day1'], ['AI 学伴', 'ai-tutor']],
    nmr: [['学习路线', 'nmr-path'], ['1-1 第一课', 'nmr-1-1'], ['波的实验台', 'nmr-lab-waves'], ['硬件工坊', 'nmr-build']],
    game: [['知识图谱', 'game-graph'], ['第 01 周', 'game-w01'], ['AI 学习工坊', 'game-coach']]
  };

  function lessonLink(ch, current, done) {
    var classes = [];
    if (current && ch.id === current.id) classes.push('now');
    if (done && done[ch.id]) classes.push('done');
    var currentAttr = current && ch.id === current.id ? ' aria-current="page"' : '';
    var cls = classes.length ? ' class="' + classes.join(' ') + '"' : '';
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

  function renderMarkdownHtml(mdText) {
    var lines = String(mdText || '').replace(/\r/g, '').split('\n');
    var out = [];
    var inCode = false;
    var codeLines = [];
    var listItems = [];
    function flushList() {
      if (!listItems.length) return;
      out.push('<ul>' + listItems.map(function (item) { return '<li>' + item + '</li>'; }).join('') + '</ul>');
      listItems = [];
    }
    function inlineFmt(text) {
      return esc(text)
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    }
    lines.forEach(function (line) {
      if (/^```/.test(line.trim())) {
        flushList();
        if (inCode) {
          out.push('<pre><code>' + esc(codeLines.join('\n')) + '</code></pre>');
          codeLines = [];
          inCode = false;
        } else {
          inCode = true;
        }
        return;
      }
      if (inCode) {
        codeLines.push(line);
        return;
      }
      var trimmed = line.trim();
      if (!trimmed) {
        flushList();
        return;
      }
      if (/^#\s+/.test(trimmed)) {
        flushList();
        return;
      }
      if (/^##\s+/.test(trimmed)) {
        flushList();
        out.push('<h2>' + inlineFmt(trimmed.replace(/^##\s+/, '')) + '</h2>');
        return;
      }
      if (/^###\s+/.test(trimmed)) {
        flushList();
        out.push('<h3>' + inlineFmt(trimmed.replace(/^###\s+/, '')) + '</h3>');
        return;
      }
      if (/^[-*]\s+/.test(trimmed) || /^\d+\.\s+/.test(trimmed)) {
        listItems.push(inlineFmt(trimmed.replace(/^([-*]|\d+\.)\s+/, '')));
        return;
      }
      flushList();
      out.push('<p>' + inlineFmt(trimmed) + '</p>');
    });
    flushList();
    if (codeLines.length) out.push('<pre><code>' + esc(codeLines.join('\n')) + '</code></pre>');
    return out.join('');
  }

  function showDirectory(course) {
    stopHarbor();
    activeCourse = course;
    activeChapter = null;
    document.title = course.fullName + ' · 学习入口';
    switcher(course);
    paintBack(course, false);
    var tocBtn = document.getElementById('btnToc');
    if (tocBtn) tocBtn.hidden = true;
    document.body.classList.remove('toc-open');
    var done = doneMap(course);
    var doneCount = Object.keys(done).length;
    var rec = recommendChapter(course, done);
    var quickList = (QUICK_ENTRIES[course.id] || []).map(function (pair) {
      var target = chapter(course, pair[1]);
      return target ? '<a class="tool" href="' + esc(target.href) + '">' + esc(pair[0]) + '</a>' : '';
    }).join('');
    var stepsHtml = (course.guideSteps || []).map(function (step, idx) {
      return '<li><i>' + (idx + 1) + '</i><span>' + esc(step) + '</span></li>';
    }).join('');
    var primaryLabel = doneCount > 0 ? '继续学习下一节' : '从第一课开始';
    main.innerHTML =
      '<section class="harbor" style="--accent:' + esc(course.accent) + '" aria-label="' + esc(course.facility) + '海景">' +
        '<canvas aria-hidden="true"></canvas><div class="fallback"></div>' +
        '<div class="facility-art">' + (window.HUB.ART[course.id] || '') + '</div>' +
        '<div class="harbor-title"><div class="eyebrow"><i></i>' + esc(course.facility) + ' · ' + esc(course.unitsLabel) + '</div><h1>' + esc(course.fullName) + '</h1><p>' + esc(course.tagline) + '</p></div>' +
      '</section>' +
      '<div class="chart" style="--accent:' + esc(course.accent) + '"><div class="chart-sheet">' +
        '<div class="chart-head"><div class="voyage">' +
          '<div><b>' + course.chapters.length + '</b><span>目录条目</span></div>' +
          '<div><b id="dirDone">' + doneCount + '</b><span>已完成</span></div>' +
          (rec ? '<div class="voyage-next"><span>' + (doneCount > 0 ? '推荐继续' : '建议起点') + '</span><strong>' + esc(rec.t) + '</strong></div>' : '') +
        '</div><div class="chart-actions">' +
          (rec ? '<a class="btn-primary" href="' + esc(rec.href) + '">' + primaryLabel + ' →</a>' : '') +
          '<a class="btn-ghost" href="' + esc(course.origin) + '">独立页面打开 ↗</a>' +
        '</div></div>' +
        (stepsHtml ? '<div class="dir-onboarding"><span class="dir-onboarding-kicker">学习路径建议</span><ol>' + stepsHtml + '</ol></div>' : '') +
        '<div class="tools"><span class="lbl">快捷直达</span>' + quickList + '</div>' +
        '<div class="dir-search"><label class="search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4-4"/></svg><input id="dirSearch" type="search" placeholder="搜索本课程章节与主题…" aria-label="搜索本课程目录"></label></div>' +
        '<div class="stages">' + groups(course).map(function (group) {
          var groupDone = group.items.filter(function (item) { return Boolean(done[item.ch.id]); }).length;
          var badge = groupDone > 0 ? ('已完成 ' + groupDone + ' / ' + group.items.length) : (group.items.length + ' 项');
          return '<section class="stage"><h3>' + esc(group.name) + '<small>' + esc(badge) + '</small></h3><ol class="lessons">' +
            group.items.map(function (item) { return lessonLink(item.ch, rec, done); }).join('') + '</ol></section>';
        }).join('') + '</div>' +
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
    activeCourse = course;
    activeChapter = current;
    document.title = current.t + ' · 学习入口';
    switcher(course);
    paintBack(course, true);
    var tocBtn = document.getElementById('btnToc');
    if (tocBtn) { tocBtn.hidden = false; tocBtn.setAttribute('aria-expanded', 'false'); }
    document.body.classList.remove('toc-open');
    var done = doneMap(course);
    var doneCount = Object.keys(done).length;
    var index = course.chapters.indexOf(current);
    var pct = course.chapters.length ? Math.round(doneCount / course.chapters.length * 100) : 0;
    var isDoc = current.kind === 'document';
    var fsNow = currentReading();
    var wave = '<svg class="wave-rule" viewBox="0 0 600 14" preserveAspectRatio="none" aria-hidden="true"><path d="M0 7 Q 15 0 30 7 T 60 7 T 90 7 T 120 7 T 150 7 T 180 7 T 210 7 T 240 7 T 270 7 T 300 7 T 330 7 T 360 7 T 390 7 T 420 7 T 450 7 T 480 7 T 510 7 T 540 7 T 570 7 T 600 7" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>';
    main.innerHTML =
      '<div class="reader" style="--accent:' + esc(course.accent) + '">' +
        '<aside class="toc learning-sidebar" id="lesson-nav" aria-label="课程目录">' +
          '<div class="toc-head"><span class="badge">' + esc(course.code) + '</span><span class="toc-head-copy"><b>' + esc(course.fullName) + '</b><small id="tocDoneSummary">已完成 ' + doneCount + ' / ' + course.chapters.length + '</small></span></div>' +
          '<div class="toc-meter" aria-hidden="true"><i id="tocMeterFill" style="width:' + pct + '%"></i></div>' +
          '<label class="search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4-4"/></svg><input id="tocSearch" type="search" placeholder="筛选目录章节…" aria-label="搜索课程与概念"></label>' +
          '<div class="toc-groups">' + groups(course).map(function (group) {
            return '<details class="toc-group" open><summary>' + esc(group.name) + '<small>' + group.items.length + '</small></summary><ol class="lessons">' +
              group.items.map(function (item) { return lessonLink(item.ch, current, done); }).join('') + '</ol></details>';
          }).join('') + '</div>' +
        '</aside><div class="toc-scrim" id="tocScrim"></div>' +
        '<article class="lesson lesson-article">' +
          '<header class="lesson-head">' +
            '<div class="lesson-bar">' +
              '<div class="crumbs"><a data-hub-route href="' + esc(location.pathname + '#' + course.id) + '">群岛</a><span>›</span><a href="' + esc(course.href) + '">' + esc(course.fullName) + '</a><span>›</span><span id="crumbGroup">' + esc(current.g) + '</span></div>' +
              '<div class="lesson-tools">' +
                '<span class="fs-ctl" role="group" aria-label="阅读字号"><button id="fsDown" type="button" aria-label="缩小阅读字号">A−</button><span class="fs-val" id="fsVal" aria-hidden="true">' + fsNow + 'px</span><button id="fsUp" type="button" aria-label="放大阅读字号">A+</button></span>' +
                '<a class="standalone-link" id="lessonStandaloneLink" href="' + esc(current.local || course.origin) + '" title="在独立课程页打开当前章节">独立打开 ↗</a>' +
              '</div>' +
            '</div>' +
            '<h1 id="lt">' + esc(current.t) + '</h1>' +
            '<div class="meta">' +
              '<span class="pill accent">' + esc(course.facility) + '</span>' +
              '<span class="pill" id="lessonGroupPill">' + esc(current.g) + '</span>' +
              '<span class="pill" id="lessonPosPill">目录 ' + (index + 1) + ' / ' + course.chapters.length + '</span>' +
              '<span class="pill done-pill" id="lessonDonePill"' + (done[current.id] ? '' : ' hidden') + '>✓ 已完成</span>' +
            '</div>' +
            '<p class="reading-size-note">字号调节作用于课程正文，公式与图表保持原有比例。</p>' +
          '</header>' +
          wave +
          (isDoc ? '<div id="doc-reader" class="doc-sheet prose"><p>正在加载文档…</p></div>' : '') +
          '<iframe id="lesson-frame" class="lesson-embed"' + (isDoc ? ' hidden' : '') + ' title="' + esc(current.t) + '" src="' + (isDoc ? 'about:blank' : esc(frameSrc(current.local, course))) + '"></iframe>' +
          '<div class="pager-wrap">' +
            '<div class="pager-caption"><span>章节切换</span><small>上方为本节课程互动区，完成后可在此切换上 / 下一节</small></div>' +
            '<nav class="pager" aria-label="上一节 / 下一节">' + renderPagerHtml(course, current) + '</nav>' +
          '</div>' +
        '</article></div>';
    var search = document.getElementById('tocSearch');
    if (search) search.addEventListener('input', function () {
      var query = search.value.trim().toLowerCase();
      [].forEach.call(main.querySelectorAll('.toc .lessons li'), function (item) {
        item.hidden = Boolean(query) && item.dataset.t.toLowerCase().indexOf(query) < 0;
      });
      [].forEach.call(main.querySelectorAll('.toc-group'), function (group) {
        var hasVisible = Boolean(group.querySelector('li:not([hidden])'));
        group.hidden = !hasVisible;
        if (query && hasVisible) group.open = true;
      });
    });
    var scrim = document.getElementById('tocScrim');
    if (scrim) scrim.addEventListener('click', function () {
      document.body.classList.remove('toc-open');
      if (tocBtn) tocBtn.setAttribute('aria-expanded', 'false');
    });
    var nowItem = main.querySelector('.toc .lessons li.now');
    if (nowItem && nowItem.scrollIntoView) {
      requestAnimationFrame(function () { nowItem.scrollIntoView({ block: 'nearest' }); });
    }
    function setFs(delta) { publishReading(currentReading() + delta); }
    var frameEl = document.getElementById('lesson-frame');
    if (frameEl && !isDoc) {
      frameEl.addEventListener('load', function () {
        publishTheme();
        publishReading(currentReading());
      });
    }
    if (isDoc && current.local) {
      fetch(current.local).then(function (res) { return res.ok ? res.text() : Promise.reject(new Error(String(res.status))); }).then(function (md) {
        var box = document.getElementById('doc-reader');
        if (box) box.innerHTML = renderMarkdownHtml(md);
      }).catch(function () {
        var box = document.getElementById('doc-reader');
        if (box) box.innerHTML = '<p>无法加载文档，可点击右上角「独立打开」查看原文。</p>';
      });
    }
    var down = document.getElementById('fsDown');
    var up = document.getElementById('fsUp');
    if (down) down.addEventListener('click', function () { setFs(-1); });
    if (up) up.addEventListener('click', function () { setFs(1); });
    document.getElementById('topbar').classList.add('solid');
    document.getElementById('tideBar').style.width = '0%';
    window.scrollTo(0, 0);
  }

  function showOffline() {
    stopHarbor();
    activeCourse = null;
    activeChapter = null;
    document.body.classList.add('in-course', 'course');
    shell.hidden = false;
    if (hub) hub.hidden = false;
    document.title = '课程已下线 · 学习入口';
    main.innerHTML = '<article class="lesson lesson-article"><h1>这门课已下线</h1><p>AI 教程已从学习站撤下，这里不再打开原来的课程。</p><p><a data-hub-route href="' + esc(location.pathname) + '">返回首页</a></p></article>';
    if (!document.body.classList.contains('assist-open')) document.body.dataset.view = 'reader';
    window.scrollTo(0, 0);
  }
  function show(courseId, moduleId) {
    if (courseId === 'ai') { showOffline(); return; }
    var course = courseBy(courseId);
    if (!course) { showOffline(); return; }
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
      activeCourse = null;
      activeChapter = null;
      document.body.classList.remove('in-course', 'course', 'toc-open');
      shell.hidden = true;
      main.innerHTML = '';
      document.title = '学习入口 · 群岛';
      window.scrollTo(0, 0);
      if (!document.body.classList.contains('assist-open')) document.body.dataset.view = 'hub';
      var id = location.hash.replace('#', '');
      if (id && window.LH_SELECT) window.LH_SELECT(id);
      if (window.LH_REFRESH_PROGRESS) window.LH_REFRESH_PROGRESS();
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
    publishTheme();
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
    if (storedSize) publishReading(storedSize);
  } catch (err) {}
  render();
})();
