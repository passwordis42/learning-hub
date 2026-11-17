if (new URLSearchParams(location.search).get('embed') === '1') {
  document.documentElement.classList.add('is-hub-embed');
  const report = () => {
    if (window.parent === window) return;
    const height = Math.ceil(Math.max(
      document.body ? document.body.scrollHeight : 0,
      document.documentElement.scrollHeight,
    ));
    window.parent.postMessage({ type: 'hub-embed-height', height }, location.origin);
  };
  addEventListener('load', () => {
    report();
    if ('ResizeObserver' in window && document.body) new ResizeObserver(report).observe(document.body);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && window.parent !== window) {
      window.parent.postMessage({ type: 'hub-embed-escape' }, location.origin);
    }
  });
  addEventListener('message', (event) => {
    if (event.origin !== location.origin || event.source !== window.parent) return;
    if (!event.data || event.data.type !== 'hub-reading-size') return;
    const px = Math.round(Number(event.data.px));
    if (!Number.isFinite(px)) return;
    document.documentElement.style.setProperty('--hub-reading-size', `${Math.min(24, Math.max(15, px))}px`);
    report();
  });
}
