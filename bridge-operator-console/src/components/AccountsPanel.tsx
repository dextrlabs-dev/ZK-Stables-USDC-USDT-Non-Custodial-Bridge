import { useQuery } from '@tanstack/react-query';
import { fetchBalances, type BalanceRow, type BalancesResponse, type CardanoBalanceRow } from '../api/relayerClient';

function Tok({ label, bal, accent }: { label: string; bal: BalanceRow | undefined; accent?: boolean }) {
  const v = bal?.display ?? '—';
  return (
    <div className="ap-tok">
      <span className={`ap-tok-label ${accent ? 'ap-tok-label--zk' : ''}`}>{label}</span>
      <span className="ap-tok-val mono" title={v}>{v}</span>
    </div>
  );
}

function Addr({ label, addr }: { label: string; addr: string | null | undefined }) {
  if (!addr) return null;
  const short = addr.length > 20 ? `${addr.slice(0, 10)}…${addr.slice(-8)}` : addr;
  return <div className="ap-addr"><span className="ap-addr-label">{label}</span><code className="mono">{short}</code></div>;
}

/** Decode Cardano asset name hex to UTF-8 in the browser (no Node Buffer). */
function hexAssetNameToLabel(assetNameHex: string): string {
  if (!assetNameHex || assetNameHex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/u.test(assetNameHex)) {
    return assetNameHex.length > 14 ? `${assetNameHex.slice(0, 10)}…` : assetNameHex;
  }
  try {
    const bytes = new Uint8Array(assetNameHex.length / 2);
    for (let i = 0; i < assetNameHex.length; i += 2) {
      bytes[i / 2] = Number.parseInt(assetNameHex.slice(i, i + 2), 16);
    }
    const s = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    if (/^[\x20-\x7e]+$/u.test(s) && s.length > 0) {
      if (/^WUSDC$/iu.test(s)) return 'zkUSDC';
      if (/^WUSDT$/iu.test(s)) return 'zkUSDT';
      return s;
    }
  } catch { /* fall through */ }
  return assetNameHex.length > 14 ? `${assetNameHex.slice(0, 10)}…` : assetNameHex;
}

function cardanoNativeTokenLabel(unit: string, row: CardanoBalanceRow): string {
  if (row.label?.trim()) return row.label.trim();
  const nameHex = unit.length > 56 ? unit.slice(56) : '';
  if (!nameHex) return unit.length > 16 ? `${unit.slice(0, 12)}…` : unit;
  return hexAssetNameToLabel(nameHex);
}

function CardanoBalances({ cardano }: { cardano: BalancesResponse['cardano'] }) {
  if (!cardano) return <p className="ap-none">Cardano wallet not connected</p>;

  const bals = cardano.balances;
  const lovelace = bals['lovelace'];
  const tokens = Object.entries(bals).filter(([u]) => u !== 'lovelace');

  return (
    <div className="ap-chain-inner">
      <Addr label="Wallet" addr={cardano.address} />
      {cardano.recipientAddress && <Addr label="Recipient" addr={cardano.recipientAddress} />}
      {lovelace && <Tok label="ADA" bal={{ raw: lovelace.raw, display: lovelace.display }} />}
      {tokens.length === 0 && <p className="ap-none">No native tokens</p>}
      {tokens.map(([unit, row]) => {
        const label = cardanoNativeTokenLabel(unit, row);
        const accent = /zkUSDC|zkUSDT|^WUSDC$|^WUSDT$/iu.test(label);
        return <Tok key={unit} label={label} bal={row} accent={accent} />;
      })}
    </div>
  );
}

export function AccountsPanel() {
  const { data, isLoading } = useQuery({
    queryKey: ['balances'],
    queryFn: fetchBalances,
    refetchInterval: 5_000,
  });

  if (isLoading) return <div className="ap-loading">Loading balances…</div>;
  if (!data) return null;

  const { evm, cardano, midnight } = data;

  return (
    <section className="ap-section" aria-label="Account balances">
      <h2 className="ap-title">Accounts</h2>

      <div className="ap-chains">
        <div className="ap-chain">
          <h3 className="ap-chain-name">EVM</h3>
          <Addr label="Operator" addr={evm.owner} />
          <Addr label="Pool" addr={evm.pool} />
          <div className="ap-row-group">
            <Tok label="USDC" bal={evm.balances.usdc} />
            <Tok label="USDT" bal={evm.balances.usdt} />
            <Tok label="zkUSDC" bal={evm.balances.zkUsdc} accent />
            <Tok label="zkUSDT" bal={evm.balances.zkUsdt} accent />
          </div>
          {(evm.poolBalances.usdc || evm.poolBalances.usdt) && (
            <div className="ap-row-group ap-pool-group">
              <div className="ap-pool-label">Pool reserves</div>
              <Tok label="USDC" bal={evm.poolBalances.usdc} />
              <Tok label="USDT" bal={evm.poolBalances.usdt} />
            </div>
          )}
        </div>

        <div className="ap-chain">
          <h3 className="ap-chain-name">Cardano</h3>
          <CardanoBalances cardano={cardano} />
        </div>

        <div className="ap-chain">
          <h3 className="ap-chain-name">Midnight</h3>
          <Addr label="Contract" addr={midnight.contractAddress} />
          {midnight.balances ? (
            <div className="ap-row-group">
              <Tok label="zkUSDC" bal={midnight.balances.zkUsdc} accent />
              <Tok label="zkUSDT" bal={midnight.balances.zkUsdt} accent />
            </div>
          ) : midnight.error ? (
            <p className="ap-none ap-none--small">{midnight.error}</p>
          ) : (
            <p className="ap-none ap-none--small">Midnight balances unavailable</p>
          )}
          <p className="ap-none ap-none--small" style={{ marginTop: '0.3rem' }}>via registry ledger (indexer read)</p>
        </div>
      </div>
    </section>
  );
}
