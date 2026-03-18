import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useConnection } from 'wagmi';
import type { Address } from 'viem';
import {
  fetchBridgedWrappedBalances,
  fetchNativeEthBalance,
  fetchUnderlyingStableBalances,
} from '../../lib/anvilDemoBalances.js';
import { parseEnvEthereumAddress } from '../../utils/envAddress.js';
import {
  fetchYaciAddressAda,
  fetchYaciAddressNativeAssetQuantity,
  formatNativeUnits,
  isYaciStoreReachable,
  resolveYaciStoreBaseUrl,
} from '../../lib/yaciAddressBalance.js';
import { useZkStables } from '../../hooks/useZkStables.js';
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

/** Display bigint bridge amount from zk-stables public ledger (circuit-updated state). */
function fmtLedgerAmount(n: bigint): string {
  const s = n.toString();
  return s.replace(/\B(?=(\d{3})+(?!\d))/gu, ',');
}

export const BridgedBalancesBar: React.FC<{ demo: DemoWalletsResponse }> = ({ demo }) => {
  const { ledger, contractAddress, walletAddress, unshieldedAddress, refreshLedger } = useZkStables();
  const rpcUrl = import.meta.env.VITE_ETH_LOCALHOST_RPC_URL || 'http://127.0.0.1:8545';
  const usdc = parseEnvEthereumAddress(import.meta.env.VITE_DEMO_USDC_ADDRESS);
  const usdt = parseEnvEthereumAddress(import.meta.env.VITE_DEMO_USDT_ADDRESS);
  const wusdc = parseEnvEthereumAddress(import.meta.env.VITE_DEMO_WUSDC_ADDRESS);
  const wusdt = parseEnvEthereumAddress(import.meta.env.VITE_DEMO_WUSDT_ADDRESS);

  const { address: connected } = useConnection();
  const fallback = demo.evm.accounts[0]?.address as Address | undefined;
  const account = (connected ?? fallback) as Address | undefined;

  const cardanoSource = demo.cardano.addresses.find((a) => a.role === 'source')?.bech32?.trim() ?? '';
  const cardanoDest = demo.cardano.addresses.find((a) => a.role === 'destination')?.bech32?.trim() ?? '';
  const yaciBase = resolveYaciStoreBaseUrl();
  const cardanoNativeDecimals = Math.min(
    18,
    Math.max(0, Number.parseInt(String(import.meta.env.VITE_CARDANO_NATIVE_DECIMALS ?? '6'), 10) || 6),
  );
  const cardWusdcUnit = (import.meta.env.VITE_CARDANO_WUSDC_UNIT ?? '').trim();
  const cardWusdtUnit = (import.meta.env.VITE_CARDANO_WUSDT_UNIT ?? '').trim();

  const [ethBal, setEthBal] = useState<string | undefined>();
  const [wusdcBal, setWusdcBal] = useState<string | undefined>();
  const [wusdtBal, setWusdtBal] = useState<string | undefined>();
  const [usdcBal, setUsdcBal] = useState<string | undefined>();
  const [usdtBal, setUsdtBal] = useState<string | undefined>();
  const [adaSrcBal, setAdaSrcBal] = useState<string | undefined>();
  const [adaDestBal, setAdaDestBal] = useState<string | undefined>();
  const [nativeWusdcSrc, setNativeWusdcSrc] = useState<string | undefined>();
  const [nativeWusdtSrc, setNativeWusdtSrc] = useState<string | undefined>();
  const [nativeWusdcDest, setNativeWusdcDest] = useState<string | undefined>();
  const [nativeWusdtDest, setNativeWusdtDest] = useState<string | undefined>();
  const [evmErr, setEvmErr] = useState<string | null>(null);
  const [adaErr, setAdaErr] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const hasWrapped = Boolean(wusdc || wusdt);
  const hasUnderlying = Boolean(usdc || usdt);

  const load = useCallback(async () => {
    setEvmErr(null);
    setAdaErr(null);

    if (account) {
      try {
        const eth = await fetchNativeEthBalance({ rpcUrl, account });
        setEthBal(eth);
      } catch (e) {
        setEthBal(undefined);
        setEvmErr(e instanceof Error ? e.message : String(e));
      }
      if (hasWrapped) {
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
          setEvmErr(e instanceof Error ? e.message : String(e));
        }
      } else {
        setWusdcBal(undefined);
        setWusdtBal(undefined);
      }
      if (hasUnderlying) {
        try {
          const u = await fetchUnderlyingStableBalances({
            rpcUrl,
            account,
            usdc,
            usdt,
          });
          setUsdcBal(u.usdc);
          setUsdtBal(u.usdt);
        } catch (e) {
          setUsdcBal(undefined);
          setUsdtBal(undefined);
          setEvmErr(e instanceof Error ? e.message : String(e));
        }
      } else {
        setUsdcBal(undefined);
        setUsdtBal(undefined);
      }
    } else {
      setEthBal(undefined);
      setWusdcBal(undefined);
      setWusdtBal(undefined);
      setUsdcBal(undefined);
      setUsdtBal(undefined);
    }

    const fetchCardanoSide = async (bech32: string) => {
      const ada = await fetchYaciAddressAda({ yaciStoreBaseUrl: yaciBase!, bech32 });
      let wusdc: string | undefined;
      let wusdt: string | undefined;
      if (cardWusdcUnit) {
        const q = await fetchYaciAddressNativeAssetQuantity({
          yaciStoreBaseUrl: yaciBase!,
          bech32,
          assetUnit: cardWusdcUnit,
        });
        wusdc = formatNativeUnits(q, cardanoNativeDecimals);
      }
      if (cardWusdtUnit) {
        const q = await fetchYaciAddressNativeAssetQuantity({
          yaciStoreBaseUrl: yaciBase!,
          bech32,
          assetUnit: cardWusdtUnit,
        });
        wusdt = formatNativeUnits(q, cardanoNativeDecimals);
      }
      return { ada, wusdc, wusdt };
    };

    if (yaciBase) {
      const clearCardanoBals = () => {
        setAdaSrcBal(undefined);
        setAdaDestBal(undefined);
        setNativeWusdcSrc(undefined);
        setNativeWusdtSrc(undefined);
        setNativeWusdcDest(undefined);
        setNativeWusdtDest(undefined);
      };

      if (!cardanoSource && !cardanoDest) {
        clearCardanoBals();
        setAdaErr(null);
      } else {
        const up = await isYaciStoreReachable(yaciBase);
        if (!up) {
          clearCardanoBals();
          setAdaErr(
            'Yaci Store not reachable (Vite often returns 503 when nothing listens on :8080). Start Yaci on port 8080, or clear VITE_YACI_STORE_URL to hide Cardano balances. See docs/CARDANO_LOCAL_YACI.md.',
          );
        } else {
          try {
            if (cardanoSource) {
              const s = await fetchCardanoSide(cardanoSource);
              setAdaSrcBal(s.ada);
              setNativeWusdcSrc(s.wusdc);
              setNativeWusdtSrc(s.wusdt);
            } else {
              setAdaSrcBal(undefined);
              setNativeWusdcSrc(undefined);
              setNativeWusdtSrc(undefined);
            }
            if (cardanoDest) {
              const d = await fetchCardanoSide(cardanoDest);
              setAdaDestBal(d.ada);
              setNativeWusdcDest(d.wusdc);
              setNativeWusdtDest(d.wusdt);
            } else {
              setAdaDestBal(undefined);
              setNativeWusdcDest(undefined);
              setNativeWusdtDest(undefined);
            }
            setAdaErr(null);
          } catch (e) {
            clearCardanoBals();
            setAdaErr(e instanceof Error ? e.message : String(e));
          }
        }
      }
    } else {
      setAdaSrcBal(undefined);
      setAdaDestBal(undefined);
      setNativeWusdcSrc(undefined);
      setNativeWusdtSrc(undefined);
      setNativeWusdcDest(undefined);
      setNativeWusdtDest(undefined);
      if (cardanoSource || cardanoDest) setAdaErr(null);
    }
  }, [
    account,
    rpcUrl,
    wusdc,
    wusdt,
    hasWrapped,
    hasUnderlying,
    usdc,
    usdt,
    cardanoSource,
    cardanoDest,
    yaciBase,
    cardWusdcUnit,
    cardWusdtUnit,
    cardanoNativeDecimals,
    refreshKey,
  ]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const id = window.setInterval(() => setRefreshKey((k) => k + 1), 12_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!contractAddress) return;
    void refreshLedger();
  }, [contractAddress, refreshKey, refreshLedger]);

  const evmSubtitle = useMemo(() => {
    if (!account) return 'Connect EVM or load demo wallets';
    return shortenAddress(account, { head: 10, tail: 8 });
  }, [account]);

  const cardanoSrcShort = useMemo(() => {
    if (!cardanoSource) return '—';
    return shortenAddress(cardanoSource, { head: 14, tail: 10 });
  }, [cardanoSource]);

  const cardanoDestShort = useMemo(() => {
    if (!cardanoDest) return '—';
    return shortenAddress(cardanoDest, { head: 14, tail: 10 });
  }, [cardanoDest]);

  const hasCardanoNativeCols = Boolean(cardWusdcUnit || cardWusdtUnit);

  const midnightShieldedShort = useMemo(() => {
    const w = walletAddress?.trim();
    if (w) return shortenAddress(w, { head: 14, tail: 10 });
    const ex = demo.midnight.shieldedExample?.trim();
    if (ex) return shortenAddress(ex, { head: 14, tail: 10 });
    return '—';
  }, [walletAddress, demo.midnight.shieldedExample]);

  const unshieldedShort = useMemo(() => {
    const u = unshieldedAddress?.trim();
    if (u) return shortenAddress(u, { head: 14, tail: 10 });
    const ex = demo.midnight.unshieldedExample?.trim();
    if (ex) return shortenAddress(ex, { head: 14, tail: 10 });
    return '—';
  }, [unshieldedAddress, demo.midnight.unshieldedExample]);

  const assetLabel = ledger ? (ledger.assetKind === 0 ? 'USDC' : 'USDT') : '';

  return (
    <div className="mb-4 rounded-2xl border border-teal-200/70 bg-gradient-to-br from-teal-50/80 to-white px-3 py-3 ring-1 ring-teal-100/80">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-teal-800">Bridged & demo balances</p>
          <p className="mt-0.5 text-[10px] leading-snug text-slate-500">
            Local Anvil + Yaci demo. Midnight shows zk-stables public ledger (circuit-backed) when you deploy/join below.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setRefreshKey((k) => k + 1);
            void refreshLedger();
          }}
          className="shrink-0 rounded-lg border border-teal-200/90 bg-white px-2.5 py-1 text-[10px] font-semibold text-teal-900 shadow-sm hover:bg-teal-50/90"
        >
          Refresh
        </button>
      </div>

      <div className="mt-3 space-y-3">
        <div>
          <p className="text-[9px] font-bold uppercase tracking-wide text-slate-600">EVM</p>
          <p className="mt-0.5 font-mono text-[11px] text-slate-600" title={account}>
            Account {evmSubtitle}
          </p>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            <div className="rounded-xl border border-white/80 bg-white/90 px-2 py-2 shadow-sm">
              <p className="text-[9px] font-bold uppercase tracking-wide text-slate-500">ETH</p>
              <p className="mt-0.5 text-base font-semibold tabular-nums tracking-tight text-slate-900">{fmtBal(ethBal)}</p>
            </div>
            <div className="rounded-xl border border-white/80 bg-white/90 px-2 py-2 shadow-sm">
              <p className="text-[9px] font-bold uppercase tracking-wide text-slate-500">mUSDC</p>
              <p className="mt-0.5 text-base font-semibold tabular-nums tracking-tight text-slate-900">
                {hasUnderlying ? fmtBal(usdcBal) : '—'}
              </p>
            </div>
            <div className="rounded-xl border border-white/80 bg-white/90 px-2 py-2 shadow-sm">
              <p className="text-[9px] font-bold uppercase tracking-wide text-slate-500">mUSDT</p>
              <p className="mt-0.5 text-base font-semibold tabular-nums tracking-tight text-slate-900">
                {hasUnderlying ? fmtBal(usdtBal) : '—'}
              </p>
            </div>
            <div className="rounded-xl border border-white/80 bg-white/90 px-2 py-2 shadow-sm">
              <p className="text-[9px] font-bold uppercase tracking-wide text-slate-500">zkUSDC</p>
              <p className="mt-0.5 text-base font-semibold tabular-nums tracking-tight text-slate-900">
                {hasWrapped ? fmtBal(wusdcBal) : '—'}
              </p>
            </div>
            <div className="rounded-xl border border-white/80 bg-white/90 px-2 py-2 shadow-sm sm:col-span-2 lg:col-span-1">
              <p className="text-[9px] font-bold uppercase tracking-wide text-slate-500">zkUSDT</p>
              <p className="mt-0.5 text-base font-semibold tabular-nums tracking-tight text-slate-900">
                {hasWrapped ? fmtBal(wusdtBal) : '—'}
              </p>
            </div>
          </div>
          {!hasUnderlying ? (
            <p className="mt-2 text-[9px] leading-snug text-slate-500">
              Set <code className="rounded bg-white px-0.5 font-mono text-[9px]">VITE_DEMO_USDC_ADDRESS</code> /{' '}
              <code className="rounded bg-white px-0.5 font-mono text-[9px]">VITE_DEMO_USDT_ADDRESS</code> for live mock underlying balances.
            </p>
          ) : null}
          {!hasWrapped ? (
            <p className="mt-1.5 text-[9px] leading-snug text-slate-500">
              Set <code className="rounded bg-white px-0.5 font-mono text-[9px]">VITE_DEMO_WUSDC_ADDRESS</code> /{' '}
              <code className="rounded bg-white px-0.5 font-mono text-[9px]">VITE_DEMO_WUSDT_ADDRESS</code> from the Anvil
              deploy JSON for bridge-minted <span className="font-medium">zkUSDC</span> / <span className="font-medium">zkUSDT</span> balances.
            </p>
          ) : null}
          {evmErr ? <p className="mt-1 text-[10px] leading-snug text-amber-800">EVM: {evmErr}</p> : null}
        </div>

        <div className="border-t border-teal-100/90 pt-3">
          <p className="text-[9px] font-bold uppercase tracking-wide text-slate-600">Cardano</p>
          <div className="mt-2 space-y-3">
            <div>
              <p className="font-mono text-[11px] text-slate-600" title={cardanoSource || undefined}>
                Source {cardanoSrcShort}
              </p>
              <div
                className={`mt-1.5 grid gap-2 ${hasCardanoNativeCols ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-1 sm:max-w-[11rem]'}`}
              >
                <div className="rounded-xl border border-white/80 bg-white/90 px-2 py-2 shadow-sm">
                  <p className="text-[9px] font-bold uppercase tracking-wide text-slate-500">ADA</p>
                  <p className="mt-0.5 text-base font-semibold tabular-nums tracking-tight text-slate-900">
                    {cardanoSource && yaciBase ? fmtBal(adaSrcBal) : '—'}
                  </p>
                </div>
                {cardWusdcUnit ? (
                  <div className="rounded-xl border border-white/80 bg-white/90 px-2 py-2 shadow-sm">
                    <p className="text-[9px] font-bold uppercase tracking-wide text-slate-500">zkUSDC</p>
                    <p className="mt-0.5 text-base font-semibold tabular-nums tracking-tight text-slate-900">
                      {cardanoSource && yaciBase ? fmtBal(nativeWusdcSrc) : '—'}
                    </p>
                  </div>
                ) : null}
                {cardWusdtUnit ? (
                  <div className="rounded-xl border border-white/80 bg-white/90 px-2 py-2 shadow-sm">
                    <p className="text-[9px] font-bold uppercase tracking-wide text-slate-500">zkUSDT</p>
                    <p className="mt-0.5 text-base font-semibold tabular-nums tracking-tight text-slate-900">
                      {cardanoSource && yaciBase ? fmtBal(nativeWusdtSrc) : '—'}
                    </p>
                  </div>
                ) : null}
              </div>
            </div>
            {cardanoDest ? (
              <div>
                <p className="font-mono text-[11px] text-slate-600" title={cardanoDest}>
                  Destination {cardanoDestShort}
                </p>
                <div
                  className={`mt-1.5 grid gap-2 ${hasCardanoNativeCols ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-1 sm:max-w-[11rem]'}`}
                >
                  <div className="rounded-xl border border-white/80 bg-white/90 px-2 py-2 shadow-sm">
                    <p className="text-[9px] font-bold uppercase tracking-wide text-slate-500">ADA</p>
                    <p className="mt-0.5 text-base font-semibold tabular-nums tracking-tight text-slate-900">
                      {yaciBase ? fmtBal(adaDestBal) : '—'}
                    </p>
                  </div>
                  {cardWusdcUnit ? (
                    <div className="rounded-xl border border-white/80 bg-white/90 px-2 py-2 shadow-sm">
                      <p className="text-[9px] font-bold uppercase tracking-wide text-slate-500">zkUSDC</p>
                      <p className="mt-0.5 text-base font-semibold tabular-nums tracking-tight text-slate-900">
                        {yaciBase ? fmtBal(nativeWusdcDest) : '—'}
                      </p>
                    </div>
                  ) : null}
                  {cardWusdtUnit ? (
                    <div className="rounded-xl border border-white/80 bg-white/90 px-2 py-2 shadow-sm">
                      <p className="text-[9px] font-bold uppercase tracking-wide text-slate-500">zkUSDT</p>
                      <p className="mt-0.5 text-base font-semibold tabular-nums tracking-tight text-slate-900">
                        {yaciBase ? fmtBal(nativeWusdtDest) : '—'}
                      </p>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
          {!yaciBase && (cardanoSource || cardanoDest) ? (
            <p className="mt-1.5 text-[9px] leading-snug text-slate-500">
              Set <code className="rounded bg-white px-0.5 font-mono text-[9px]">VITE_YACI_STORE_URL</code> (e.g.{' '}
              <span className="font-mono">/yaci-store</span> with Vite proxy) to load ADA and native assets from Yaci Store.
            </p>
          ) : null}
          {yaciBase && !hasCardanoNativeCols ? (
            <p className="mt-1.5 text-[9px] leading-snug text-slate-500">
              Optional: set <code className="rounded bg-white px-0.5 font-mono text-[9px]">VITE_CARDANO_WUSDC_UNIT</code> /{' '}
              <code className="rounded bg-white px-0.5 font-mono text-[9px]">VITE_CARDANO_WUSDT_UNIT</code> (full asset unit hex) to
              show minted native balances.
            </p>
          ) : null}
          {adaErr ? <p className="mt-1 text-[10px] leading-snug text-amber-800">Cardano: {adaErr}</p> : null}
        </div>

        <div className="border-t border-teal-100/90 pt-3">
          <p className="text-[9px] font-bold uppercase tracking-wide text-slate-600">Midnight</p>
          <p className="mt-0.5 font-mono text-[10px] leading-snug text-slate-600">
            Shielded {midnightShieldedShort}
            <span className="mx-1 text-slate-400">·</span>
            Unshielded {unshieldedShort}
          </p>
          <div className="mt-2 space-y-2">
            <div className="rounded-xl border border-violet-200/80 bg-violet-50/50 px-2.5 py-2 ring-1 ring-violet-100/80">
              <p className="text-[9px] font-bold uppercase tracking-wide text-violet-800">Bridge ledger (circuits)</p>
              <p className="mt-0.5 text-lg font-semibold tabular-nums tracking-tight text-slate-900">
                {ledger ? (
                  <>
                    {fmtLedgerAmount(ledger.amount)} <span className="text-base font-semibold text-violet-900">{assetLabel}</span>
                  </>
                ) : contractAddress ? (
                  <span className="text-base font-medium text-slate-500">—</span>
                ) : (
                  <span className="text-base font-medium text-slate-400">—</span>
                )}
              </p>
              {ledger ? (
                <p className="mt-1 text-[9px] leading-snug text-violet-900/80">
                  State {ledger.stateLabel}; minted unshielded {String(ledger.mintedUnshielded)}; released{' '}
                  {String(ledger.unshieldedReleased)}
                </p>
              ) : null}
              <p className="mt-1 text-[9px] leading-snug text-slate-600">
                Public <span className="font-medium">zk-stables</span> contract state from the indexer — amounts change when you run
                circuit txs (<span className="font-mono">proveHolder</span>, <span className="font-mono">mintWrappedUnshielded</span>, burn
                flow).
              </p>
              {contractAddress && !ledger ? (
                <p className="mt-1 text-[9px] leading-snug text-amber-800/90">
                  No ledger row from the indexer yet — check the Midnight indexer, then press Refresh or use Developer tools → On-chain
                  bridge state.
                </p>
              ) : null}
            </div>
            {!contractAddress ? (
              <p className="text-[9px] leading-snug text-slate-500">
                {demo.midnight.note?.trim() ||
                  'Connect Lace or dev seed in Developer tools, then deploy or join a contract to load ledger balances.'}
              </p>
            ) : null}
          </div>
        </div>
      </div>

      <p className="mt-3 text-[9px] leading-snug text-slate-500">
        Mock USDC/USDT and demo keys are in the table below. zkUSDC/zkUSDT are proof-gated bridge mints on Anvil (see docs/BRIDGE_SWAP_FLOW.md).
      </p>
    </div>
  );
};
