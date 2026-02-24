import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useConnection } from 'wagmi';
import type { Address } from 'viem';
import { fetchBridgedWrappedBalances } from '../../lib/anvilDemoBalances.js';
import type { DemoWalletsResponse } from '../../lib/relayerClient.js';
import { shortenAddress } from '../../utils/formatAddress.js';

function fmtBal(s: string | undefined): string {
  if (s === undefined) return '—';
  const n = Number(s);
  if (Number.isNaN(n)) return s;
  if (n === 0) return '0';
  if (n >= 1_000_000) return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return n.toLocaleString(undefined, { maximumFractionDigits: 6 });
}

export const BridgedBalancesBar: React.FC<{ demo: DemoWalletsResponse }> = ({ demo }) => {
  const rpcUrl = import.meta.env.VITE_ETH_LOCALHOST_RPC_URL || 'http://127.0.0.1:8545';
  const wusdc = (import.meta.env.VITE_DEMO_WUSDC_ADDRESS as Address | undefined)?.trim() as Address | undefined;
  const wusdt = (import.meta.env.VITE_DEMO_WUSDT_ADDRESS as Address | undefined)?.trim() as Address | undefined;

  const { address: connected } = useConnection();
  const fallback = demo.evm.accounts[0]?.address as Address | undefined;
  const account = (connected ?? fallback) as Address | undefined;

  const [wusdcBal, setWusdcBal] = useState<string | undefined>();
  const [wusdtBal, setWusdtBal] = useState<string | undefined>();
  const [err, setErr] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const hasWrapped = Boolean(wusdc || wusdt);

  const load = useCallback(async () => {
    if (!account || !hasWrapped) return;
    setErr(null);
    try {
      const b = await fetchBridgedWrappedBalances({
        rpcUrl,
        account,
        wusdc,
        wusdt,
      });
      setWusdcBal(b.wusdc);
      setWusdtBal(b.wusdt);
    } catch (e) {
      setWusdcBal(undefined);
      setWusdtBal(undefined);
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, [account, rpcUrl, wusdc, wusdt, hasWrapped, refreshKey]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!hasWrapped || !account) return;
    const id = window.setInterval(() => setRefreshKey((k) => k + 1), 12_000);
    return () => window.clearInterval(id);
  }, [hasWrapped, account]);

  const subtitle = useMemo(() => {
    if (!account) return 'Connect EVM or load demo wallets';
    return shortenAddress(account, { head: 10, tail: 8 });
  }, [account]);

  if (!hasWrapped) {
    return (
      <div className="mb-4 rounded-2xl border border-dashed border-slate-200 bg-slate-50/50 px-3 py-2.5">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Bridged on EVM (wUSDC · wUSDT)</p>
        <p className="mt-1 text-[11px] leading-relaxed text-slate-600">
          Set <code className="rounded bg-white px-1 font-mono text-[10px]">VITE_DEMO_WUSDC_ADDRESS</code> and{' '}
          <code className="rounded bg-white px-1 font-mono text-[10px]">VITE_DEMO_WUSDT_ADDRESS</code> from{' '}
          <code className="font-mono text-[10px]">deploy-anvil.js</code> (<span className="font-mono">wUSDC</span>,{' '}
          <span className="font-mono">wUSDT</span> fields) to show wrapped balances.
        </p>
      </div>
    );
  }

  return (
    <div className="mb-4 rounded-2xl border border-teal-200/70 bg-gradient-to-br from-teal-50/80 to-white px-3 py-3 ring-1 ring-teal-100/80">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-teal-800">Bridged on EVM</p>
          <p className="mt-0.5 font-mono text-[11px] text-slate-600" title={account}>
            Account {subtitle}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setRefreshKey((k) => k + 1)}
          className="shrink-0 rounded-lg border border-teal-200/90 bg-white px-2.5 py-1 text-[10px] font-semibold text-teal-900 shadow-sm hover:bg-teal-50/90"
        >
          Refresh
        </button>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-white/80 bg-white/90 px-2.5 py-2 shadow-sm">
          <p className="text-[9px] font-bold uppercase tracking-wide text-slate-500">wUSDC</p>
          <p className="mt-0.5 text-lg font-semibold tabular-nums tracking-tight text-slate-900">{fmtBal(wusdcBal)}</p>
        </div>
        <div className="rounded-xl border border-white/80 bg-white/90 px-2.5 py-2 shadow-sm">
          <p className="text-[9px] font-bold uppercase tracking-wide text-slate-500">wUSDT</p>
          <p className="mt-0.5 text-lg font-semibold tabular-nums tracking-tight text-slate-900">{fmtBal(wusdtBal)}</p>
        </div>
      </div>
      {err ? (
        <p className="mt-2 text-[10px] leading-snug text-amber-800">Could not read chain: {err}</p>
      ) : null}
      <p className="mt-2 text-[9px] leading-snug text-slate-500">
        Wrapped tokens minted by the bridge on local Anvil. Underlying mock USDC/USDT are listed in the demo wallets table.
      </p>
    </div>
  );
};
