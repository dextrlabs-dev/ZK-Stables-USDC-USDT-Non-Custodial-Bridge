import { BridgeOperatorForm } from './BridgeOperatorForm';
import type { BridgeConsoleState } from '../api/relayerClient';

export function BridgeSection({ consoleState }: { consoleState: BridgeConsoleState | undefined }) {
  const r = consoleState?.recipients;

  return (
    <div className="ab-bridge-layout">
      <section className="ab-card ab-card--primary" aria-labelledby="ab-bridge-title">
        <h1 id="ab-bridge-title" className="ab-card-title">
          Bridge
        </h1>
        <p className="ab-card-sub">Relayer intents — mint from pool locks, redeem with proofs. Nothing leaves this card until you send.</p>

        <BridgeOperatorForm state={consoleState} />
      </section>

      {r ? (
        <aside className="ab-bridge-aside" aria-label="Relayer configuration">
          <div className="ab-aside-panel">
            <div className="ab-aside-title">Relayer payout addresses</div>
            <dl className="ab-aside-dl">
              <div className="ab-recipient-row">
                <dt>EVM</dt>
                <dd>{r.evmRecipient ?? '—'}</dd>
              </div>
              <div className="ab-recipient-row">
                <dt>Cardano</dt>
                <dd>{r.cardanoRecipient ?? '—'}</dd>
              </div>
              <div className="ab-recipient-row">
                <dt>Midnight</dt>
                <dd>{r.midnightRecipient ?? '—'}</dd>
              </div>
            </dl>
          </div>
        </aside>
      ) : null}
    </div>
  );
}
