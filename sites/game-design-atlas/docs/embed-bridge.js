if (new URLSearchParams(location.search).get('embed') === '1') {
  const params = new URLSearchParams(location.search);
  const root = document.documentElement;
  root.classList.add('is-hub-embed');

  const initialTheme = params.get('theme');
  if (initialTheme === 'night' || initialTheme === 'sand') {
    root.dataset.theme = initialTheme;
  }
  const initialAccent = params.get('accent');
  if (initialAccent) {
    root.style.setProperty('--hub-accent', initialAccent);
  }
  const initialFs = Math.round(Number(params.get('fs')));
  if (Number.isFinite(initialFs) && initialFs >= 15 && initialFs <= 24) {
    root.style.setProperty('--hub-reading-size', `${initialFs}px`);
  }

  for (const href of ['../assets/fonts/sans.css', '../assets/fonts/serif.css']) {
    if (document.head && !document.querySelector(`link[href="${href}"]`)) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      document.head.appendChild(link);
    }
  }

  let lastHeight = 0;
  let rafId = 0;
  const measure = () => {
    const body = document.body;
    if (!body) return 760;
    const bodyRect = body.getBoundingClientRect();
    let bottom = bodyRect.height;
    const host = document.querySelector('main, #main') || body;
    bottom = Math.max(bottom, host.getBoundingClientRect().bottom - bodyRect.top);
    for (const child of host.children) {
      const style = getComputedStyle(child);
      if (style.display === 'none' || style.position === 'fixed') continue;
      bottom = Math.max(bottom, child.getBoundingClientRect().bottom - bodyRect.top);
    }
    return Math.ceil(Math.max(760, bottom + 24));
  };

  const report = () => {
    if (window.parent === window) return;
    const height = measure();
    if (Math.abs(height - lastHeight) >= 2) {
      lastHeight = height;
      window.parent.postMessage({ type: 'hub-embed-height', height }, location.origin);
    }
  };

  const scheduleReport = () => {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(() => {
      rafId = 0;
      report();
    });
  };

  const reportRoute = () => {
    if (window.parent === window) return;
    window.parent.postMessage({ type: 'hub-embed-route', hash: location.hash }, location.origin);
    scheduleReport();
  };

  const nativeScrollTo = window.scrollTo.bind(window);
  window.scrollTo = (...args) => {
    nativeScrollTo(...args);
    const top = typeof args[0] === 'object' && args[0] !== null ? args[0].top : args[1];
    if (top === 0 && window.parent !== window) {
      window.parent.postMessage({ type: 'hub-embed-scroll-top' }, location.origin);
    }
  };

  addEventListener('load', () => {
    report();
    reportRoute();
    const host = document.querySelector('main, #main') || document.body;
    if ('ResizeObserver' in window && host) {
      new ResizeObserver(scheduleReport).observe(host);
    }
    if ('MutationObserver' in window && document.body) {
      new MutationObserver(scheduleReport).observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['hidden', 'open', 'class', 'aria-expanded', 'aria-selected'],
      });
    }
  });

  addEventListener('hashchange', reportRoute);

  let progressTimer = 0;
  const notifyProgress = () => {
    scheduleReport();
    clearTimeout(progressTimer);
    progressTimer = setTimeout(() => {
      if (window.parent !== window) {
        window.parent.postMessage({ type: 'hub-embed-progress' }, location.origin);
      }
      report();
    }, 90);
  };
  document.addEventListener('click', notifyProgress, true);
  document.addEventListener('change', notifyProgress, true);

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && window.parent !== window) {
      window.parent.postMessage({ type: 'hub-embed-escape' }, location.origin);
    }
  });

  addEventListener('message', (event) => {
    if (event.origin !== location.origin || event.source !== window.parent || !event.data) return;
    if (event.data.type === 'hub-reading-size') {
      const px = Math.round(Number(event.data.px));
      if (!Number.isFinite(px)) return;
      root.style.setProperty('--hub-reading-size', `${Math.min(24, Math.max(15, px))}px`);
      scheduleReport();
    } else if (event.data.type === 'hub-theme') {
      if (event.data.theme === 'night' || event.data.theme === 'sand') {
        root.dataset.theme = event.data.theme;
      }
      if (event.data.accent) {
        root.style.setProperty('--hub-accent', String(event.data.accent));
      }
      scheduleReport();
    }
  });
}
