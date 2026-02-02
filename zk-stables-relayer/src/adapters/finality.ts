import type { SourceChain } from '../types.js';

/** SRS NFR: lock→mint latency targets differ by chain; dev uses RELAYER_FINALITY_MS_* overrides. */
export function finalityDelayMs(source: SourceChain): number {
  const env = (k: string) => {
    const v = process.env[k];
    return v ? Number(v) : NaN;
  };
  const override = env(`RELAYER_FINALITY_MS_${source.toUpperCase()}`);
  if (!Number.isNaN(override) && override >= 0) return override;

  switch (source) {
    case 'evm':
      return Number(process.env.RELAYER_FINALITY_MS_EVM_DEFAULT ?? 3000);
    case 'cardano':
      return Number(process.env.RELAYER_FINALITY_MS_CARDANO_DEFAULT ?? 5000);
    case 'midnight':
      return Number(process.env.RELAYER_FINALITY_MS_MIDNIGHT_DEFAULT ?? 2000);
    default:
      return 3000;
  }
}
