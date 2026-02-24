import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useConnection } from 'wagmi';
import { useCrossChainWallets, type SourceChainKind } from '../../contexts/CrossChainWalletContext.js';
import {
  assetKindForLabel,
  getRelayerJob,
  submitBurnIntent,
  submitLockIntent,
  type BurnIntentPayload,
  type DemoWalletsResponse,
  type LockIntentPayload,
  type RelayerJobApi,
} from '../../lib/relayerClient.js';
import { WalletPill, type ChainVisual } from './WalletPill.js';
import { BridgeChainRow } from './BridgeChainRow.js';
import { ReviewSheet } from './ReviewSheet.js';
import { cn } from '../../utils/cn.js';

type ChainChoice = SourceChainKind;

function randomBytes32Hex(): string {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

function chainToLabel(c: ChainChoice): string {
  if (c === 'evm') return 'EVM';
  if (c === 'cardano') return 'Cardano';
  return 'Midnight';
}

function destinationApiLabel(c: ChainChoice): string {
  return c;
}

const selectChevron =
  "appearance-none bg-[length:1.125rem] bg-[right_0.65rem_center] bg-no-repeat pr-9 bg-[url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%2364748b'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'/%3E%3C/svg%3E\")]";

const inputCls =
  'w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-900 shadow-sm outline-none transition-[box-shadow,border-color] placeholder:text-slate-400 focus:border-teal-600 focus:ring-2 focus:ring-teal-600/20';

const selectCls = cn(
  selectChevron,
  'cursor-pointer rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-900 shadow-sm outline-none transition-[box-shadow,border-color] focus:border-teal-600 focus:ring-2 focus:ring-teal-600/20',
);

const secondaryBtn =
  'inline-flex items-center justify-center rounded-lg border border-slate-200/90 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-sm transition-all hover:border-slate-300 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/35 disabled:cursor-not-allowed disabled:opacity-40 motion-safe:active:scale-[0.98]';

const ghostBtn = cn(secondaryBtn, 'border-transparent bg-transparent shadow-none hover:bg-slate-100/80');

export const BridgeForm: React.FC<{
  demo: DemoWalletsResponse;
  relayerUrl: string;
  onJobUpdate: (job: RelayerJobApi | null) => void;
}> = ({ demo, relayerUrl, onJobUpdate }) => {
  const { address: evmAddress, isConnected: evmConnected } = useConnection();
  const { cardanoUsedAddressesHex, cardanoWalletKey } = useCrossChainWallets();

  const [bridgeTab, setBridgeTab] = useState(0);
  const operation: 'LOCK' | 'BURN' = bridgeTab === 0 ? 'LOCK' : 'BURN';

  const [sourceChain, setSourceChain] = useState<ChainChoice>('evm');
  const [destChain, setDestChain] = useState<ChainChoice>('midnight');
  const [asset, setAsset] = useState<'USDC' | 'USDT'>('USDC');
  const [amount, setAmount] = useState('100');
  const [recipient, setRecipient] = useState('');
  const [burnCommitmentHex, setBurnCommitmentHex] = useState(randomBytes32Hex);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPoll = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => () => stopPoll(), [stopPoll]);

  const evm0 = demo.evm.accounts[0]?.address;
  const evm1 = demo.evm.accounts[1]?.address ?? demo.evm.accounts[0]?.address;
  const adaSrc = demo.cardano.addresses.find((a) => a.role === 'source')?.bech32 ?? '';
  const adaDst = demo.cardano.addresses.find((a) => a.role === 'destination')?.bech32 ?? adaSrc;

  const lockNeedsNonMidnightRecipient = operation === 'LOCK' && sourceChain === 'midnight';
  const burnNeedsSourceRecipient = operation === 'BURN';

  const applyRecipientDefaults = useCallback(() => {
    if (operation === 'LOCK') {
      if (sourceChain === 'midnight') {
        if (destChain === 'evm' && evm0) setRecipient(evm0);
        else if (destChain === 'cardano') setRecipient(adaDst);
        return;
      }
      if (destChain === 'midnight') setRecipient(demo.midnight.shieldedExample);
      else if (destChain === 'cardano') setRecipient(adaDst);
      else if (destChain === 'evm') setRecipient((evm1 ?? evm0) || '');
      return;
    }
    if (operation === 'BURN') {
      if (sourceChain === 'evm' && evm0) setRecipient(evm0);
      else if (sourceChain === 'cardano') setRecipient(cardanoUsedAddressesHex[0] || adaSrc);
      else if (sourceChain === 'midnight') setRecipient(evm0 || adaSrc);
    }
  }, [
    operation,
    sourceChain,
    destChain,
    demo.midnight.shieldedExample,
    evm0,
    evm1,
    adaDst,
    adaSrc,
    cardanoUsedAddressesHex,
  ]);

  useEffect(() => {
    applyRecipientDefaults();
  }, [applyRecipientDefaults]);

  const recipientHelper = useMemo(() => {
    if (operation === 'BURN') {
      return 'Unlock recipient on the source chain: EVM (0x…), Cardano (addr1…), or Midnight (mn_*).';
    }
    if (sourceChain === 'midnight') {
      if (destChain === 'evm') return 'EVM address (0x…) that should receive minted wrapped stables.';
      if (destChain === 'cardano') return 'Cardano bech32 (addr1… / addr_test1…) for native payout.';
    }
    if (destChain === 'midnight') return 'Midnight shielded (mn_…1…) or unshielded (mn_addr_…) destination.';
    if (destChain === 'cardano') return 'Cardano bech32 where the relayer sends the bridge payout.';
    if (destChain === 'evm') return 'EVM address (0x…) for ZkStablesBridgeMint.';
    return 'Recipient';
  }, [operation, sourceChain, destChain]);

  useEffect(() => {
    if (operation === 'BURN') {
      setBurnCommitmentHex(randomBytes32Hex());
    }
  }, [operation, sourceChain]);

  const ensureDistinctChains = useCallback(() => {
    if (operation === 'LOCK' && sourceChain === destChain) {
      const order: ChainChoice[] = ['evm', 'cardano', 'midnight'];
      const next = order.find((c) => c !== sourceChain) ?? 'midnight';
      setDestChain(next);
    }
  }, [operation, sourceChain, destChain]);

  useEffect(() => {
    ensureDistinctChains();
  }, [operation, sourceChain, ensureDistinctChains]);

  const swapChains = useCallback(() => {
    if (operation !== 'LOCK') return;
    setSourceChain(destChain);
    setDestChain(sourceChain);
  }, [operation, sourceChain, destChain]);

  const sourceVisual: ChainVisual = sourceChain;
  const destVisual: ChainVisual = destChain;

  const sourcePillAddress = useMemo(() => {
    if (sourceChain === 'evm') return evmConnected && evmAddress ? evmAddress : (evm0 ?? '');
    if (sourceChain === 'cardano') return cardanoUsedAddressesHex[0] || adaSrc;
    return demo.midnight.shieldedExample;
  }, [sourceChain, evmConnected, evmAddress, evm0, cardanoUsedAddressesHex, adaSrc, demo.midnight.shieldedExample]);

  const destPillAddress = useMemo(() => {
    if (operation === 'BURN') return sourcePillAddress;
    if (destChain === 'evm') return evm1 ?? evm0 ?? '';
    if (destChain === 'cardano') return adaDst;
    return demo.midnight.shieldedExample;
  }, [operation, destChain, sourcePillAddress, evm1, evm0, adaDst, demo.midnight.shieldedExample]);

  const maxBalance = asset === 'USDC' ? demo.demoBalances.usdc : demo.demoBalances.usdt;
  const fiatApprox = useMemo(() => {
    const n = Number.parseFloat(amount.replace(/,/g, ''));
    if (Number.isNaN(n)) return '—';
    return `$${(n * 1).toFixed(2)}`;
  }, [amount]);

  const buildPayload = useCallback((): LockIntentPayload | BurnIntentPayload | null => {
    const r = recipient.trim();
    if (!r) return null;
    const destLabel = operation === 'LOCK' ? destinationApiLabel(destChain) : undefined;
    const bc = burnCommitmentHex.replace(/^0x/i, '').trim();
    if (operation === 'BURN') {
      if (bc.length !== 64 || !/^[0-9a-fA-F]+$/.test(bc)) return null;
    }
    const connected = {
      evm: evmConnected ? evmAddress : undefined,
      cardano: cardanoWalletKey ? cardanoUsedAddressesHex[0] : undefined,
    };
    if (operation === 'BURN') {
      return {
        operation: 'BURN',
        sourceChain,
        destinationChain: destLabel,
        asset,
        assetKind: assetKindForLabel(asset),
        amount,
        recipient: r,
        burnCommitmentHex: bc,
        connected,
        note: 'BURN intent via bridge UI (zk-stables-relayer).',
      };
    }
    return {
      operation: 'LOCK',
      sourceChain,
      destinationChain: destLabel,
      asset,
      assetKind: assetKindForLabel(asset),
      amount,
      recipient: r,
      connected,
      note: 'LOCK intent via bridge UI (zk-stables-relayer).',
    };
  }, [
    recipient,
    operation,
    destChain,
    sourceChain,
    asset,
    amount,
    burnCommitmentHex,
    evmConnected,
    evmAddress,
    cardanoWalletKey,
    cardanoUsedAddressesHex,
  ]);

  const submit = useCallback(async () => {
    const payload = buildPayload();
    if (!payload) {
      setError(
        operation === 'BURN'
          ? 'Add a recipient and a valid 64-character burn commitment (hex).'
          : 'Add a recipient before submitting.',
      );
      return;
    }
    setError(null);
    setSubmitting(true);
    stopPoll();
    onJobUpdate(null);
    try {
      const { job } =
        payload.operation === 'LOCK'
          ? await submitLockIntent(relayerUrl, payload)
          : await submitBurnIntent(relayerUrl, payload);
      onJobUpdate(job);
      pollRef.current = setInterval(async () => {
        try {
          const j = await getRelayerJob(relayerUrl, job.id);
          if (j) {
            onJobUpdate(j);
            if (j.phase === 'completed' || j.phase === 'failed') stopPoll();
          }
        } catch {
          /* ignore */
        }
      }, 400);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
      setReviewOpen(false);
    }
  }, [buildPayload, operation, relayerUrl, onJobUpdate, stopPoll]);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-2">
        <div className="flex flex-1 rounded-xl bg-slate-100/90 p-1 ring-1 ring-slate-200/60">
          <button
            type="button"
            onClick={() => setBridgeTab(0)}
            className={cn(
              'flex-1 rounded-lg py-2.5 text-sm font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/35',
              bridgeTab === 0 ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800',
            )}
          >
            Mint
          </button>
          <button
            type="button"
            onClick={() => setBridgeTab(1)}
            className={cn(
              'flex-1 rounded-lg py-2.5 text-sm font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/35',
              bridgeTab === 1 ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800',
            )}
          >
            Burn
          </button>
        </div>
        <button
          type="button"
          title="Demo & relayer info"
          aria-label="Demo and relayer info"
          onClick={() => setSettingsOpen((o) => !o)}
          className="rounded-xl p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
        >
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <circle cx="12" cy="12" r="3" />
            <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
          </svg>
        </button>
      </div>

      {settingsOpen ? (
        <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-xs leading-relaxed text-slate-700">
          <div className="flex justify-between gap-2">
            <span className="font-medium text-slate-900">Demo</span>
            <button type="button" className="text-slate-400 hover:text-slate-600" onClick={() => setSettingsOpen(false)} aria-label="Close">
              ×
            </button>
          </div>
          <p className="mt-1">{demo.warning}</p>
          <p className="mt-2 font-mono text-[11px] text-slate-600">
            Relayer: {relayerUrl}
          </p>
          {demo.evm.mnemonic ? (
            <p className="mt-2 break-words font-mono text-[11px] text-slate-600">EVM mnemonic: {demo.evm.mnemonic}</p>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
          <button type="button" className="ml-2 font-semibold underline" onClick={() => setError(null)}>
            Dismiss
          </button>
        </div>
      ) : null}

      <BridgeChainRow label="From" chain={sourceVisual} address={sourcePillAddress} />

      <div className="mb-1 flex flex-wrap items-start gap-2">
        <div className="w-[7.5rem] shrink-0">
          <label className="mb-1 block text-xs font-medium text-slate-500">Source</label>
          <select className={selectCls + ' w-full'} value={sourceChain} onChange={(e) => setSourceChain(e.target.value as ChainChoice)}>
            <option value="evm">EVM</option>
            <option value="cardano">Cardano</option>
            <option value="midnight">Midnight</option>
          </select>
        </div>
        <div className="min-w-0 flex-1">
          <label className="mb-1 block text-xs font-medium text-slate-500">Amount</label>
          <div className="relative">
            <input
              className={inputCls + ' pr-14 text-lg font-semibold tracking-tight'}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
            />
            <button
              type="button"
              onClick={() => setAmount(maxBalance)}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg px-2 py-1 text-xs font-bold text-teal-800 hover:bg-teal-50"
            >
              Max
            </button>
          </div>
        </div>
        <div className="w-full min-[380px]:w-[9.5rem] min-[380px]:shrink-0">
          <label className="mb-1 block text-xs font-medium text-slate-500 opacity-0 min-[380px]:opacity-100">Token</label>
          <WalletPill chain={sourceVisual} symbol={asset} address={sourcePillAddress || '—'} balanceLabel={`${maxBalance} max`} />
        </div>
      </div>
      <p className="mb-4 text-xs text-slate-500">
        {fiatApprox} <span className="text-emerald-700">0.0%</span>
      </p>

      <div className="mb-4 flex justify-center">
        <button
          type="button"
          onClick={swapChains}
          disabled={operation !== 'LOCK'}
          className="flex h-11 w-11 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-sm transition-colors hover:border-teal-200 hover:text-teal-800 disabled:opacity-30 disabled:hover:border-slate-200 disabled:hover:text-slate-500"
          aria-label="Swap source and destination"
        >
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <path d="M7 16V4M7 4L3 8M7 4l4 4M17 8v12M17 20l4-4M17 20l-4-4" />
          </svg>
        </button>
      </div>

      {operation === 'LOCK' && (
        <>
          <BridgeChainRow label="To" chain={destVisual} address={destPillAddress} />
          <div className="mb-4 flex flex-wrap items-start gap-2">
            <div className="w-[7.5rem] shrink-0">
              <label className="mb-1 block text-xs font-medium text-slate-500">Destination</label>
              <select className={selectCls + ' w-full'} value={destChain} onChange={(e) => setDestChain(e.target.value as ChainChoice)}>
                <option value="evm" disabled={sourceChain === 'evm'}>
                  EVM
                </option>
                <option value="cardano" disabled={sourceChain === 'cardano'}>
                  Cardano
                </option>
                <option value="midnight" disabled={sourceChain === 'midnight'}>
                  Midnight
                </option>
              </select>
            </div>
            <div className="min-w-0 flex-1">
              <label className="mb-1 block text-xs font-medium text-slate-500">You receive</label>
              <input className={inputCls + ' cursor-not-allowed text-lg font-semibold text-slate-600 bg-slate-50'} value={amount} readOnly aria-readonly />
            </div>
            <div className="w-full min-[380px]:w-[9.5rem] min-[380px]:shrink-0">
              <label className="mb-1 block text-xs font-medium text-slate-500 opacity-0 min-[380px]:opacity-100">Side</label>
              <WalletPill chain={destVisual} symbol={asset} address={destPillAddress || '—'} balanceLabel="Estimate" />
            </div>
          </div>
        </>
      )}

      {operation === 'BURN' && (
        <div className="mb-4 space-y-2">
          <label className="block text-xs font-medium text-slate-500">Burn commitment (32 bytes hex)</label>
          <textarea
            className={inputCls + ' min-h-[72px] resize-y font-mono text-xs'}
            value={burnCommitmentHex}
            onChange={(e) => setBurnCommitmentHex(e.target.value.replace(/\s/g, ''))}
            spellCheck={false}
          />
          <button
            type="button"
            onClick={() => setBurnCommitmentHex(randomBytes32Hex())}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
          >
            Regenerate
          </button>
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">Asset</label>
          <select className={selectCls} value={asset} onChange={(e) => setAsset(e.target.value as 'USDC' | 'USDT')}>
            <option value="USDC">USDC</option>
            <option value="USDT">USDT</option>
          </select>
        </div>
        <p className="mt-5 flex-1 text-xs text-slate-500">
          1 {asset} ≈ 1 {asset} <span className="text-slate-400">(demo)</span>
        </p>
        <p className="mt-5 text-xs font-medium text-slate-400">Fee ~$0</p>
      </div>

      <label className="mb-1.5 block text-xs font-semibold text-slate-600">
        {operation === 'LOCK' ? 'Recipient' : 'Recipient (unlock to)'}
        <span className="ml-1.5 font-normal text-slate-400">
          · {chainToLabel(operation === 'LOCK' ? destChain : sourceChain)}
        </span>
      </label>
      <input
        className={cn(inputCls, 'mb-1 min-h-[2.75rem] font-mono text-[13px] leading-snug')}
        value={recipient}
        onChange={(e) => setRecipient(e.target.value)}
        spellCheck={false}
        autoComplete="off"
      />
      <p className="mb-4 text-xs leading-relaxed text-slate-500">{recipientHelper}</p>

      <div className="mb-5 flex flex-wrap gap-2">
        <button type="button" className={ghostBtn} onClick={() => applyRecipientDefaults()}>
          Auto-fill
        </button>
        {(lockNeedsNonMidnightRecipient || burnNeedsSourceRecipient) && (
          <>
            <button type="button" className={secondaryBtn} disabled={!evmConnected || !evmAddress} onClick={() => evmAddress && setRecipient(evmAddress)}>
              Use connected EVM
            </button>
            <button
              type="button"
              className={secondaryBtn}
              disabled={!cardanoWalletKey || !cardanoUsedAddressesHex[0]}
              onClick={() => cardanoUsedAddressesHex[0] && setRecipient(cardanoUsedAddressesHex[0])}
            >
              Use connected Cardano
            </button>
          </>
        )}
      </div>

      <button
        type="button"
        onClick={() => setReviewOpen(true)}
        className="w-full rounded-2xl bg-gradient-to-b from-slate-800 to-slate-900 py-3.5 text-sm font-semibold text-white shadow-md shadow-slate-900/15 transition-[transform,box-shadow] hover:from-slate-900 hover:to-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40 motion-safe:active:scale-[0.99]"
      >
        Review
      </button>

      <ReviewSheet
        open={reviewOpen}
        onClose={() => setReviewOpen(false)}
        onConfirm={() => void submit()}
        confirming={submitting}
        operation={operation}
        sourceChain={chainToLabel(sourceChain)}
        destChain={chainToLabel(destChain)}
        asset={asset}
        amount={amount}
        recipient={recipient.trim() || '—'}
      />
    </div>
  );
};
