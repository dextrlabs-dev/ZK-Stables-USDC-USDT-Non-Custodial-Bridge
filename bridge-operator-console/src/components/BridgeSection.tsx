import { BridgeOperatorForm } from './BridgeOperatorForm';
import type { BridgeConsoleState } from '../api/relayerClient';
import { normalizeEvmPayoutAddr } from '../lib/evmPayout';

function evmPayoutDisplay(state: BridgeConsoleState): string {
  const op = normalizeEvmPayoutAddr(state.evmOperatorAddress?.trim() ?? '');
  const bridge = normalizeEvmPayoutAddr(state.recipients.evmRecipient?.trim() ?? '');
  return op || bridge || '—';
}

function cardanoPayoutDisplay(state: BridgeConsoleState): string {
  const mesh = state.cardano.operatorWallet?.changeAddress?.trim();
  if (mesh) return mesh;
  return state.recipients.cardanoRecipient?.trim() || '—';
}

export function BridgeSection({ consoleState }: { consoleState: BridgeConsoleState | undefined }) {
  const r = consoleState?.recipients;

  return (
    <div className="ab-bridge-layout">
      <section className="ab-card ab-card--primary" aria-labelledby="ab-bridge-title">
        <h1 id="ab-bridge-title" className="ab-card-title">Bridge</h1>

        <BridgeOperatorForm state={consoleState} />
      </section>

      {r && consoleState ? (
        <aside className="ab-bridge-aside" aria-label="Relayer configuration">
          <div className="ab-aside-panel">
            <div className="ab-aside-title">Relayer payout addresses</div>
            <dl className="ab-aside-dl">
              <div className="ab-recipient-row">
                <dt>EVM</dt>
                <dd>{evmPayoutDisplay(consoleState)}</dd>
              </div>
              <div className="ab-recipient-row">
                <dt>Cardano</dt>
                <dd>{cardanoPayoutDisplay(consoleState)}</dd>
              </div>
              <div className="ab-recipient-row">
                <dt>Midnight</dt>
                <dd>{r.midnightRecipient?.trim() || '—'}</dd>
              </div>
            </dl>
          </div>
        </aside>
      ) : null}
    </div>
  );
}
