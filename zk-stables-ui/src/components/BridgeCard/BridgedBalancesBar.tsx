import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useConnection } from 'wagmi';
import { formatUnits, type Address } from 'viem';
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
  resolveYaciStoreBaseUrl,
} from '../../lib/yaciAddressBalance.js';
import { useZkStables } from '../../hooks/useZkStables.js';
import { useCrossChainWallets } from '../../contexts/CrossChainWalletContext.js';
import type { DemoWalletsResponse } from '../../lib/relayerClient.js';
import { defaultRelayerBaseUrl, fetchMidnightContract } from '../../lib/relayerClient.js';
import { shortenAddress } from '../../utils/formatAddress.js';
import { REGISTRY_DEPOSIT_STATUS_BURNED } from '../../constants/registryDepositStatus.js';

async function deriveHex32FromGenesis(seedHex: string, label: string): Promise<string> {
  const input = `${label}:${seedHex.trim().replace(/^0x/, '').toLowerCase()}`;
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function fmtBal(s: string | undefined): string {
  if (s === undefined) return '—';
  const n = Number(s);
  if (Number.isNaN(n)) return s;
  if (n === 0) return '0';
  if (n >= 1_000_000) return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return n.toLocaleString(undefined, { maximumFractionDigits: 6 });
}

/** Thousands separators for bigints (regex grouping can look odd with `break-all`). */
function fmtLedgerAmount(n: bigint): string {
  let s = n.toString();
  const neg = s.startsWith('-');
  if (neg) s = s.slice(1);
  const parts: string[] = [];
  while (s.length > 3) {
    parts.unshift(s.slice(-3));
    s = s.slice(0, -3);
  }
  if (s) parts.unshift(s);
  return (neg ? '-' : '') + parts.join(',');
}

/** zkUSDC / zkUSDT on Midnight use 6 fixed decimals (micro-units). */
const ZK_LEDGER_MICRO_DECIMALS = 6;

/** Human-readable amount from atomic bigint (e.g. 451000000 + 6 decimals → "451"). */
function formatHumanAtomicUnits(raw: bigint, decimals: number): string {
  if (decimals < 0 || decimals > 36) return raw.toString();
  if (raw === 0n) return '0';
  const s = formatUnits(raw, decimals);
  const neg = s.startsWith('-');
  const t = neg ? s.slice(1) : s;
  const [whole, frac = ''] = t.split('.');
  const intFmt = BigInt(whole).toLocaleString(undefined, { maximumFractionDigits: 0 });
  const fracTrim = frac.replace(/0+$/, '');
  if (!fracTrim) return (neg ? '-' : '') + intFmt;
  return (neg ? '-' : '') + `${intFmt}.${fracTrim}`;
}

function formatZkMicroTokenUnits(raw: bigint): string {
  return formatHumanAtomicUnits(raw, ZK_LEDGER_MICRO_DECIMALS);
}

/** Yaci returns native token quantity as a decimal string of atomics — same 6dp as bridge zk. */
function formatCardanoNativeZkDisplay(raw: string | undefined, decimals: number): string {
  if (raw === undefined || !String(raw).trim()) return '—';
  const t = String(raw).trim().replace(/\s/gu, '').split('.')[0] ?? '';
  if (!t || !/^-?\d+$/u.test(t)) return raw;
  try {
    return formatHumanAtomicUnits(BigInt(t), decimals);
  } catch {
    return raw;
  }
}

/** Long unshielded amounts: scroll horizontally inside the cell instead of breaking digits. */
function midnightBalClassName(): string {
  return 'mt-0.5 max-w-full overflow-x-auto whitespace-nowrap text-right text-base font-semibold tabular-nums tracking-tight text-slate-900';
}

export const BridgedBalancesBar: React.FC<{ demo: DemoWalletsResponse }> = ({ demo }) => {
  const {
    ledger,
    contractAddress,
    walletAddress,
    unshieldedAddress,
    unshieldedBalances,
    refreshLedger,
    isConnected: midnightConnected,
    isConnecting: midnightConnecting,
    connectDevSeedWallet,
    connectAndJoin,
    setDeployParams,
  } = useZkStables();
  const rpcUrl = import.meta.env.VITE_ETH_LOCALHOST_RPC_URL || 'http://127.0.0.1:8545';
  const usdc = parseEnvEthereumAddress(import.meta.env.VITE_DEMO_USDC_ADDRESS);
  const usdt = parseEnvEthereumAddress(import.meta.env.VITE_DEMO_USDT_ADDRESS);
  const wusdc = parseEnvEthereumAddress(import.meta.env.VITE_DEMO_WUSDC_ADDRESS);
  const wusdt = parseEnvEthereumAddress(import.meta.env.VITE_DEMO_WUSDT_ADDRESS);

  const { address: connected } = useConnection();
  const fallback = demo.evm.accounts[0]?.address as Address | undefined;
  const account = (connected ?? fallback) as Address | undefined;

  const { cardanoMeshChangeBech32 } = useCrossChainWallets();

  const relayerCardanoSrc = demo.cardano.addresses.find((a) => a.role === 'source')?.bech32?.trim() ?? '';
  const relayerCardanoDst = demo.cardano.addresses.find((a) => a.role === 'destination')?.bech32?.trim() ?? '';
  /**
   * Relayer `GET /v1/demo/wallets` bech32 often ≠ Mesh `getChangeAddress()` for the same mnemonic.
   * Yaci balances for redeem/burn must follow the address you actually sign with, or totals never move.
   */
  const cardanoSource = (cardanoMeshChangeBech32?.trim() || relayerCardanoSrc).trim();
  const cardanoDest = (cardanoMeshChangeBech32?.trim() || relayerCardanoDst).trim();
  const cardanoBalanceFollowsMeshChange = Boolean(cardanoMeshChangeBech32?.trim());
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
  const [midnightErr, setMidnightErr] = useState<string | null>(null);
  const [midnightBusy, setMidnightBusy] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const midnightAutoConnectAttempted = useRef(false);

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
    cardanoMeshChangeBech32,
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
    const ms = yaciBase ? 5_000 : 12_000;
    const id = window.setInterval(() => setRefreshKey((k) => k + 1), ms);
    return () => window.clearInterval(id);
  }, [yaciBase]);

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'visible') setRefreshKey((k) => k + 1);
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  useEffect(() => {
    if (!contractAddress) return;
    void refreshLedger();
  }, [contractAddress, refreshKey, refreshLedger]);

  const connectMidnight = useCallback(async () => {
    setMidnightErr(null);
    setMidnightBusy(true);
    try {
      const seedHash = (import.meta.env.VITE_GENESIS_SEED_HASH_HEX ?? '').trim();
      if (!seedHash || seedHash.length !== 64) {
        setMidnightErr('VITE_GENESIS_SEED_HASH_HEX not set');
        return;
      }
      const [opSk, hlSk] = await Promise.all([
        deriveHex32FromGenesis(seedHash, 'zkstables:operatorSk:v1'),
        deriveHex32FromGenesis(seedHash, 'zkstables:holderSk:v1'),
      ]);
      setDeployParams((prev) => ({
        ...prev,
        operatorSkHex: opSk,
        holderSkHex: hlSk,
      }));
      await connectDevSeedWallet(seedHash);
      const relayer = defaultRelayerBaseUrl();
      const mc = await fetchMidnightContract(relayer);
      if (mc.contractAddress) {
        await connectAndJoin(mc.contractAddress, { operatorSkHex: opSk, holderSkHex: hlSk });
      } else {
        setMidnightErr('Relayer has no Midnight contract deployed yet');
      }
    } catch (e) {
      setMidnightErr(e instanceof Error ? e.message : String(e));
    } finally {
      setMidnightBusy(false);
    }
  }, [connectDevSeedWallet, connectAndJoin, setDeployParams]);

  useEffect(() => {
    if (midnightConnected || midnightConnecting || midnightAutoConnectAttempted.current) return;
    const seedHash = (import.meta.env.VITE_GENESIS_SEED_HASH_HEX ?? '').trim();
    if (!seedHash || seedHash.length !== 64) return;
    midnightAutoConnectAttempted.current = true;
    void connectMidnight();
  }, [midnightConnected, midnightConnecting, connectMidnight]);

  const evmSubtitle = useMemo(() => {
    if (!account) return 'Connect EVM wallet';
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

  const NATIVE_TOKEN_HEX = '00'.repeat(32);

  const midnightTokenEntries = useMemo(() => {
    if (!midnightConnected || !unshieldedBalances) return [];
    return Object.entries(unshieldedBalances)
      .filter(([, v]) => v > 0n)
      .map(([tokenType, amount]) => {
        const isNative = tokenType === NATIVE_TOKEN_HEX || tokenType === '';
        let label = 'zkUSDC';
        if (isNative) {
          label = 'tDUST';
        } else if (ledger && ledger.deposits.length > 0) {
          const hasUsdt = ledger.deposits.some((d) => d.assetKind === 1);
          if (hasUsdt) label = 'zkUSDT';
        }
        return { tokenType, label, amount, isNative };
      });
  }, [midnightConnected, unshieldedBalances, ledger]);

  const midnightZkUsdcBal = useMemo(() => {
    const nonNative = midnightTokenEntries.filter((e) => !e.isNative && e.label === 'zkUSDC');
    return nonNative.reduce((sum, e) => sum + e.amount, 0n);
  }, [midnightTokenEntries]);

  const midnightZkUsdtBal = useMemo(() => {
    const nonNative = midnightTokenEntries.filter((e) => !e.isNative && e.label === 'zkUSDT');
    return nonNative.reduce((sum, e) => sum + e.amount, 0n);
  }, [midnightTokenEntries]);

  const midnightTdustBal = useMemo(() => {
    const native = midnightTokenEntries.filter((e) => e.isNative);
    return native.reduce((sum, e) => sum + e.amount, 0n);
  }, [midnightTokenEntries]);

  /** Contract ledger amounts (6 decimals) — these move to “Wallet · zk*” only after `sendWrappedUnshieldedToUser`. Burned rows are excluded. */
  const registryUsdcSum = useMemo(() => {
    if (!ledger?.deposits.length) return 0n;
    return ledger.deposits
      .filter((d) => d.status !== REGISTRY_DEPOSIT_STATUS_BURNED && d.assetKind === 0)
      .reduce((s, d) => {
        const a = d.amount;
        const bi = typeof a === 'bigint' ? a : BigInt(String(a ?? '0'));
        return s + bi;
      }, 0n);
  }, [ledger]);
  const registryUsdtSum = useMemo(() => {
    if (!ledger?.deposits.length) return 0n;
    return ledger.deposits
      .filter((d) => d.status !== REGISTRY_DEPOSIT_STATUS_BURNED && d.assetKind === 1)
      .reduce((s, d) => {
        const a = d.amount;
        const bi = typeof a === 'bigint' ? a : BigInt(String(a ?? '0'));
        return s + bi;
      }, 0n);
  }, [ledger]);
  const registryOpenDepositCount = useMemo(
    () => (ledger ? ledger.deposits.filter((d) => d.status !== REGISTRY_DEPOSIT_STATUS_BURNED).length : 0),
    [ledger],
  );
  const registryBurnedDepositCount = useMemo(
    () => (ledger ? ledger.deposits.filter((d) => d.status === REGISTRY_DEPOSIT_STATUS_BURNED).length : 0),
    [ledger],
  );

  return (
    <div className="mb-4 rounded-2xl border border-teal-200/70 bg-gradient-to-br from-teal-50/80 to-white px-3 py-3 ring-1 ring-teal-100/80">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-teal-800">Balances</p>
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
          {evmErr ? <p className="mt-1 text-[10px] leading-snug text-amber-800">{evmErr}</p> : null}
        </div>

        <div className="border-t border-teal-100/90 pt-3">
          <p className="text-[9px] font-bold uppercase tracking-wide text-slate-600">Cardano</p>
          <div className="mt-2 space-y-3">
            <div>
              <p className="font-mono text-[11px] text-slate-600" title={cardanoSource || undefined}>
                Source {cardanoSrcShort}
              </p>
              <div
                className={`mt-1.5 grid min-w-0 gap-2 ${hasCardanoNativeCols ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-1 sm:max-w-[11rem]'}`}
              >
                <div className="min-w-0 rounded-xl border border-white/80 bg-white/90 px-2 py-2 shadow-sm">
                  <p className="text-[9px] font-bold uppercase tracking-wide text-slate-500">ADA</p>
                  <p className="mt-0.5 max-w-full overflow-x-auto whitespace-nowrap text-base font-semibold tabular-nums tracking-tight text-slate-900">
                    {cardanoSource && yaciBase ? fmtBal(adaSrcBal) : '—'}
                  </p>
                </div>
                {cardWusdcUnit ? (
                  <div className="min-w-0 rounded-xl border border-white/80 bg-white/90 px-2 py-2 shadow-sm">
                    <p className="text-[9px] font-bold uppercase tracking-wide text-slate-500">zkUSDC</p>
                    <p
                      className="mt-0.5 max-w-full overflow-x-auto whitespace-nowrap text-base font-semibold tabular-nums tracking-tight text-slate-900"
                      title={cardanoSource && yaciBase && nativeWusdcSrc ? fmtLedgerAmount(BigInt(nativeWusdcSrc.split('.')[0] ?? nativeWusdcSrc)) : undefined}
                    >
                      {cardanoSource && yaciBase ? formatCardanoNativeZkDisplay(nativeWusdcSrc, cardanoNativeDecimals) : '—'}
                    </p>
                  </div>
                ) : null}
                {cardWusdtUnit ? (
                  <div className="min-w-0 rounded-xl border border-white/80 bg-white/90 px-2 py-2 shadow-sm">
                    <p className="text-[9px] font-bold uppercase tracking-wide text-slate-500">zkUSDT</p>
                    <p
                      className="mt-0.5 max-w-full overflow-x-auto whitespace-nowrap text-base font-semibold tabular-nums tracking-tight text-slate-900"
                      title={cardanoSource && yaciBase && nativeWusdtSrc ? fmtLedgerAmount(BigInt(nativeWusdtSrc.split('.')[0] ?? nativeWusdtSrc)) : undefined}
                    >
                      {cardanoSource && yaciBase ? formatCardanoNativeZkDisplay(nativeWusdtSrc, cardanoNativeDecimals) : '—'}
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
                  className={`mt-1.5 grid min-w-0 gap-2 ${hasCardanoNativeCols ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-1 sm:max-w-[11rem]'}`}
                >
                  <div className="min-w-0 rounded-xl border border-white/80 bg-white/90 px-2 py-2 shadow-sm">
                    <p className="text-[9px] font-bold uppercase tracking-wide text-slate-500">ADA</p>
                    <p className="mt-0.5 max-w-full overflow-x-auto whitespace-nowrap text-base font-semibold tabular-nums tracking-tight text-slate-900">
                      {yaciBase ? fmtBal(adaDestBal) : '—'}
                    </p>
                  </div>
                  {cardWusdcUnit ? (
                    <div className="min-w-0 rounded-xl border border-white/80 bg-white/90 px-2 py-2 shadow-sm">
                      <p className="text-[9px] font-bold uppercase tracking-wide text-slate-500">zkUSDC</p>
                      <p
                        className="mt-0.5 max-w-full overflow-x-auto whitespace-nowrap text-base font-semibold tabular-nums tracking-tight text-slate-900"
                        title={yaciBase && nativeWusdcDest ? fmtLedgerAmount(BigInt(nativeWusdcDest.split('.')[0] ?? nativeWusdcDest)) : undefined}
                      >
                        {yaciBase ? formatCardanoNativeZkDisplay(nativeWusdcDest, cardanoNativeDecimals) : '—'}
                      </p>
                    </div>
                  ) : null}
                  {cardWusdtUnit ? (
                    <div className="min-w-0 rounded-xl border border-white/80 bg-white/90 px-2 py-2 shadow-sm">
                      <p className="text-[9px] font-bold uppercase tracking-wide text-slate-500">zkUSDT</p>
                      <p
                        className="mt-0.5 max-w-full overflow-x-auto whitespace-nowrap text-base font-semibold tabular-nums tracking-tight text-slate-900"
                        title={yaciBase && nativeWusdtDest ? fmtLedgerAmount(BigInt(nativeWusdtDest.split('.')[0] ?? nativeWusdtDest)) : undefined}
                      >
                        {yaciBase ? formatCardanoNativeZkDisplay(nativeWusdtDest, cardanoNativeDecimals) : '—'}
                      </p>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
          {adaErr ? <p className="mt-1 text-[10px] leading-snug text-amber-800">{adaErr}</p> : null}
          {yaciBase && (cardanoSource || cardanoDest) ? (
            <p className="mt-1.5 text-[9px] leading-snug text-slate-500">
              Figures are <strong>live</strong> Yaci Store <strong>payment-address UTxOs</strong> only: burned or spent native zk no longer exists at that address
              and drops out of these totals (same idea as Midnight registry totals omitting <strong>Burned</strong>). zk at the bridge{' '}
              <code className="rounded bg-slate-100 px-0.5">lock_pool</code> script is not counted here. Refresh every ~5s or use Refresh.
              {cardanoBalanceFollowsMeshChange ? (
                <>
                  {' '}
                  <strong>Cardano rows</strong> use your in-app mnemonic wallet&apos;s Mesh <strong>change address</strong> (signing wallet), not only the relayer
                  demo bech32 from <code className="rounded bg-slate-100 px-0.5">/v1/demo/wallets</code>, so redeem/burn deductions match what you sign.
                </>
              ) : null}
            </p>
          ) : null}
        </div>

        <div className="border-t border-teal-100/90 pt-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[9px] font-bold uppercase tracking-wide text-slate-600">Midnight</p>
            {!midnightConnected && (
              <button
                type="button"
                disabled={midnightBusy || midnightConnecting}
                onClick={() => void connectMidnight()}
                className="shrink-0 rounded-lg border border-violet-200/90 bg-white px-2.5 py-1 text-[10px] font-semibold text-violet-900 shadow-sm hover:bg-violet-50/90 disabled:opacity-50"
              >
                {midnightBusy || midnightConnecting ? 'Connecting…' : 'Connect'}
              </button>
            )}
          </div>
          {midnightConnected && (walletAddress || unshieldedAddress) ? (
            <p className="mt-0.5 font-mono text-[10px] leading-snug text-slate-600">
              {walletAddress ? <>Shielded {shortenAddress(walletAddress, { head: 14, tail: 10 })}</> : null}
              {walletAddress && unshieldedAddress ? <span className="mx-1 text-slate-400">·</span> : null}
              {unshieldedAddress ? <>Unshielded {shortenAddress(unshieldedAddress, { head: 14, tail: 10 })}</> : null}
            </p>
          ) : !midnightConnected ? (
            <p className="mt-0.5 text-[10px] text-slate-400">Not connected</p>
          ) : null}
          {midnightErr ? <p className="mt-1 text-[10px] leading-snug text-amber-800">{midnightErr}</p> : null}
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="min-w-0 rounded-xl border border-violet-200/80 bg-violet-50/50 px-2 py-2 ring-1 ring-violet-100/80">
              <p className="text-[9px] font-bold uppercase tracking-wide text-violet-800">tDUST</p>
              <p className={midnightBalClassName()}>{midnightConnected ? fmtLedgerAmount(midnightTdustBal) : '—'}</p>
            </div>
            <div className="min-w-0 rounded-xl border border-violet-200/80 bg-violet-50/50 px-2 py-2 ring-1 ring-violet-100/80">
              <p className="text-[9px] font-bold uppercase tracking-wide text-violet-800">Wallet · zkUSDC</p>
              <p className={midnightBalClassName()} title={midnightConnected ? fmtLedgerAmount(midnightZkUsdcBal) : undefined}>
                {midnightConnected ? formatZkMicroTokenUnits(midnightZkUsdcBal) : '—'}
              </p>
            </div>
            <div className="min-w-0 rounded-xl border border-violet-200/80 bg-violet-50/50 px-2 py-2 ring-1 ring-violet-100/80">
              <p className="text-[9px] font-bold uppercase tracking-wide text-violet-800">Wallet · zkUSDT</p>
              <p className={midnightBalClassName()} title={midnightConnected ? fmtLedgerAmount(midnightZkUsdtBal) : undefined}>
                {midnightConnected ? formatZkMicroTokenUnits(midnightZkUsdtBal) : '—'}
              </p>
            </div>
            <div
              className="min-w-0 rounded-xl border border-violet-200/80 bg-violet-50/50 px-2 py-2 ring-1 ring-violet-100/80"
              title={
                ledger && registryBurnedDepositCount > 0
                  ? `${registryOpenDepositCount} not burned on-chain; ${registryBurnedDepositCount} burned (historic keys)`
                  : 'Registry deposit keys not in Burned state'
              }
            >
              <p className="text-[9px] font-bold uppercase tracking-wide text-violet-800">Deposits</p>
              <p className={midnightBalClassName()}>{midnightConnected && ledger ? registryOpenDepositCount : '—'}</p>
            </div>
          </div>
          {midnightConnected && ledger ? (
            <div className="mt-2 rounded-lg border border-violet-200/70 bg-white/80 px-2.5 py-2 ring-1 ring-violet-100/60">
              <p className="text-[9px] font-bold uppercase tracking-wide text-violet-900">Registry (minted on contract)</p>
              <p
                className="mt-1 font-mono text-[12px] font-semibold tabular-nums leading-snug text-slate-900"
                title={`Raw micro-units — zkUSDC ${fmtLedgerAmount(registryUsdcSum)}, zkUSDT ${fmtLedgerAmount(registryUsdtSum)}`}
              >
                zkUSDC {formatZkMicroTokenUnits(registryUsdcSum)}
                <span className="mx-1.5 font-sans font-normal text-slate-400">·</span>
                zkUSDT {formatZkMicroTokenUnits(registryUsdtSum)}
                <span className="ml-2 font-sans text-[10px] font-normal text-slate-500">
                  ({registryOpenDepositCount} open
                  {registryBurnedDepositCount > 0
                    ? `, ${registryBurnedDepositCount} burned`
                    : ''}
                  )
                </span>
              </p>
              <p className="mt-1 text-[9px] leading-snug text-slate-500">
                This is the zk-stables-registry ledger, not your unshielded wallet. Totals and “open” count omit deposits in{' '}
                <strong>Burned</strong> state (value destroyed after <code className="rounded bg-violet-100/80 px-0.5">finalizeBurn</code>
                ). Wallet columns stay 0 until{' '}
                <code className="rounded bg-violet-100/80 px-0.5">sendWrappedUnshieldedToUser</code> runs in redeem/burn.
              </p>
            </div>
          ) : null}
          {midnightConnected ? (
            <p className="mt-2 text-[10px] leading-snug text-slate-500">
              <strong>Deposits</strong> = registry tickets not yet burned on-chain (same “gone from supply” view as Cardano figures: only what still exists is
              counted). <strong>Wallet · zk*</strong> = unshielded balances at your address only.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
};
