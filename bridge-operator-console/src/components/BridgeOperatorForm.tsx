import { useEffect, useMemo, useState } from 'react';
import type {
  BridgeConsoleState,
  CardanoBurnHint,
  EvmBurnHint,
  EvmLockAnchor,
  EvmResolvedLock,
  MidnightBurnHint,
} from '../api/relayerClient';
import {
  fetchRecentCardanoBurnHints,
  fetchRecentEvmBurnHints,
  fetchRecentEvmLocks,
  fetchRecentMidnightBurnHints,
  postBurnIntent,
  postCardanoOperatorRedeemToEvm,
  postEvmExecuteBurn,
  postEvmExecuteLock,
  postEvmOperatorMint,
  postEvmOperatorRedeemToEvm,
  postLockIntent,
  postMidnightInitiateBurn,
  postMidnightOperatorRedeemToEvm,
} from '../api/relayerClient';
import { assetKind, type Stable } from '../lib/assets';
import { normalizeEvmPayoutAddr } from '../lib/evmPayout';
import { is0xTx64, normHex64 } from '../lib/hex';

type Flow = 'mint' | 'redeem-cardano' | 'redeem-midnight' | 'redeem-evm';
type Dest = 'cardano' | 'midnight' | 'evm';
type RedeemSrc = 'cardano' | 'midnight' | 'evm';

function recipientForDest(r: BridgeConsoleState['recipients'], dest: Dest): string | undefined {
  if (dest === 'cardano') return r.cardanoRecipient;
  if (dest === 'midnight') return r.midnightRecipient;
  return r.evmRecipient;
}

/** Cardano / Midnight 32-byte tx id: 64 hex, optional 0x. */
function normTx64(h: string, label: string): string {
  const x = h.replace(/^0x/i, '').trim().toLowerCase();
  if (x.length !== 64 || !/^[0-9a-f]+$/u.test(x)) {
    throw new Error(`${label}: expected 64 hex characters (32 bytes).`);
  }
  return x;
}

type MintLockRow = EvmResolvedLock & { source: 'chain' | 'job'; jobId?: string };

function amountMatchesDisplay(want: string, got: string): boolean {
  const wa = want.trim();
  const gb = got.trim();
  if (!wa || !gb) return false;
  if (wa === gb) return true;
  const pa = Number.parseFloat(wa);
  const pb = Number.parseFloat(gb);
  return Number.isFinite(pa) && Number.isFinite(pb) && Math.abs(pa - pb) < 1e-12;
}

function mergeCardanoBurnHints(jobs: CardanoBurnHint[], chain: CardanoBurnHint[]): CardanoBurnHint[] {
  const seen = new Set(jobs.map((j) => `${j.cardano.txHash}#${j.cardano.outputIndex}`));
  const extra = chain.filter((c) => !seen.has(`${c.cardano.txHash}#${c.cardano.outputIndex}`));
  return [...extra, ...jobs];
}

function mergeEvmBurnHints(jobs: EvmBurnHint[], chain: EvmBurnHint[]): EvmBurnHint[] {
  const seen = new Set(jobs.map((j) => `${String(j.evm.txHash).toLowerCase()}#${j.evm.logIndex}`));
  const extra = chain.filter((c) => !seen.has(`${String(c.evm.txHash).toLowerCase()}#${c.evm.logIndex}`));
  return [...extra, ...jobs];
}

function mergeMidnightBurnHints(jobs: MidnightBurnHint[], chain: MidnightBurnHint[]): MidnightBurnHint[] {
  const keyOf = (h: MidnightBurnHint) => {
    const d = String(h.midnight.depositCommitmentHex ?? '')
      .replace(/^0x/i, '')
      .toLowerCase();
    const t = (h.midnight.txId ?? '').trim().toLowerCase();
    return `${d}#${t || 'pending'}`;
  };
  const seen = new Set(jobs.map(keyOf));
  const extra = chain.filter((c) => !seen.has(keyOf(c)));
  return [...extra, ...jobs];
}

function mintLockRowsFromJobAnchors(anchors: EvmLockAnchor[], asset: Stable, amountStr: string): MintLockRow[] {
  const want = amountStr.trim();
  if (!want) return [];
  return anchors
    .filter((a) => Boolean(a.blockNumber?.trim()))
    .filter((a) => a.asset === asset)
    .filter((a) => amountMatchesDisplay(want, String(a.amount ?? '')))
    .map((a) => ({
      txHash: a.txHash.startsWith('0x') ? a.txHash : `0x${a.txHash}`,
      logIndex: a.logIndex,
      blockNumber: a.blockNumber!,
      poolLockAddress: a.poolLockAddress ?? '',
      token: a.token ?? '',
      nonce: a.nonce ?? '',
      recipient: '',
      amountRaw: '',
      asset: a.asset,
      jobId: a.jobId,
      source: 'job' as const,
    }));
}

/** Prefer on-chain `Locked` logs; fall back to relayer LOCK job anchors (e.g. when `/v1/evm/recent-locks` is missing). */
async function resolveMintLocksForAmount(
  st: BridgeConsoleState,
  ass: Stable,
  amt: string,
): Promise<MintLockRow[]> {
  const jobRows = mintLockRowsFromJobAnchors(st.anchors.evmLockAnchors ?? [], ass, amt);
  try {
    const data = await fetchRecentEvmLocks(ass, amt.trim());
    const chain: MintLockRow[] = (data.locks ?? []).map((l) => ({ ...l, source: 'chain' as const }));
    if (chain.length > 0) return chain;
  } catch {
    /* use jobRows below */
  }
  if (jobRows.length > 0) return jobRows;
  throw new Error(
    'No matching pool lock for this amount and asset. Lock USDC/USDT on the EVM pool first, or ensure the relayer has a LOCK job with the same amount. If chain scan fails with 404, upgrade zk-stables-relayer so GET /v1/evm/recent-locks is available.',
  );
}

function RouteArrow() {
  return (
    <div className="ab-route-arrow" aria-hidden>
      <svg width="32" height="22" viewBox="0 0 32 22" fill="none">
        <path
          d="M16 3v12M11 12l5 5 5-5"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

export function BridgeOperatorForm({ state }: { state: BridgeConsoleState | undefined }) {
  const [mode, setMode] = useState<'mint' | 'redeem'>('mint');
  const [redeemSrc, setRedeemSrc] = useState<RedeemSrc>('cardano');
  const [dest, setDest] = useState<Dest>('cardano');
  const [asset, setAsset] = useState<Stable>('USDC');
  const [amount, setAmount] = useState('0.05');

  const [mintLocks, setMintLocks] = useState<MintLockRow[]>([]);
  const [mintLockIdx, setMintLockIdx] = useState(0);
  const [mintResolveLoading, setMintResolveLoading] = useState(false);
  const [mintResolveHint, setMintResolveHint] = useState<string | null>(null);

  const [redeemSource, setRedeemSource] = useState<'job' | 'manual'>('job');
  const [hintJobId, setHintJobId] = useState('');
  const [payoutAddress, setPayoutAddress] = useState('');

  const [cBurnComm, setCBurnComm] = useState('');
  const [cLockTx, setCLockTx] = useState('');
  const [cLockIdx, setCLockIdx] = useState('0');
  const [cSpendTx, setCSpendTx] = useState('');

  const [mBurnComm, setMBurnComm] = useState('');
  const [mDepComm, setMDepComm] = useState('');
  const [mTxId, setMTxId] = useState('');
  const [mDestChain, setMDestChain] = useState('2');
  const [mContract, setMContract] = useState('');

  const [eBurnComm, setEBurnComm] = useState('');
  const [eBurnTx, setEBurnTx] = useState('');
  const [eBurnLog, setEBurnLog] = useState('1');

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [res, setRes] = useState<unknown>(null);

  const [chainCardanoBurnHints, setChainCardanoBurnHints] = useState<CardanoBurnHint[]>([]);
  const [chainEvmBurnHints, setChainEvmBurnHints] = useState<EvmBurnHint[]>([]);
  const [chainMidnightBurnHints, setChainMidnightBurnHints] = useState<MidnightBurnHint[]>([]);
  const [burnScanNote, setBurnScanNote] = useState<string | null>(null);

  const flow: Flow = useMemo(
    () => (mode === 'mint' ? 'mint' : (`redeem-${redeemSrc}` as Flow)),
    [mode, redeemSrc],
  );

  const mintableAnchors = useMemo(
    () => (state?.anchors.evmLockAnchors ?? []).filter((a) => Boolean(a.blockNumber?.trim())),
    [state],
  );

  const burnHintsMerged = useMemo(() => {
    if (!state) return [];
    if (flow === 'redeem-cardano') {
      return mergeCardanoBurnHints(state.anchors.cardanoBurnHints, chainCardanoBurnHints);
    }
    if (flow === 'redeem-evm') {
      return mergeEvmBurnHints(state.anchors.evmBurnHints, chainEvmBurnHints);
    }
    if (flow === 'redeem-midnight') {
      return mergeMidnightBurnHints(state.anchors.midnightBurnHints, chainMidnightBurnHints);
    }
    return [];
  }, [state, flow, chainCardanoBurnHints, chainEvmBurnHints, chainMidnightBurnHints]);

  const matchingBurnHints = useMemo(() => {
    if (!amount.trim()) return [];
    return burnHintsMerged.filter(
      (h) => h.asset === asset && amountMatchesDisplay(amount, String(h.amount ?? '')),
    );
  }, [burnHintsMerged, asset, amount]);

  useEffect(() => {
    if (mode !== 'redeem' || redeemSource !== 'job') return;
    if (!matchingBurnHints.length) {
      setHintJobId('');
      return;
    }
    if (!matchingBurnHints.some((h) => h.jobId === hintJobId)) {
      setHintJobId(matchingBurnHints[0]!.jobId);
    }
  }, [mode, redeemSource, matchingBurnHints, hintJobId]);

  const recipient = state ? recipientForDest(state.recipients, dest) : undefined;

  const amountOk = amount.trim() !== '' && Number.parseFloat(amount) > 0;

  /** EVM underlying payout: override input, else operator signer (`evmOperatorAddress`), else `RELAYER_BRIDGE_EVM_RECIPIENT`. */
  const evmPayoutResolved = useMemo(() => {
    const fromInput = payoutAddress.trim();
    if (fromInput) return normalizeEvmPayoutAddr(fromInput);
    const fromOperator = state?.evmOperatorAddress?.trim() ?? '';
    const fromBridge = state?.recipients.evmRecipient?.trim() ?? '';
    return normalizeEvmPayoutAddr(fromOperator || fromBridge);
  }, [payoutAddress, state?.evmOperatorAddress, state?.recipients.evmRecipient]);

  const operatorRedeemBypass =
    (redeemSrc === 'cardano' && Boolean(state?.cardanoOperatorConsoleTx)) ||
    (redeemSrc === 'midnight' && Boolean(state?.midnightOperatorConsoleTx)) ||
    (redeemSrc === 'evm' && Boolean(state?.evmOperatorConsoleTx));

  useEffect(() => {
    if (mode !== 'redeem' || redeemSource !== 'job' || !state || !amountOk || operatorRedeemBypass) {
      setChainCardanoBurnHints([]);
      setChainEvmBurnHints([]);
      setChainMidnightBurnHints([]);
      setBurnScanNote(null);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      setBurnScanNote(null);
      try {
        if (redeemSrc === 'cardano') {
          const r = await fetchRecentCardanoBurnHints(asset, amount.trim());
          if (cancelled) return;
          setChainCardanoBurnHints(r.hints ?? []);
          setChainEvmBurnHints([]);
          setChainMidnightBurnHints([]);
          setBurnScanNote(r.scanNote?.trim() || null);
        } else if (redeemSrc === 'evm') {
          const r = await fetchRecentEvmBurnHints(asset, amount.trim());
          if (cancelled) return;
          setChainEvmBurnHints(r.hints ?? []);
          setChainCardanoBurnHints([]);
          setChainMidnightBurnHints([]);
          setBurnScanNote(r.scanNote?.trim() || null);
        } else if (redeemSrc === 'midnight') {
          const r = await fetchRecentMidnightBurnHints(asset, amount.trim());
          if (cancelled) return;
          setChainMidnightBurnHints(r.hints ?? []);
          setChainCardanoBurnHints([]);
          setChainEvmBurnHints([]);
          setBurnScanNote(r.scanNote?.trim() || null);
        } else {
          setChainCardanoBurnHints([]);
          setChainEvmBurnHints([]);
          setChainMidnightBurnHints([]);
        }
      } catch (e) {
        if (!cancelled) {
          setChainCardanoBurnHints([]);
          setChainEvmBurnHints([]);
          setChainMidnightBurnHints([]);
          setBurnScanNote(e instanceof Error ? e.message : String(e));
        }
      }
    }, 450);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [mode, redeemSource, state, amountOk, redeemSrc, asset, amount, operatorRedeemBypass]);

  const jobFallbackLocks = useMemo((): MintLockRow[] => {
    if (!state) return [];
    return mintLockRowsFromJobAnchors(mintableAnchors, asset, amount);
  }, [state, mintableAnchors, asset, amount]);

  const operatorMintBypass = Boolean(state?.evmOperatorConsoleTx);

  useEffect(() => {
    if (mode !== 'mint' || !state || operatorMintBypass) {
      setMintLocks([]);
      setMintResolveHint(null);
      return;
    }
    let cancelled = false;
    if (!amountOk) {
      setMintLocks([]);
      setMintResolveHint(null);
      return;
    }
    const t = setTimeout(async () => {
      setMintResolveLoading(true);
      setMintResolveHint(null);
      try {
        const data = await fetchRecentEvmLocks(asset, amount.trim());
        if (cancelled) return;
        const chainLocks: MintLockRow[] = (data.locks ?? []).map((l) => ({ ...l, source: 'chain' as const }));
        if (chainLocks.length > 0) {
          setMintLocks(chainLocks);
          setMintLockIdx(0);
        } else if (jobFallbackLocks.length > 0) {
          setMintLocks(jobFallbackLocks);
          setMintLockIdx(0);
          setMintResolveHint(
            'No matching on-chain lock in the scanned window — using relayer job anchors for this amount.',
          );
        } else {
          setMintLocks([]);
          setMintResolveHint(
            'No pool lock found for this amount and asset. Lock on EVM first, or increase RELAYER_EVM_LOCK_LOOKBACK_BLOCKS.',
          );
        }
      } catch (e) {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : String(e);
        if (jobFallbackLocks.length > 0) {
          setMintLocks(jobFallbackLocks);
          setMintLockIdx(0);
          const soft404 = msg.includes('404') && msg.includes('recent-locks');
          setMintResolveHint(
            soft404
              ? 'Chain scan API unavailable on this relayer — using saved LOCK job anchors for this amount.'
              : `Chain scan failed (${msg.slice(0, 100)}) — using job anchors.`,
          );
        } else {
          setMintLocks([]);
          setMintResolveHint(msg);
        }
      } finally {
        if (!cancelled) setMintResolveLoading(false);
      }
    }, 450);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [mode, state, asset, amount, amountOk, jobFallbackLocks]);

  const selectedMintLock = mintLocks[mintLockIdx];

  const canMintSubmit = Boolean(state && amountOk && Boolean(recipient?.trim()));

  const payoutOk = Boolean(evmPayoutResolved);

  const redeemJobNeedsHintPick =
    (flow === 'redeem-evm' && !state?.evmOperatorConsoleTx) ||
    (flow === 'redeem-cardano' && !state?.cardanoOperatorConsoleTx) ||
    (flow === 'redeem-midnight' && !state?.midnightOperatorConsoleTx);

  const canRedeemJob = Boolean(
    state &&
      redeemSource === 'job' &&
      amountOk &&
      payoutOk &&
      (redeemJobNeedsHintPick ? matchingBurnHints.some((h) => h.jobId === hintJobId) : true),
  );

  const canRedeemManualCardano =
    redeemSource === 'manual' &&
    flow === 'redeem-cardano' &&
    amountOk &&
    payoutOk &&
    cBurnComm.trim() &&
    cLockTx.trim() &&
    cLockIdx.trim() !== '';

  const canRedeemManualMidnight =
    redeemSource === 'manual' &&
    flow === 'redeem-midnight' &&
    amountOk &&
    payoutOk &&
    mBurnComm.trim() &&
    mDepComm.trim() &&
    mTxId.trim();

  const canRedeemManualEvm =
    redeemSource === 'manual' &&
    flow === 'redeem-evm' &&
    amountOk &&
    payoutOk &&
    eBurnComm.trim() &&
    is0xTx64(eBurnTx.trim());

  const canRedeem =
    mode === 'redeem' &&
    (canRedeemJob || canRedeemManualCardano || canRedeemManualMidnight || canRedeemManualEvm);

  async function submit() {
    setErr(null);
    setRes(null);
    setBusy(true);
    try {
      if (flow === 'mint') {
        if (!state) throw new Error('No relayer state.');
        const rec = recipientForDest(state.recipients, dest)?.trim();
        if (!rec) throw new Error(`No relayer recipient for ${dest} (set RELAYER_BRIDGE_* on relayer).`);
        if (!amountOk) throw new Error('Enter a positive amount.');
        if (state.evmOperatorConsoleTx) {
          const out = await postEvmOperatorMint({
            asset,
            amount: amount.trim(),
            destinationChain: dest,
            recipientIntent: rec,
          });
          setRes(out);
          return;
        }
        let L = selectedMintLock;
        let th = L
          ? ((L.txHash.startsWith('0x') ? L.txHash : `0x${L.txHash}`) as `0x${string}`)
          : null;
        const lockReady = Boolean(L?.blockNumber?.trim() && th && is0xTx64(th));
        if (!lockReady) {
          try {
            const resolved = await resolveMintLocksForAmount(state, asset, amount.trim());
            const pickIdx = Math.min(mintLockIdx, Math.max(0, resolved.length - 1));
            setMintLocks(resolved);
            setMintLockIdx(pickIdx);
            L = resolved[pickIdx] ?? resolved[0];
            th = L
              ? ((L.txHash.startsWith('0x') ? L.txHash : `0x${L.txHash}`) as `0x${string}`)
              : null;
          } catch (resolveErr) {
            if (!state.evmOperatorConsoleTx) {
              throw resolveErr instanceof Error ? resolveErr : new Error(String(resolveErr));
            }
            const recIntent = recipientForDest(state.recipients, dest)?.trim();
            if (!recIntent) {
              throw new Error(`No relayer recipient for ${dest} (set RELAYER_BRIDGE_* on relayer).`);
            }
            const exec = await postEvmExecuteLock({
              asset,
              amount: amount.trim(),
              destinationChain: dest,
              recipientIntent: recIntent,
            });
            const lk = exec.locked;
            const row: MintLockRow = {
              txHash: lk.txHash.startsWith('0x') ? lk.txHash : `0x${lk.txHash}`,
              logIndex: lk.logIndex,
              blockNumber: lk.blockNumber.trim(),
              poolLockAddress: lk.poolLockAddress,
              token: lk.token,
              nonce: lk.nonce,
              recipient: lk.recipient,
              amountRaw: lk.amountRaw,
              asset,
              source: 'chain',
            };
            setMintLocks([row]);
            setMintLockIdx(0);
            L = row;
            th = (L.txHash.startsWith('0x') ? L.txHash : `0x${L.txHash}`) as `0x${string}`;
          }
        }
        if (!L?.blockNumber?.trim()) throw new Error('No matching pool lock for this amount and asset.');
        if (!th || !is0xTx64(th)) throw new Error('Invalid lock transaction hash.');
        const asAddr = (x: string): `0x${string}` | undefined => {
          const t = x.trim();
          if (!t) return undefined;
          const h = (t.startsWith('0x') ? t : `0x${t}`) as `0x${string}`;
          const lc = h.toLowerCase() as `0x${string}`;
          if (is0xTx64(lc)) return lc;
          if (/^0x[0-9a-fA-F]{40}$/u.test(lc)) return lc;
          return undefined;
        };
        const nonceRaw = L.nonce?.trim() ?? '';
        const nonceHex =
          nonceRaw.startsWith('0x') && nonceRaw.length === 66
            ? (nonceRaw.toLowerCase() as `0x${string}`)
            : nonceRaw.length === 64 && /^[0-9a-fA-F]+$/u.test(nonceRaw)
              ? (`0x${nonceRaw.toLowerCase()}` as `0x${string}`)
              : undefined;
        const evm: {
          txHash: `0x${string}`;
          logIndex: number;
          blockNumber: string;
          poolLockAddress?: `0x${string}`;
          token?: `0x${string}`;
          nonce?: `0x${string}`;
        } = {
          txHash: th.toLowerCase() as `0x${string}`,
          logIndex: L.logIndex,
          blockNumber: L.blockNumber.trim(),
          ...(asAddr(L.poolLockAddress) ? { poolLockAddress: asAddr(L.poolLockAddress)! } : {}),
          ...(asAddr(L.token) ? { token: asAddr(L.token)! } : {}),
          ...(nonceHex && nonceHex.length === 66 ? { nonce: nonceHex } : {}),
        };
        const body = {
          operation: 'LOCK' as const,
          sourceChain: 'evm' as const,
          destinationChain: dest,
          asset: asset as 'USDC' | 'USDT',
          assetKind: assetKind(asset),
          amount: amount.trim(),
          recipient: rec,
          note: 'LOCK via bridge-operator-console',
          source: { evm },
        };
        const out = await postLockIntent(body);
        setRes(out);
      } else {
        if (!amountOk) throw new Error('Enter a positive amount.');
        if (!evmPayoutResolved) {
          throw new Error(
            'Set an EVM payout (0x + 40 hex) or configure RELAYER_BRIDGE_EVM_RECIPIENT on the relayer.',
          );
        }
        const payout = evmPayoutResolved;

        if (redeemSource === 'job') {
          if (flow === 'redeem-cardano' && state!.cardanoOperatorConsoleTx) {
            const out = await postCardanoOperatorRedeemToEvm({
              asset,
              amount: amount.trim(),
              evmPayout: payout,
            });
            setRes(out);
            return;
          }
          if (flow === 'redeem-midnight' && state!.midnightOperatorConsoleTx) {
            const out = await postMidnightOperatorRedeemToEvm({
              asset,
              amount: amount.trim(),
              evmPayout: payout,
            });
            setRes(out);
            return;
          }
          if (flow === 'redeem-evm' && state!.evmOperatorConsoleTx) {
            const out = await postEvmOperatorRedeemToEvm({
              asset,
              amount: amount.trim(),
              evmPayout: payout,
            });
            setRes(out);
            return;
          }
          const resolveBurnHint = async (): Promise<CardanoBurnHint | MidnightBurnHint | EvmBurnHint> => {
            if (flow === 'redeem-midnight') {
              let merged = mergeMidnightBurnHints(state!.anchors.midnightBurnHints, chainMidnightBurnHints);
              let matching = merged.filter(
                (h) => h.asset === asset && amountMatchesDisplay(amount, String(h.amount ?? '')),
              );
              let pick = matching.find((h) => h.jobId === hintJobId) ?? matching[0];
              if (!pick) {
                const pack = await fetchRecentMidnightBurnHints(asset, amount.trim()).catch(() => ({
                  hints: [] as MidnightBurnHint[],
                  scanNote: undefined as string | undefined,
                }));
                setChainMidnightBurnHints(pack.hints);
                if (pack.scanNote) setBurnScanNote(pack.scanNote);
                merged = mergeMidnightBurnHints(state!.anchors.midnightBurnHints, pack.hints);
                matching = merged.filter(
                  (h) => h.asset === asset && amountMatchesDisplay(amount, String(h.amount ?? '')),
                );
                pick = matching.find((h) => h.jobId === hintJobId) ?? matching[0];
              }
              if (!pick) {
                throw new Error(
                  'No matching Midnight registry deposit for this amount and asset (indexer + RELAYER_MIDNIGHT_CONTRACT_ADDRESS), or deposit is not minted / not ready to burn.',
                );
              }
              const mid = pick.midnight;
              const depHex = (mid.depositCommitmentHex ?? '').replace(/^0x/i, '').toLowerCase();
              const recHex = pick.burnCommitmentHex.replace(/^0x/i, '').toLowerCase();
              if (!mid.txId?.trim()) {
                if (depHex.length !== 64 || recHex.length !== 64) {
                  throw new Error('Midnight hint missing valid deposit or recipient commitment (64 hex).');
                }
                const init = await postMidnightInitiateBurn({
                  depositCommitmentHex: depHex,
                  recipientCommitmentHex: recHex,
                  destChainId: mid.destChainId ?? 2,
                });
                const updated: MidnightBurnHint = {
                  ...pick,
                  midnight: {
                    ...pick.midnight,
                    txId: init.txId,
                    txHash: init.txHash,
                    depositCommitmentHex: depHex,
                    contractAddress: init.contractAddress ?? pick.midnight.contractAddress,
                  },
                  phase: 'initiate-burn-submitted',
                };
                setChainMidnightBurnHints((prev) => mergeMidnightBurnHints(prev, [updated]));
                return updated;
              }
              return pick;
            }
            if (flow === 'redeem-cardano') {
              let merged = mergeCardanoBurnHints(state!.anchors.cardanoBurnHints, chainCardanoBurnHints);
              let matching = merged.filter(
                (h) => h.asset === asset && amountMatchesDisplay(amount, String(h.amount ?? '')),
              );
              let pick = matching.find((h) => h.jobId === hintJobId) ?? matching[0];
              if (!pick) {
                const pack = await fetchRecentCardanoBurnHints(asset, amount.trim()).catch(() => ({
                  hints: [] as CardanoBurnHint[],
                  scanNote: undefined as string | undefined,
                }));
                setChainCardanoBurnHints(pack.hints);
                if (pack.scanNote) setBurnScanNote(pack.scanNote);
                merged = mergeCardanoBurnHints(state!.anchors.cardanoBurnHints, pack.hints);
                matching = merged.filter(
                  (h) => h.asset === asset && amountMatchesDisplay(amount, String(h.amount ?? '')),
                );
                pick = matching.find((h) => h.jobId === hintJobId) ?? matching[0];
              }
              if (!pick) {
                throw new Error(
                  'No matching Cardano lock UTxO or BURN job for this amount and asset. Ensure zk is locked at lock_pool with this face value, indexer + bridge wallet are configured, or use Manual entry.',
                );
              }
              return pick;
            }
            let mergedE = mergeEvmBurnHints(state!.anchors.evmBurnHints, chainEvmBurnHints);
            let matchingE = mergedE.filter(
              (h) => h.asset === asset && amountMatchesDisplay(amount, String(h.amount ?? '')),
            );
            let pickE = matchingE.find((h) => h.jobId === hintJobId) ?? matchingE[0];
            if (!pickE) {
              const pack = await fetchRecentEvmBurnHints(asset, amount.trim()).catch(() => ({
                hints: [] as EvmBurnHint[],
                scanNote: undefined as string | undefined,
              }));
              setChainEvmBurnHints(pack.hints);
              if (pack.scanNote) setBurnScanNote(pack.scanNote);
              mergedE = mergeEvmBurnHints(state!.anchors.evmBurnHints, pack.hints);
              matchingE = mergedE.filter(
                (h) => h.asset === asset && amountMatchesDisplay(amount, String(h.amount ?? '')),
              );
              pickE = matchingE.find((h) => h.jobId === hintJobId) ?? matchingE[0];
            }
            if (!pickE) {
              if (!state!.evmOperatorConsoleTx) {
                throw new Error(
                  'No matching EVM Burned log or BURN job for this amount and asset. Burn zk on the wrapped token contract, configure RELAYER_EVM_WRAPPED_TOKEN_*, or use Manual entry.',
                );
              }
              const exec = await postEvmExecuteBurn({
                asset,
                amount: amount.trim(),
                evmPayout: payout,
              });
              const b = exec.burned;
              pickE = {
                jobId: 'operator-evm-execute-burn',
                asset: exec.asset,
                amount: exec.amount,
                recipient: payout,
                burnCommitmentHex: exec.burnCommitmentHex,
                evm: {
                  txHash: b.txHash,
                  logIndex: b.logIndex,
                  blockNumber: b.blockNumber,
                  wrappedTokenAddress: b.wrappedTokenAddress,
                  nonce: b.nonce,
                  fromAddress: b.fromAddress,
                },
                createdAt: new Date().toISOString(),
                phase: 'submitted',
              };
              setChainEvmBurnHints((prev) => mergeEvmBurnHints(prev, [pickE]));
            }
            return pickE;
          };

          const selectedBurn = await resolveBurnHint();
          if (flow === 'redeem-cardano') {
            const row = selectedBurn as CardanoBurnHint;
            const c = row.cardano;
            const spend = c.spendTxHash?.trim();
            const body = {
              operation: 'BURN' as const,
              sourceChain: 'cardano' as const,
              destinationChain: 'evm',
              asset: row.asset as 'USDC' | 'USDT',
              assetKind: assetKind(row.asset as Stable),
              amount: amount.trim(),
              recipient: payout,
              burnCommitmentHex: normHex64(row.burnCommitmentHex),
              note: 'BURN via bridge-operator-console (Cardano)',
              source: {
                cardano: {
                  txHash: normHex64(c.txHash),
                  outputIndex: c.outputIndex,
                  ...(spend ? { spendTxHash: normHex64(spend) } : {}),
                  ...(c.lockNonce?.trim() ? { lockNonce: c.lockNonce.trim() } : {}),
                  ...(c.blockHeight ? { blockHeight: c.blockHeight } : {}),
                  ...(c.scriptHash ? { scriptHash: c.scriptHash } : {}),
                  ...(c.policyIdHex ? { policyIdHex: c.policyIdHex } : {}),
                  ...(c.assetNameHex ? { assetNameHex: c.assetNameHex } : {}),
                },
              },
            };
            const out = await postBurnIntent(body);
            setRes(out);
          } else if (flow === 'redeem-midnight') {
            const row = selectedBurn as MidnightBurnHint;
            const m = row.midnight;
            const body = {
              operation: 'BURN' as const,
              sourceChain: 'midnight' as const,
              destinationChain: 'evm',
              asset: row.asset as 'USDC' | 'USDT',
              assetKind: assetKind(row.asset as Stable),
              amount: amount.trim(),
              recipient: payout,
              burnCommitmentHex: normHex64(row.burnCommitmentHex),
              note: 'BURN via bridge-operator-console (Midnight)',
              source: {
                midnight: {
                  txId: m.txId!.trim(),
                  destChainId: m.destChainId ?? 2,
                  depositCommitmentHex: normHex64(m.depositCommitmentHex!),
                  ...(m.contractAddress?.trim() ? { contractAddress: m.contractAddress.trim() } : {}),
                  ...(m.lockNonce?.trim() ? { lockNonce: m.lockNonce.trim() } : {}),
                },
              },
            };
            const out = await postBurnIntent(body);
            setRes(out);
          } else {
            const row = selectedBurn as EvmBurnHint;
            const e = row.evm;
            const th = e.txHash.trim();
            if (!is0xTx64(th)) throw new Error('Invalid burn tx on job.');
            const nonceRaw = e.nonce?.trim();
            const nonceHex =
              nonceRaw && nonceRaw.startsWith('0x') && nonceRaw.length === 66
                ? (nonceRaw.toLowerCase() as `0x${string}`)
                : nonceRaw && nonceRaw.length === 64 && /^[0-9a-fA-F]+$/u.test(nonceRaw)
                  ? (`0x${nonceRaw.toLowerCase()}` as `0x${string}`)
                  : undefined;
            const fromRaw = e.fromAddress?.trim();
            const fromHex =
              fromRaw && fromRaw.startsWith('0x') && fromRaw.length === 42
                ? (fromRaw.toLowerCase() as `0x${string}`)
                : fromRaw && /^[0-9a-fA-F]{40}$/u.test(fromRaw)
                  ? (`0x${fromRaw.toLowerCase()}` as `0x${string}`)
                  : undefined;
            const wrapRaw = e.wrappedTokenAddress?.trim();
            const wrapHex =
              wrapRaw && wrapRaw.startsWith('0x') && wrapRaw.length === 42
                ? (wrapRaw.toLowerCase() as `0x${string}`)
                : wrapRaw && /^[0-9a-fA-F]{40}$/u.test(wrapRaw)
                  ? (`0x${wrapRaw.toLowerCase()}` as `0x${string}`)
                  : undefined;
            const body = {
              operation: 'BURN' as const,
              sourceChain: 'evm' as const,
              destinationChain: 'evm',
              asset: row.asset as 'USDC' | 'USDT',
              assetKind: assetKind(row.asset as Stable),
              amount: amount.trim(),
              recipient: payout,
              burnCommitmentHex: normHex64(row.burnCommitmentHex),
              note: 'BURN via bridge-operator-console (EVM)',
              source: {
                evm: {
                  txHash: th.toLowerCase() as `0x${string}`,
                  logIndex: Number(e.logIndex),
                  ...(e.blockNumber?.trim() ? { blockNumber: e.blockNumber.trim() } : {}),
                  ...(wrapHex ? { wrappedTokenAddress: wrapHex } : {}),
                  ...(nonceHex && nonceHex.length === 66 ? { nonce: nonceHex } : {}),
                  ...(fromHex ? { fromAddress: fromHex } : {}),
                },
              },
            };
            const out = await postBurnIntent(body);
            setRes(out);
          }
        } else {
          if (flow === 'redeem-cardano') {
            const idx = Number.parseInt(cLockIdx, 10);
            if (!Number.isInteger(idx) || idx < 0) throw new Error('Lock output index: non-negative integer.');
            const spend = cSpendTx.trim();
            const body = {
              operation: 'BURN' as const,
              sourceChain: 'cardano' as const,
              destinationChain: 'evm',
              asset: asset as 'USDC' | 'USDT',
              assetKind: assetKind(asset),
              amount: amount.trim(),
              recipient: payout,
              burnCommitmentHex: normHex64(cBurnComm),
              note: 'BURN via bridge-operator-console (Cardano manual)',
              source: {
                cardano: {
                  txHash: normTx64(cLockTx, 'Lock UTxO tx'),
                  outputIndex: idx,
                  ...(spend ? { spendTxHash: normTx64(spend, 'BridgeRelease tx') } : {}),
                },
              },
            };
            const out = await postBurnIntent(body);
            setRes(out);
          } else if (flow === 'redeem-midnight') {
            const destChainId = Number.parseInt(mDestChain, 10);
            if (!Number.isFinite(destChainId)) throw new Error('dest chain id: integer.');
            const body = {
              operation: 'BURN' as const,
              sourceChain: 'midnight' as const,
              destinationChain: 'evm',
              asset: asset as 'USDC' | 'USDT',
              assetKind: assetKind(asset),
              amount: amount.trim(),
              recipient: payout,
              burnCommitmentHex: normHex64(mBurnComm),
              note: 'BURN via bridge-operator-console (Midnight manual)',
              source: {
                midnight: {
                  txId: mTxId.trim(),
                  destChainId,
                  depositCommitmentHex: normHex64(mDepComm),
                  ...(mContract.trim() ? { contractAddress: mContract.trim() } : {}),
                },
              },
            };
            const out = await postBurnIntent(body);
            setRes(out);
          } else {
            const th = eBurnTx.trim();
            if (!is0xTx64(th)) throw new Error('Burn tx: 0x + 64 hex.');
            const li = Number.parseInt(eBurnLog, 10);
            if (!Number.isInteger(li) || li < 0) throw new Error('Burn log index: non-negative integer.');
            const body = {
              operation: 'BURN' as const,
              sourceChain: 'evm' as const,
              destinationChain: 'evm',
              asset: asset as 'USDC' | 'USDT',
              assetKind: assetKind(asset),
              amount: amount.trim(),
              recipient: payout,
              burnCommitmentHex: normHex64(eBurnComm),
              note: 'BURN via bridge-operator-console (EVM manual)',
              source: {
                evm: {
                  txHash: th.toLowerCase() as `0x${string}`,
                  logIndex: li,
                },
              },
            };
            const out = await postBurnIntent(body);
            setRes(out);
          }
        }
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const ready = mode === 'mint' ? canMintSubmit : canRedeem;

  const presetList = state?.amountPresets ?? ['0.01', '0.05', '0.1', '1'];

  if (!state) {
    return <p className="ab-field-hint">Loading relayer…</p>;
  }

  return (
    <div className="ab-form">
      <div className="ab-mode-row" role="group" aria-label="Bridge direction">
        <button
          type="button"
          className="ab-mode-btn"
          aria-pressed={mode === 'mint'}
          onClick={() => {
            setMode('mint');
            setErr(null);
            setRes(null);
          }}
        >
          Mint
        </button>
        <button
          type="button"
          className="ab-mode-btn"
          aria-pressed={mode === 'redeem'}
          onClick={() => {
            setMode('redeem');
            setErr(null);
            setRes(null);
          }}
        >
          Redeem
        </button>
      </div>

      {mode === 'redeem' && (
        <div className="ab-field ab-redeem-chain">
          <label htmlFor="op-redeem-src">From chain</label>
          <select
            id="op-redeem-src"
            value={redeemSrc}
            onChange={(e) => setRedeemSrc(e.target.value as RedeemSrc)}
          >
            <option value="cardano">Cardano</option>
            <option value="midnight">Midnight</option>
          </select>
        </div>
      )}

      {mode === 'mint' ? (
        <div className="ab-route ab-route--split">
          <div className="ab-route-block">
            <div className="ab-route-label">You send</div>
            <div className="ab-field" style={{ marginTop: 'var(--space-2)' }}>
              <label htmlFor="mint-amount">Amount</label>
              <input
                id="mint-amount"
                name="mint-amount"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                placeholder="e.g. 0.05"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                list="amount-presets"
              />
              <datalist id="amount-presets">
                {presetList.map((p) => (
                  <option key={p} value={p} />
                ))}
              </datalist>
            </div>
            <div className="ab-field">
              <label htmlFor="mint-asset">Asset locked on EVM</label>
              <select id="mint-asset" value={asset} onChange={(e) => setAsset(e.target.value as Stable)}>
                <option value="USDC">USDC</option>
                <option value="USDT">USDT</option>
              </select>
            </div>

            {operatorMintBypass ? (
              <p className="ab-field-hint">Operator mode — amount + Send.</p>
            ) : (
              <>
                {mintResolveLoading && (
                  <div className="ab-resolve" aria-live="polite">
                    <div className="ab-resolve-track" aria-hidden>
                      <div className="ab-resolve-fill" />
                    </div>
                    <p className="ab-resolve-copy">Scanning pool locks for this amount and asset…</p>
                  </div>
                )}
                {mintResolveHint && !mintResolveLoading && <p className="ab-field-hint">{mintResolveHint}</p>}

                {mintLocks.length > 1 ? (
                  <div className="ab-field">
                    <label htmlFor="mint-lock-pick">Matching lock</label>
                    <select
                      id="mint-lock-pick"
                      value={String(mintLockIdx)}
                      onChange={(e) => setMintLockIdx(Number.parseInt(e.target.value, 10))}
                    >
                      {mintLocks.map((row, i) => (
                        <option key={`${row.txHash}-${row.logIndex}-${i}`} value={String(i)}>
                          {row.source === 'chain' ? 'Chain' : 'Job'} · block {row.blockNumber} · log {row.logIndex} ·{' '}
                          {row.txHash.slice(0, 12)}…
                        </option>
                      ))}
                    </select>
                  </div>
                ) : mintLocks.length === 1 ? (
                  <div className="ab-field">
                    <label>Resolved lock</label>
                    <p className="ab-address-box mono" style={{ margin: 0 }}>
                      tx {selectedMintLock?.txHash} · log {selectedMintLock?.logIndex} · block {selectedMintLock?.blockNumber}{' '}
                      <span style={{ color: 'var(--text-faint)' }}>({selectedMintLock?.source})</span>
                    </p>
                  </div>
                ) : !mintResolveLoading ? null : null}
              </>
            )}
          </div>

          <RouteArrow />

          <div className="ab-route-block ab-route-block--receive">
            <div className="ab-route-label">You receive</div>
            <div className="ab-fields">
              <div className="ab-field">
                <label htmlFor="op-dest">To chain</label>
                <select id="op-dest" value={dest} onChange={(e) => setDest(e.target.value as Dest)}>
                  <option value="cardano">Cardano</option>
                  <option value="midnight">Midnight</option>
                </select>
              </div>
            </div>
            <div className="ab-field" style={{ marginTop: 'var(--space-2)' }}>
              <label>Recipient</label>
              <p className="ab-address-box mono">
                {recipient?.trim() || '—'}
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="ab-route ab-route--split">
          <div className="ab-route-block">
            <div className="ab-route-label">You burn</div>
            <div className="ab-field" style={{ marginTop: 'var(--space-2)' }}>
              <label htmlFor="redeem-asset">Asset</label>
              <select id="redeem-asset" value={asset} onChange={(e) => setAsset(e.target.value as Stable)}>
                <option value="USDC">USDC</option>
                <option value="USDT">USDT</option>
              </select>
            </div>

            <div className="ab-field">
              <label htmlFor="redeem-amount">Amount</label>
              <input
                id="redeem-amount"
                type="text"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="e.g. 0.05"
                list="amount-presets-redeem"
              />
              <datalist id="amount-presets-redeem">
                {presetList.map((p) => (
                  <option key={p} value={p} />
                ))}
              </datalist>
            </div>

            {normalizeEvmPayoutAddr(state.evmOperatorAddress?.trim() ?? '') ||
            normalizeEvmPayoutAddr(state.recipients.evmRecipient?.trim() ?? '') ? (
              <div className="ab-field">
                <label>EVM payout</label>
                <p className="ab-address-box mono" style={{ margin: 0 }}>{evmPayoutResolved}</p>
                <input
                  id="redeem-payout-override"
                  type="text"
                  style={{ marginTop: 'var(--space-1)' }}
                  value={payoutAddress}
                  onChange={(e) => setPayoutAddress(e.target.value)}
                  placeholder="Override 0x payout"
                  autoComplete="off"
                  aria-label="Override EVM payout"
                />
              </div>
            ) : (
              <div className="ab-field">
                <label htmlFor="redeem-payout">EVM payout (0x…)</label>
                <input
                  id="redeem-payout"
                  type="text"
                  value={payoutAddress}
                  onChange={(e) => setPayoutAddress(e.target.value)}
                  placeholder="0x + 40 hex"
                  autoComplete="off"
                />
              </div>
            )}

            <div className="ab-entry-toggle" role="group" aria-label="Burn details source">
              <button
                type="button"
                className="ab-mode-btn"
                aria-pressed={redeemSource === 'job'}
                onClick={() => setRedeemSource('job')}
              >
                From relayer jobs
              </button>
              <button
                type="button"
                className="ab-mode-btn"
                aria-pressed={redeemSource === 'manual'}
                onClick={() => setRedeemSource('manual')}
              >
                Manual entry
              </button>
            </div>

            {redeemSource === 'job' ? (
              <div className="ab-field">
                <label htmlFor="op-hint">{operatorRedeemBypass ? 'Operator mode' : 'Matching burn job'}</label>
                {operatorRedeemBypass ? (
                  <p className="ab-field-hint">Operator mode — amount + Send.</p>
                ) : matchingBurnHints.length > 0 ? (
                  <select id="op-hint" value={hintJobId} onChange={(e) => setHintJobId(e.target.value)}>
                    {matchingBurnHints.map((h) => (
                      <option key={h.jobId} value={h.jobId}>
                        {h.asset} {h.amount} · {h.phase} · {h.createdAt.slice(0, 16)}
                      </option>
                    ))}
                  </select>
                ) : (
                  <p className="ab-field-hint">No match — press Send to resolve, or use Manual.</p>
                )}
                {!operatorRedeemBypass && burnScanNote ? <p className="ab-field-hint">{burnScanNote}</p> : null}
              </div>
            ) : flow === 'redeem-cardano' ? (
              <div className="ab-fields">
                <div className="ab-field">
                  <label htmlFor="r-bc">Burn commitment (64 hex)</label>
                  <input id="r-bc" value={cBurnComm} onChange={(e) => setCBurnComm(e.target.value)} placeholder="64 hex" />
                </div>
                <div className="ab-field">
                  <label htmlFor="r-lock">Lock UTxO tx hash (64 hex)</label>
                  <input id="r-lock" value={cLockTx} onChange={(e) => setCLockTx(e.target.value)} />
                </div>
                <div className="ab-field">
                  <label htmlFor="r-idx">Lock output index</label>
                  <input id="r-idx" type="text" inputMode="numeric" value={cLockIdx} onChange={(e) => setCLockIdx(e.target.value)} />
                </div>
                <div className="ab-field">
                  <label htmlFor="r-spend">BridgeRelease spend tx (64 hex, optional)</label>
                  <input id="r-spend" value={cSpendTx} onChange={(e) => setCSpendTx(e.target.value)} placeholder="omit if lock not released" />
                </div>
              </div>
            ) : flow === 'redeem-midnight' ? (
              <div className="ab-fields">
                <div className="ab-field">
                  <label htmlFor="rm-bc">Burn commitment (64 hex)</label>
                  <input id="rm-bc" value={mBurnComm} onChange={(e) => setMBurnComm(e.target.value)} />
                </div>
                <div className="ab-field">
                  <label htmlFor="rm-dep">Deposit commitment (64 hex)</label>
                  <input id="rm-dep" value={mDepComm} onChange={(e) => setMDepComm(e.target.value)} />
                </div>
                <div className="ab-field">
                  <label htmlFor="rm-tx">initiateBurn tx id</label>
                  <input id="rm-tx" value={mTxId} onChange={(e) => setMTxId(e.target.value)} />
                </div>
                <div className="ab-field">
                  <label htmlFor="rm-dc">Dest chain id</label>
                  <input id="rm-dc" type="text" inputMode="numeric" value={mDestChain} onChange={(e) => setMDestChain(e.target.value)} />
                </div>
                <div className="ab-field">
                  <label htmlFor="rm-ct">Contract (optional)</label>
                  <input id="rm-ct" value={mContract} onChange={(e) => setMContract(e.target.value)} />
                </div>
              </div>
            ) : (
              <div className="ab-fields">
                <div className="ab-field">
                  <label htmlFor="re-bc">Burn commitment (64 hex)</label>
                  <input id="re-bc" value={eBurnComm} onChange={(e) => setEBurnComm(e.target.value)} />
                </div>
                <div className="ab-field">
                  <label htmlFor="re-btx">Burn tx (0x…)</label>
                  <input id="re-btx" value={eBurnTx} onChange={(e) => setEBurnTx(e.target.value)} />
                </div>
                <div className="ab-field">
                  <label htmlFor="re-blog">Burned log index</label>
                  <input id="re-blog" type="text" inputMode="numeric" value={eBurnLog} onChange={(e) => setEBurnLog(e.target.value)} />
                </div>
              </div>
            )}
          </div>

          <RouteArrow />

          <div className="ab-route-block ab-route-block--receive">
            <div className="ab-route-label">You receive</div>
            <p className="ab-field-hint" style={{ marginTop: 0 }}>
              {evmPayoutResolved ? <span className="mono" style={{ fontSize: '0.68rem' }}>{evmPayoutResolved}</span> : 'EVM payout'}
            </p>
          </div>
        </div>
      )}

      <div className="ab-send-dock">
        <div className="ab-send-wrap">
          <button
            type="button"
            className={`ab-send ${mode === 'mint' ? 'ab-send--mint' : 'ab-send--redeem'}`}
            disabled={busy || !ready}
            onClick={() => void submit()}
          >
            {busy ? (mode === 'mint' ? 'Resolving & sending…' : 'Sending…') : 'Send'}
          </button>
        </div>
        {err ? <p className="ab-err">{err}</p> : null}
        {res != null ? (
          <pre className="ab-response ab-response--ok">{JSON.stringify(res as object, null, 2)}</pre>
        ) : null}
      </div>
    </div>
  );
}
