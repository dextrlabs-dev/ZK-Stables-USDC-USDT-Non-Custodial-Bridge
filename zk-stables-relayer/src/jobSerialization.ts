import type { RelayerJob, RelayerPhase } from './types.js';

/** Hono/JSON cannot encode bigint (e.g. Merkle proof `blockNumber`, `logIndex`). */
function jsonSafeClone<T>(v: T): T {
  return JSON.parse(
    JSON.stringify(v, (_k, val) => {
      if (typeof val === 'bigint') return val.toString();
      return val;
    }),
  ) as T;
}

const PHASE_LABELS: Record<RelayerPhase, string> = {
  received: 'Queued',
  awaiting_finality: 'Awaiting finality',
  proving: 'Generating proof',
  destination_handoff: 'Destination handoff',
  completed: 'Completed',
  failed: 'Failed',
};

const PHASE_ORDER: RelayerPhase[] = [
  'received',
  'awaiting_finality',
  'proving',
  'destination_handoff',
  'completed',
];

export type RelayerJobApi = RelayerJob & {
  ui: {
    phaseLabel: string;
    /** 0-based step for linear progress (failed = -1). */
    phaseIndex: number;
    phaseCount: number;
  };
};

export function serializeRelayerJob(job: RelayerJob): RelayerJobApi {
  const safe = jsonSafeClone(job);
  const idx = PHASE_ORDER.indexOf(safe.phase);
  const phaseIndex = safe.phase === 'failed' ? -1 : idx >= 0 ? idx : 0;
  return {
    ...safe,
    ui: {
      phaseLabel: PHASE_LABELS[safe.phase] ?? safe.phase,
      phaseIndex,
      phaseCount: PHASE_ORDER.length,
    },
  };
}
