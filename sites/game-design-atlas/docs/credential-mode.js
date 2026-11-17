const loopbackNames = ['127.0.0.1', 'localhost', '[::1]'];
const standaloneAssistant = 'http://127.0.0.1:4173';

export function credentialMode(endpoint, pageOrigin) {
  try {
    const url = new URL(endpoint, pageOrigin);
    return url.origin === new URL(pageOrigin).origin ? 'same-origin' : 'omit';
  } catch {
    return 'omit';
  }
}

export function assistantRoot(page) {
  const params = new URLSearchParams(page.search || '');
  if (params.get('embed') === '1') {
    const marker = '/game/';
    const index = page.pathname.lastIndexOf(marker);
    const prefix = index >= 0 ? page.pathname.slice(0, index) : '';
    return `${page.origin}${prefix}`;
  }
  if (loopbackNames.includes(page.hostname)) return page.origin;
  return standaloneAssistant;
}
