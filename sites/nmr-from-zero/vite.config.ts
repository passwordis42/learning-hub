import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Standalone builds keep the original GitHub Pages base. The hub sets HUB_BASE
// to / or a prefix such as /learning-hub/ before `vite build`.
function siteBase() {
  const runtime = globalThis as { process?: { env?: { HUB_BASE?: string } } };
  const raw = runtime.process?.env?.HUB_BASE;
  if (raw == null || raw === '' || raw === '/') return '/nmr-from-zero/';
  if (typeof raw !== 'string' || !raw.startsWith('/') || !raw.endsWith('/') || raw.includes('//')) {
    throw new Error('HUB_BASE must be empty, /, or a slash-bounded prefix such as /learning-hub/.');
  }
  const parts = raw.split('/').filter(Boolean);
  if (!parts.length || parts.some((part) => part === '.' || part === '..' || !/^[A-Za-z0-9._-]+$/.test(part))) {
    throw new Error('HUB_BASE must be a safe path prefix.');
  }
  return `${raw}nmr-from-zero/`;
}

export default defineConfig({
  plugins: [react()],
  base: siteBase(),
  build: { rollupOptions: { output: { manualChunks: { math: ['katex'], react: ['react', 'react-dom'] } } } },
});
