/**
 * Keep this file minimal so Vite does not pre-transform the whole Midnight/WASM
 * graph before the dev server can respond. Heavy imports live in bootstrap.tsx.
 */
import './globals';

const root = document.getElementById('root');
if (root) {
  root.innerHTML =
    '<p style="font-family:system-ui,sans-serif;padding:2rem;margin:0;color:#64748b;background:#f8fafc">Loading app shell…</p>';
}

import('./bootstrap')
  .then(({ mount }) => {
    mount();
  })
  .catch((err) => {
    console.error('bootstrap import failed', err);
    if (root) {
      const msg = err instanceof Error ? err.message : String(err);
      const stack = err instanceof Error && err.stack ? `\n\n${err.stack}` : '';
      root.innerHTML = `<p style="font-family:system-ui,sans-serif;padding:2rem;color:#b91c1c;background:#f8fafc;white-space:pre-wrap;word-break:break-word">Failed to load app: ${msg}${stack}</p>`;
    }
  });
