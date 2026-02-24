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

import('./bootstrap.js')
  .then(({ mount }) => {
    mount();
  })
  .catch((err) => {
    console.error(err);
    if (root) {
      root.innerHTML = `<p style="font-family:system-ui,sans-serif;padding:2rem;color:#b91c1c;background:#f8fafc">Failed to load app: ${String(err?.message ?? err)}</p>`;
    }
  });
