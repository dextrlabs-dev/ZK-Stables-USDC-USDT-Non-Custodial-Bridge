/**
 * Serialize LOCK → Midnight steps that use the LevelDB private-state provider.
 * Concurrent `proveHolder` / contract txs hit overlapping `Level.open()` on the same path and throw
 * `Database failed to open` (abstract-level) when two jobs run in parallel.
 */
let mutexTail: Promise<unknown> = Promise.resolve();

export function withMidnightPipelineMutex<T>(fn: () => Promise<T>): Promise<T> {
  const run = mutexTail.then(() => fn());
  mutexTail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}
