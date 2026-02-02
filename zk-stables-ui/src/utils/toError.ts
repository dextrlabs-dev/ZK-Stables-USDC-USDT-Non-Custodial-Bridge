/** Normalize unknown throws (strings, Effect, RPC payloads) for UI + logging. */
export function toError(e: unknown): Error {
  if (e instanceof Error) return e;
  if (e !== null && typeof e === 'object') {
    const o = e as Record<string, unknown>;
    const msg = o.message;
    if (typeof msg === 'string') {
      const err = new Error(msg);
      if (typeof o.stack === 'string') err.stack = o.stack;
      if (typeof o.name === 'string') err.name = o.name;
      return err;
    }
    try {
      return new Error(JSON.stringify(e));
    } catch {
      return new Error(String(e));
    }
  }
  return new Error(String(e));
}
