export function credentialMode(endpoint, pageOrigin) {
  try {
    const url = new URL(endpoint, pageOrigin);
    return url.origin === new URL(pageOrigin).origin ? 'same-origin' : 'omit';
  } catch {
    return 'omit';
  }
}
