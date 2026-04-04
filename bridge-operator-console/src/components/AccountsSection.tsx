import type { HealthChains } from '../api/relayerClient';

function Dot({ ok }: { ok: boolean }) {
  return <span className={`ab-dot ${ok ? 'on' : ''}`} aria-hidden />;
}

export function ChainStatusBar({
  health,
  healthLoading,
  healthError,
}: {
  health: HealthChains | undefined;
  healthLoading: boolean;
  healthError: Error | null;
}) {
  const ev = health as Record<string, { ok?: boolean }> | undefined;

  if (healthError) {
    return (
      <div className="ab-status" role="status">
        <span className="ab-status-item" style={{ borderColor: 'var(--bad)', color: 'oklch(0.85 0.06 25)' }}>
          Health error
        </span>
      </div>
    );
  }

  if (healthLoading || !health) {
    return (
      <div className="ab-status" role="status">
        <span className="ab-status-item">Checking chains…</span>
      </div>
    );
  }

  return (
    <div className="ab-status" role="status" aria-label="Chain connectivity">
      <span className="ab-status-item">
        <Dot ok={Boolean(ev?.evm?.ok)} />
        EVM
      </span>
      <span className="ab-status-item">
        <Dot ok={Boolean(ev?.cardano?.ok)} />
        Cardano
      </span>
      <span className="ab-status-item">
        <Dot ok={Boolean(ev?.midnightIndexer?.ok)} />
        Midnight
      </span>
    </div>
  );
}
