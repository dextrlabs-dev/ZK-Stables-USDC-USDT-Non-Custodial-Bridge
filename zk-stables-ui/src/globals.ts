import { Buffer } from 'buffer';
import nodeProcess from 'process/browser';

/** Unregister any SW from a prior `vite preview` / prod build — it can cache-bust dev and break dynamic imports of `/src/*.tsx`. */
if (import.meta.env.DEV && typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
  void navigator.serviceWorker.getRegistrations().then((regs) => {
    for (const r of regs) void r.unregister();
  });
}

type GlobalProcess = typeof nodeProcess & {
  env: Record<string, string | undefined>;
  browser?: boolean;
  version?: string;
};

const g = globalThis as unknown as {
  Buffer?: typeof Buffer;
  process?: GlobalProcess;
};

if (g.Buffer === undefined) {
  g.Buffer = Buffer;
}

// @meshsdk/core → stream-browserify → readable-stream uses bare `process` (nextTick, version, …).
// Install the real browser polyfill on globalThis; prod chunks use `var process=globalThis.process` (see vite.config banner).
const p = nodeProcess as GlobalProcess;
if (g.process !== undefined && g.process !== p) {
  Object.assign(p, g.process);
}
g.process = p;
p.browser = true;
if (p.version == null || p.version === '') {
  p.version = 'v20.0.0';
}
p.env ??= {};
if (p.env.NODE_ENV == null) {
  p.env.NODE_ENV = import.meta.env.PROD ? 'production' : 'development';
}
