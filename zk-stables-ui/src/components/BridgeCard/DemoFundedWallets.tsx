import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useConnect } from 'wagmi';
import type { Address } from 'viem';
import { demoWalletsEnabled } from '../../demo/constants.js';
import { fetchAnvilDemoBalances, type AnvilBalanceRow } from '../../lib/anvilDemoBalances.js';
import type { DemoWalletsResponse } from '../../lib/relayerClient.js';
import { shortenAddress } from '../../utils/formatAddress.js';
import { parseEnvEthereumAddress } from '../../utils/envAddress.js';

function copyText(t: string) {
  void navigator.clipboard.writeText(t);
}

export const DemoFundedWallets: React.FC<{ demo: DemoWalletsResponse }> = ({ demo }) => {
  const enabled = demoWalletsEnabled();
  const { connectors, connect, isPending: evmConnecting } = useConnect();
  const mockConnector = useMemo(() => connectors.find((c) => c.id === 'mock'), [connectors]);

  const rpcUrl = import.meta.env.VITE_ETH_LOCALHOST_RPC_URL || 'http://127.0.0.1:8545';
  const usdc = parseEnvEthereumAddress(import.meta.env.VITE_DEMO_USDC_ADDRESS);
  const usdt = parseEnvEthereumAddress(import.meta.env.VITE_DEMO_USDT_ADDRESS);
  const wusdc = parseEnvEthereumAddress(import.meta.env.VITE_DEMO_WUSDC_ADDRESS);
  const wusdt = parseEnvEthereumAddress(import.meta.env.VITE_DEMO_WUSDT_ADDRESS);

  const [rows, setRows] = useState<AnvilBalanceRow[] | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const accounts = useMemo(
    () => demo.evm.accounts.map((a) => a.address as Address).filter(Boolean),
    [demo.evm.accounts],
  );

  const load = useCallback(async () => {
    if (accounts.length === 0) return;
    setLoadErr(null);
    try {
      const data = await fetchAnvilDemoBalances({
        rpcUrl,
        accounts,
        ...(usdc ? { usdc } : {}),
        ...(usdt ? { usdt } : {}),
        ...(wusdc ? { wusdc } : {}),
        ...(wusdt ? { wusdt } : {}),
      });
      setRows(data);
    } catch (e) {
      setRows(null);
      setLoadErr(e instanceof Error ? e.message : String(e));
    }
  }, [accounts, rpcUrl, usdc, usdt, wusdc, wusdt, refreshKey]); // refreshKey forces re-fetch

  useEffect(() => {
    void load();
  }, [load]);

  if (!enabled) return null;

  return (
    <details
      className="group mb-4 overflow-hidden rounded-2xl border border-indigo-200/60 bg-gradient-to-b from-indigo-50/40 to-white"
      open={import.meta.env.DEV}
    >
      <summary className="cursor-pointer list-none px-4 py-3 [&::-webkit-details-marker]:hidden">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-sm font-semibold text-slate-900">Demo wallets (funded on local dev)</p>
            <p className="mt-0.5 text-[11px] leading-snug text-slate-500">
              Anvil/Hardhat accounts · balances from <span className="font-mono text-slate-600">{rpcUrl.replace(/^https?:\/\//u, '')}</span>
            </p>
          </div>
          <span className="shrink-0 rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-indigo-800 group-open:hidden">
            Show
          </span>
        </div>
      </summary>

      <div className="space-y-4 border-t border-indigo-100/80 px-4 pb-4 pt-2">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={evmConnecting || !mockConnector}
            onClick={() => mockConnector && connect({ connector: mockConnector })}
            className="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {evmConnecting ? 'Connecting…' : 'Connect mock EVM (Anvil keys)'}
          </button>
          <button
            type="button"
            onClick={() => setRefreshKey((k) => k + 1)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
          >
            Refresh balances
          </button>
          <p className="text-[11px] text-slate-500">
            Live mUSDC/mUSDT (demo account #0 on RPC):{' '}
            {rows?.[0] && usdc && usdt ? (
              <>
                <span className="font-mono font-medium text-slate-700">{rows[0].usdc ?? '—'}</span> USDC ·{' '}
                <span className="font-mono font-medium text-slate-700">{rows[0].usdt ?? '—'}</span> USDT
              </>
            ) : (
              <span className="text-slate-400">load the table or set USDC/USDT env addresses</span>
            )}
          </p>
        </div>

        {!usdc && !usdt ? (
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-[11px] leading-relaxed text-slate-600">
            Set <code className="rounded bg-white px-1 font-mono text-[10px]">VITE_DEMO_USDC_ADDRESS</code> and{' '}
            <code className="rounded bg-white px-1 font-mono text-[10px]">VITE_DEMO_USDT_ADDRESS</code> in{' '}
            <code className="font-mono text-[10px]">.env</code> after <code className="font-mono text-[10px]">deploy-anvil.js</code> to show
            live ERC-20 balances. Add <code className="font-mono text-[10px]">VITE_DEMO_WUSDC_ADDRESS</code> /{' '}
            <code className="font-mono text-[10px]">VITE_DEMO_WUSDT_ADDRESS</code> for bridged (wrapped) columns.
          </p>
        ) : null}

        {loadErr ? (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
            Could not read chain: {loadErr} — start Anvil or check RPC.
          </p>
        ) : null}

        {rows && rows.length > 0 ? (
          <div className="overflow-x-auto rounded-xl border border-slate-200/80 bg-white">
            <table className="w-full min-w-[280px] text-left text-[11px]">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/80 text-[10px] font-bold uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-2">#</th>
                  <th className="px-3 py-2">Address</th>
                  <th className="px-3 py-2">ETH</th>
                  {usdc ? <th className="px-3 py-2">USDC</th> : null}
                  {usdt ? <th className="px-3 py-2">USDT</th> : null}
                  {wusdc ? <th className="px-3 py-2">wUSDC</th> : null}
                  {wusdt ? <th className="px-3 py-2">wUSDT</th> : null}
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.address} className="border-b border-slate-50 last:border-0">
                    <td className="whitespace-nowrap px-3 py-2 font-medium text-slate-500">{demo.evm.accounts[i]?.index ?? i}</td>
                    <td className="max-w-[8rem] px-3 py-2 font-mono text-slate-800" title={r.address}>
                      {shortenAddress(r.address, { head: 8, tail: 6 })}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 tabular-nums text-slate-700">{r.ethFormatted}</td>
                    {usdc ? <td className="whitespace-nowrap px-3 py-2 tabular-nums text-slate-700">{r.usdc ?? '—'}</td> : null}
                    {usdt ? <td className="whitespace-nowrap px-3 py-2 tabular-nums text-slate-700">{r.usdt ?? '—'}</td> : null}
                    {wusdc ? <td className="whitespace-nowrap px-3 py-2 tabular-nums text-teal-800">{r.wusdc ?? '—'}</td> : null}
                    {wusdt ? <td className="whitespace-nowrap px-3 py-2 tabular-nums text-teal-800">{r.wusdt ?? '—'}</td> : null}
                    <td className="px-2 py-1">
                      <button
                        type="button"
                        className="rounded-md px-2 py-1 text-[10px] font-semibold text-indigo-700 hover:bg-indigo-50"
                        onClick={() => copyText(r.address)}
                      >
                        Copy
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : !loadErr ? (
          <p className="text-xs text-slate-500">Loading balances…</p>
        ) : null}

        {demo.evm.accounts[0]?.privateKey ? (
          <p className="text-[10px] leading-relaxed text-slate-500">
            Account 0 private key (relayer demo API):{' '}
            <code className="break-all rounded bg-slate-100 px-1 font-mono text-slate-700">{demo.evm.accounts[0].privateKey}</code>
          </p>
        ) : null}

        <div className="rounded-xl border border-sky-100 bg-sky-50/50 px-3 py-2.5">
          <p className="text-[10px] font-bold uppercase tracking-wide text-sky-900">Cardano (demo addresses)</p>
          <ul className="mt-2 space-y-1.5 text-[11px] text-sky-950">
            {demo.cardano.addresses.map((a) => (
              <li key={a.role} className="flex flex-wrap items-start gap-2">
                <span className="shrink-0 rounded bg-white/80 px-1.5 py-0.5 text-[10px] font-semibold capitalize text-sky-800">{a.role}</span>
                <span className="min-w-0 break-all font-mono leading-snug">{a.bech32}</span>
                <button type="button" className="shrink-0 text-[10px] font-semibold text-sky-800 underline" onClick={() => copyText(a.bech32)}>
                  Copy
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[10px] leading-relaxed text-sky-800/90">
            Fund these on your devnet (e.g. Yaci <code className="rounded bg-white/60 px-0.5 font-mono">topup</code>) for live Cardano bridge tests — see{' '}
            <code className="font-mono text-[10px]">docs/CARDANO_LOCAL_YACI.md</code>.
          </p>
        </div>

        <div className="rounded-xl border border-violet-100 bg-violet-50/50 px-3 py-2.5">
          <p className="text-[10px] font-bold uppercase tracking-wide text-violet-900">Midnight (examples)</p>
          <p className="mt-1 break-all font-mono text-[11px] leading-relaxed text-violet-950">{demo.midnight.shieldedExample}</p>
          <p className="mt-1 break-all font-mono text-[11px] leading-relaxed text-violet-950">{demo.midnight.unshieldedExample}</p>
          <p className="mt-2 text-[10px] text-violet-900/90">{demo.midnight.note}</p>
        </div>

        <p className="text-[10px] leading-relaxed text-slate-500">{demo.warning}</p>
      </div>
    </details>
  );
};
