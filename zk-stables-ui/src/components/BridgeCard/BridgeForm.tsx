import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useConnection, usePublicClient, useReadContract, useWriteContract } from 'wagmi';
import { formatUnits, isAddress, parseUnits, type Address, type Hex } from 'viem';
import { parseEnvEthereumAddress } from '../../utils/envAddress.js';
import { useCrossChainWallets, type SourceChainKind } from '../../contexts/CrossChainWalletContext.js';
import { useZkStables } from '../../hooks/useZkStables.js';
import { browserLockZkAtBridgeScript } from '../../cardano/browserLockZkAtBridgeScript.js';
import { sumWalletNativeUnitBalance } from '../../cardano/cardanoWalletZkBalance.js';
import { discoverCardanoBridgeLocks, type CardanoBridgeLockCandidate } from '../../cardano/discoverBridgeLockUtxos.js';
import { userWalletBridgeReleaseLockUtxo } from '../../cardano/userBridgeRelease.js';
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
import {
  erc20BalanceOfAbi,
  parseBurnedFromReceipt,
  randomBytes32Hex,
  formatZkBurnWalletError,
  zkStableBurnAbi,
} from '../../lib/evmZkStableBurn.js';

type ChainChoice = SourceChainKind;

function chainToLabel(c: ChainChoice): string {
  if (c === 'evm') return 'EVM';
  if (c === 'cardano') return 'Cardano';
  return 'Midnight';
}

function destinationApiLabel(c: ChainChoice): string {
  return c;
}

function isEvmRecipientAddress(addr: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/u.test(addr.trim());
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
  const { address: evmAddress, isConnected: evmConnected, status: evmStatus } = useConnection();
  const { cardanoUsedAddressesHex, cardanoWalletKey } = useCrossChainWallets();
  const {
    lastMidnightBurnAnchor,
    initiateBurn,
    canInitiateBurn,
    flowMessage: midnightFlowMessage,
    isConnected: midnightConnected,
  } = useZkStables();

  const [bridgeTab, setBridgeTab] = useState(0);
  const operation: 'LOCK' | 'BURN' = bridgeTab === 0 ? 'LOCK' : 'BURN';

  const [sourceChain, setSourceChain] = useState<ChainChoice>('evm');
  const [destChain, setDestChain] = useState<ChainChoice>('midnight');
  const [asset, setAsset] = useState<'USDC' | 'USDT'>('USDC');
  const [amount, setAmount] = useState('100');
  const [recipient, setRecipient] = useState('');
  /** Must equal `burnCommitment` in the on-chain `ZkStablesWrappedToken.burn` call (or paste from a burn tx receipt). */
  const [burnCommitmentHex, setBurnCommitmentHex] = useState('');
  const [burnTxHashInput, setBurnTxHashInput] = useState('');
  const [burnSideNote, setBurnSideNote] = useState<string | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [cardanoLockTx, setCardanoLockTx] = useState('');
  const [cardanoLockIdx, setCardanoLockIdx] = useState('0');
  const [cardanoLockNonce, setCardanoLockNonce] = useState('');
  const [cardanoSpendTx, setCardanoSpendTx] = useState('');
  const [cardanoRedeemNote, setCardanoRedeemNote] = useState<string | null>(null);
  const [cardanoRedeemBusy, setCardanoRedeemBusy] = useState(false);
  const [cardanoLockCandidates, setCardanoLockCandidates] = useState<CardanoBridgeLockCandidate[]>([]);
  const [cardanoLockDiscoverLoading, setCardanoLockDiscoverLoading] = useState(false);
  const [cardanoLockDiscoverErr, setCardanoLockDiscoverErr] = useState<string | null>(null);
  const [cardanoLocksRefreshKey, setCardanoLocksRefreshKey] = useState(0);
  const [midnightTxIdInput, setMidnightTxIdInput] = useState('');
  const [midnightDestChainInput, setMidnightDestChainInput] = useState('');
  const [cardanoZkWalletAtomic, setCardanoZkWalletAtomic] = useState<bigint | null>(null);
  const [cardanoRedeemLockBusy, setCardanoRedeemLockBusy] = useState(false);
  const [cardanoRedeemLockNote, setCardanoRedeemLockNote] = useState<string | null>(null);
  const [midnightBurnBusy, setMidnightBurnBusy] = useState(false);
  const [midnightBurnNote, setMidnightBurnNote] = useState<string | null>(null);

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
  const burnNeedsEvmRecipientOnly =
    operation === 'BURN' && (sourceChain === 'cardano' || sourceChain === 'midnight');

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
      else if (sourceChain === 'cardano' || sourceChain === 'midnight') {
        if (evmAddress) setRecipient(evmAddress);
        else if (evm0) setRecipient(evm0);
      }
    }
  }, [
    operation,
    sourceChain,
    destChain,
    demo.midnight.shieldedExample,
    evm0,
    evm1,
    evmAddress,
    adaDst,
    adaSrc,
    cardanoUsedAddressesHex,
  ]);

  useEffect(() => {
    applyRecipientDefaults();
  }, [applyRecipientDefaults]);

  useEffect(() => {
    if (bridgeTab === 0) {
      setSourceChain('evm');
    }
  }, [bridgeTab]);

  useEffect(() => {
    setBurnCommitmentHex('');
    setBurnTxHashInput('');
    setBurnSideNote(null);
    setCardanoLockTx('');
    setCardanoLockIdx('0');
    setCardanoLockNonce('');
    setCardanoSpendTx('');
    setCardanoRedeemNote(null);
    setMidnightTxIdInput('');
    setMidnightDestChainInput('');
  }, [operation, asset, sourceChain]);

  const cardanoZkUnitConfigured = useMemo(() => {
    const u = asset === 'USDC' ? import.meta.env.VITE_CARDANO_WUSDC_UNIT : import.meta.env.VITE_CARDANO_WUSDT_UNIT;
    return Boolean(String(u ?? '').trim());
  }, [asset]);

  useEffect(() => {
    let cancelled = false;
    if (operation !== 'BURN' || sourceChain !== 'cardano' || !cardanoWalletKey || cardanoWalletKey === 'demo') {
      setCardanoLockCandidates([]);
      setCardanoLockDiscoverErr(null);
      setCardanoLockDiscoverLoading(false);
      return;
    }
    if (!cardanoZkUnitConfigured) {
      setCardanoLockCandidates([]);
      setCardanoLockDiscoverErr(null);
      setCardanoLockDiscoverLoading(false);
      setCardanoLockTx('');
      setCardanoLockIdx('0');
      return;
    }

    setCardanoLockDiscoverLoading(true);
    setCardanoLockDiscoverErr(null);

    void discoverCardanoBridgeLocks({
      cip30WalletKey: cardanoWalletKey,
      relayerBaseUrl: relayerUrl,
      asset,
    })
      .then((c) => {
        if (cancelled) return;
        setCardanoLockCandidates(c);
        if (c.length > 0) {
          setCardanoLockTx(c[0].txHash);
          setCardanoLockIdx(String(c[0].outputIndex));
        } else {
          setCardanoLockTx('');
          setCardanoLockIdx('0');
        }
      })
      .catch((e) => {
        if (cancelled) return;
        setCardanoLockDiscoverErr(e instanceof Error ? e.message : String(e));
        setCardanoLockCandidates([]);
        setCardanoLockTx('');
        setCardanoLockIdx('0');
      })
      .finally(() => {
        if (!cancelled) setCardanoLockDiscoverLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [operation, sourceChain, cardanoWalletKey, asset, relayerUrl, cardanoZkUnitConfigured, cardanoLocksRefreshKey]);

  const cardanoNativeDecimals = Math.min(
    18,
    Math.max(0, Number.parseInt(String(import.meta.env.VITE_CARDANO_NATIVE_DECIMALS ?? '6'), 10) || 6),
  );

  useEffect(() => {
    let cancelled = false;
    if (operation !== 'BURN' || sourceChain !== 'cardano' || !cardanoWalletKey || cardanoWalletKey === 'demo' || !cardanoZkUnitConfigured) {
      setCardanoZkWalletAtomic(null);
      return;
    }
    const unit =
      asset === 'USDC'
        ? String(import.meta.env.VITE_CARDANO_WUSDC_UNIT ?? '').trim().toLowerCase()
        : String(import.meta.env.VITE_CARDANO_WUSDT_UNIT ?? '').trim().toLowerCase();
    if (!unit) {
      setCardanoZkWalletAtomic(null);
      return;
    }
    void sumWalletNativeUnitBalance({ cip30WalletKey: cardanoWalletKey, unit }).then((b) => {
      if (!cancelled) setCardanoZkWalletAtomic(b);
    });
    return () => {
      cancelled = true;
    };
  }, [operation, sourceChain, cardanoWalletKey, asset, cardanoZkUnitConfigured, cardanoLocksRefreshKey]);

  const cardanoZkMaxHuman = useMemo(() => {
    if (cardanoZkWalletAtomic === null || cardanoZkWalletAtomic <= 0n) return null;
    try {
      return formatUnits(cardanoZkWalletAtomic, cardanoNativeDecimals);
    } catch {
      return null;
    }
  }, [cardanoZkWalletAtomic, cardanoNativeDecimals]);

  const publicClient = usePublicClient();
  const { writeContractAsync, isPending: burnWalletPending } = useWriteContract();

  const wrappedTokenAddress = useMemo((): Address | undefined => {
    const raw =
      asset === 'USDT'
        ? import.meta.env.VITE_DEMO_WUSDT_ADDRESS
        : import.meta.env.VITE_DEMO_WUSDC_ADDRESS;
    return parseEnvEthereumAddress(raw);
  }, [asset]);

  /** `isConnected` stays false briefly during `connecting` even when `address` is already set — still allow burn. */
  const evmCanBurnZk = Boolean(evmAddress) && (evmConnected || evmStatus === 'connecting' || evmStatus === 'reconnecting');

  const burnZkDisabledReason = useMemo(() => {
    if (burnWalletPending) return null;
    if (!wrappedTokenAddress) {
      return 'Set VITE_DEMO_WUSDC_ADDRESS / VITE_DEMO_WUSDT_ADDRESS in .env (from deploy JSON), then restart Vite.';
    }
    if (!evmCanBurnZk) {
      return 'Connect an EVM wallet (Connect wallet or Use Anvil demo account) on Hardhat (31337) for local zk tokens.';
    }
    return null;
  }, [burnWalletPending, evmCanBurnZk, wrappedTokenAddress]);

  const underlyingUsdcAddr = useMemo(() => parseEnvEthereumAddress(import.meta.env.VITE_DEMO_USDC_ADDRESS), []);
  const underlyingUsdtAddr = useMemo(() => parseEnvEthereumAddress(import.meta.env.VITE_DEMO_USDT_ADDRESS), []);
  const underlyingEnvConfigured = Boolean(underlyingUsdcAddr && underlyingUsdtAddr);
  const underlyingReadsEnabled = underlyingEnvConfigured && Boolean(evmAddress && evmCanBurnZk);

  const { data: liveUsdcBalRaw } = useReadContract({
    address: underlyingUsdcAddr,
    abi: erc20BalanceOfAbi,
    functionName: 'balanceOf',
    args: underlyingReadsEnabled && evmAddress ? [evmAddress] : undefined,
    query: { enabled: underlyingReadsEnabled },
  });
  const { data: liveUsdtBalRaw } = useReadContract({
    address: underlyingUsdtAddr,
    abi: erc20BalanceOfAbi,
    functionName: 'balanceOf',
    args: underlyingReadsEnabled && evmAddress ? [evmAddress] : undefined,
    query: { enabled: underlyingReadsEnabled },
  });

  const zkSymbol = asset === 'USDC' ? 'zkUSDC' : 'zkUSDT';

  const recipientHelper = useMemo(() => {
    if (operation === 'BURN' && (sourceChain === 'cardano' || sourceChain === 'midnight')) {
      return `Redeem pays underlying ${asset} on EVM only — use a 0x… address (e.g. your connected wallet). You burn ${zkSymbol} on Cardano or Midnight; the relayer releases pool ${asset} on Ethereum / your configured EVM.`;
    }
    if (operation === 'BURN') {
      return `Where ${asset} (underlying stable) should be sent on EVM after you burn ${zkSymbol} on-chain — use an EVM 0x… address.`;
    }
    if (sourceChain === 'midnight') {
      if (destChain === 'evm') return 'EVM address (0x…) that should receive minted wrapped stables.';
      if (destChain === 'cardano') return 'Cardano bech32 (addr1… / addr_test1…) for native payout.';
    }
    if (destChain === 'midnight') return 'Midnight shielded (mn_…1…) or unshielded (mn_addr_…) destination.';
    if (destChain === 'cardano') return 'Cardano bech32 where the relayer sends the bridge payout.';
    if (destChain === 'evm') return 'EVM address (0x…) for ZkStablesBridgeMint.';
    return 'Mint locks mUSDC/mUSDT on EVM; recipient is where zkUSDC/zkUSDT (or native zk) is credited on the destination chain.';
  }, [operation, sourceChain, destChain, asset, zkSymbol]);

  const redeemBurnLinked = useMemo(() => {
    if (operation !== 'BURN' || sourceChain !== 'evm') return false;
    const bc = burnCommitmentHex.replace(/^0x/i, '').trim();
    return burnTxHashInput.length > 0 && bc.length === 64 && /^[0-9a-fA-F]+$/u.test(bc);
  }, [operation, sourceChain, burnTxHashInput, burnCommitmentHex]);

  const burnTxShort = useMemo(() => {
    const h = burnTxHashInput;
    if (!h || h.length < 18) return undefined;
    return `${h.slice(0, 10)}…${h.slice(-6)}`;
  }, [burnTxHashInput]);

  const { data: zkBalanceRaw } = useReadContract({
    address: wrappedTokenAddress,
    abi: erc20BalanceOfAbi,
    functionName: 'balanceOf',
    args: evmAddress && evmCanBurnZk ? [evmAddress] : undefined,
    query: {
      enabled:
        operation === 'BURN' &&
        sourceChain === 'evm' &&
        Boolean(wrappedTokenAddress && evmAddress && evmCanBurnZk),
    },
  });

  /** When an anchor exists, sync form fields; do not clear commitment when absent (user may have generated one locally). */
  useEffect(() => {
    if (operation !== 'BURN' || sourceChain !== 'midnight' || !lastMidnightBurnAnchor) return;
    setBurnCommitmentHex(lastMidnightBurnAnchor.recipientCommHex64);
    setMidnightTxIdInput(lastMidnightBurnAnchor.txId);
    setMidnightDestChainInput(lastMidnightBurnAnchor.destChain);
  }, [operation, sourceChain, lastMidnightBurnAnchor]);

  const cardanoUserBridgeRelease = useCallback(async () => {
    setCardanoRedeemNote(null);
    if (!cardanoWalletKey || cardanoWalletKey === 'demo') {
      setCardanoRedeemNote('Connect a real CIP-30 wallet (not demo) for BridgeRelease.');
      return;
    }
    const txH = cardanoLockTx.replace(/^0x/i, '').trim();
    if (txH.length !== 64 || !/^[0-9a-fA-F]+$/u.test(txH)) {
      setCardanoRedeemNote(
        'Set lock tx hash + output index (use Step 2 “Lock at bridge”, select a lock below, or paste from explorer).',
      );
      return;
    }
    const oi = Math.max(0, Number.parseInt(cardanoLockIdx, 10) || 0);
    setCardanoRedeemBusy(true);
    try {
      const r = await userWalletBridgeReleaseLockUtxo({
        cip30WalletKey: cardanoWalletKey,
        relayerBaseUrl: relayerUrl,
        lockTxHash: txH,
        lockOutputIndex: oi,
      });
      setCardanoSpendTx(r.releaseTxHash);
      setBurnCommitmentHex(r.recipientCommitmentHex64);
      setCardanoLockNonce(r.lockNonceDecimal);
      const rtx = r.releaseTxHash ?? '';
      setCardanoRedeemNote(
        rtx.length >= 12
          ? `BridgeRelease mined/submitted: ${rtx.slice(0, 12)}… — commitment filled for relayer BURN.`
          : 'BridgeRelease submitted — commitment filled for relayer BURN.',
      );
      setCardanoLocksRefreshKey((k) => k + 1);
    } catch (e) {
      setCardanoRedeemNote(e instanceof Error ? e.message : String(e));
    } finally {
      setCardanoRedeemBusy(false);
    }
  }, [cardanoLockIdx, cardanoLockTx, cardanoWalletKey, relayerUrl]);

  const generateRedeemCommitment = useCallback(() => {
    setBurnCommitmentHex(randomBytes32Hex());
    setCardanoRedeemLockNote(null);
    setMidnightBurnNote(null);
  }, []);

  const cardanoLockZkForRedeem = useCallback(async () => {
    setCardanoRedeemLockNote(null);
    const bc = burnCommitmentHex.replace(/^0x/i, '').trim().toLowerCase();
    if (bc.length !== 64 || !/^[0-9a-f]+$/u.test(bc)) {
      setCardanoRedeemLockNote('Generate a redeem commitment first (Step 1).');
      return;
    }
    if (!cardanoWalletKey || cardanoWalletKey === 'demo') {
      setCardanoRedeemLockNote('Connect a real CIP-30 wallet.');
      return;
    }
    if (!cardanoZkUnitConfigured) {
      setCardanoRedeemLockNote('Set VITE_CARDANO_WUSDC_UNIT / WUSDT_UNIT for this asset.');
      return;
    }
    setCardanoRedeemLockBusy(true);
    try {
      const r = await browserLockZkAtBridgeScript({
        cip30WalletKey: cardanoWalletKey,
        relayerBaseUrl: relayerUrl,
        asset,
        amountHuman: amount,
        lockNonceDecimal: cardanoLockNonce.trim() || undefined,
        recipientCommitmentHex64: bc,
      });
      setCardanoLockTx(r.txHash);
      setCardanoLockIdx(String(r.outputIndex));
      setCardanoLockNonce(r.lockNonce);
      setCardanoSpendTx('');
      setCardanoRedeemLockNote(
        `Locked at bridge: ${r.txHash.slice(0, 10)}…#${r.outputIndex}. Use Step 3 — Sign BridgeRelease — then Review.`,
      );
      setCardanoLocksRefreshKey((k) => k + 1);
    } catch (e) {
      setCardanoRedeemLockNote(e instanceof Error ? e.message : String(e));
    } finally {
      setCardanoRedeemLockBusy(false);
    }
  }, [amount, asset, burnCommitmentHex, cardanoLockNonce, cardanoWalletKey, cardanoZkUnitConfigured, relayerUrl]);

  const midnightInitiateBurnFromBridge = useCallback(async () => {
    setMidnightBurnNote(null);
    const bc = burnCommitmentHex.replace(/^0x/i, '').trim().toLowerCase();
    if (bc.length !== 64 || !/^[0-9a-f]+$/u.test(bc)) {
      setMidnightBurnNote('Generate a redeem commitment first (64 hex chars).');
      return;
    }
    if (!midnightConnected || !canInitiateBurn) {
      setMidnightBurnNote(
        'Connect Midnight, deploy or join the zk-stables contract, and ensure the ledger allows initiateBurn (Circuits / Developer tools).',
      );
      return;
    }
    const dest = (midnightDestChainInput.trim() || lastMidnightBurnAnchor?.destChain || '2').trim();
    setMidnightBurnBusy(true);
    try {
      await initiateBurn({ recipientCommHex64: bc, destChain: dest });
      setMidnightBurnNote('initiateBurn submitted. Fields below update from the indexer — then Review → Confirm.');
    } catch (e) {
      setMidnightBurnNote(e instanceof Error ? e.message : String(e));
    } finally {
      setMidnightBurnBusy(false);
    }
  }, [
    burnCommitmentHex,
    canInitiateBurn,
    initiateBurn,
    lastMidnightBurnAnchor?.destChain,
    midnightConnected,
    midnightDestChainInput,
  ]);

  const burnZkOnChain = useCallback(async () => {
    setBurnSideNote(null);
    if (!wrappedTokenAddress) {
      setBurnSideNote('Missing zk token address in env for this asset.');
      return;
    }
    if (!evmAddress) {
      setBurnSideNote('Connect an EVM wallet first.');
      return;
    }
    if (!publicClient) {
      setBurnSideNote('Wallet RPC not ready.');
      return;
    }
    const r = recipient.trim();
    if (!isAddress(r)) {
      setBurnSideNote('Set a valid 0x recipient (where underlying USDC/USDT should be unlocked).');
      return;
    }
    let raw: bigint;
    try {
      raw = parseUnits(amount.trim() || '0', 6);
    } catch {
      setBurnSideNote('Amount must be a decimal number (6 decimals).');
      return;
    }
    if (raw <= 0n) {
      setBurnSideNote('Amount must be greater than zero.');
      return;
    }
    const commitmentBare = randomBytes32Hex();
    const burnCommitment = `0x${commitmentBare}` as Hex;
    const nonce = `0x${randomBytes32Hex()}` as Hex;
    try {
      const hash = await writeContractAsync({
        address: wrappedTokenAddress,
        abi: zkStableBurnAbi,
        functionName: 'burn',
        args: [raw, r as Address, nonce, burnCommitment],
      });
      setBurnTxHashInput(hash);
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      const parsed = parseBurnedFromReceipt(receipt, wrappedTokenAddress);
      if (parsed) {
        setBurnCommitmentHex(parsed.burnCommitmentHex);
        setRecipient(parsed.recipientOnSource);
        setAmount(formatUnits(BigInt(parsed.amount), 6));
        setBurnSideNote(
          `${zkSymbol} burned on-chain; redeem commitment is stored for your relayer intent. Tap Review → Confirm to notify the relayer.`,
        );
      } else {
        setBurnSideNote(
          'Tx mined but no Burned log for this token (wrong network or contract?). The relayer cannot match this redeem.',
        );
      }
    } catch (e) {
      setBurnSideNote(formatZkBurnWalletError(e));
    }
  }, [amount, evmAddress, publicClient, recipient, wrappedTokenAddress, writeContractAsync, zkSymbol]);

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

  /** Cross-chain redeem: underlying lands on EVM even though the burn is on Cardano/Midnight. */
  const redeemPayoutVisual: ChainVisual =
    operation === 'BURN' && (sourceChain === 'cardano' || sourceChain === 'midnight') ? 'evm' : sourceVisual;
  const redeemPayoutAddress = useMemo(() => {
    if (operation === 'BURN' && (sourceChain === 'cardano' || sourceChain === 'midnight')) {
      return recipient.trim() || evmAddress || evm0 || '';
    }
    return sourcePillAddress;
  }, [operation, sourceChain, recipient, evmAddress, evm0, sourcePillAddress]);

  const destPillAddress = useMemo(() => {
    if (operation === 'BURN') return sourcePillAddress;
    if (destChain === 'evm') return evm1 ?? evm0 ?? '';
    if (destChain === 'cardano') return adaDst;
    return demo.midnight.shieldedExample;
  }, [operation, destChain, sourcePillAddress, evm1, evm0, adaDst, demo.midnight.shieldedExample]);

  const underlyingMaxBalance = useMemo(() => {
    if (underlyingEnvConfigured) {
      if (!evmAddress || !evmCanBurnZk) return '0';
      const raw = asset === 'USDC' ? liveUsdcBalRaw : liveUsdtBalRaw;
      if (raw === undefined) return '0';
      return formatUnits(raw, 6);
    }
    return asset === 'USDC' ? demo.demoBalances.usdc : demo.demoBalances.usdt;
  }, [
    asset,
    demo.demoBalances.usdc,
    demo.demoBalances.usdt,
    evmAddress,
    evmCanBurnZk,
    liveUsdcBalRaw,
    liveUsdtBalRaw,
    underlyingEnvConfigured,
  ]);

  const zkMaxFromWallet =
    operation === 'BURN' && sourceChain === 'evm' && zkBalanceRaw !== undefined
      ? formatUnits(zkBalanceRaw, 6)
      : null;
  const maxBalance =
    zkMaxFromWallet ??
    (operation === 'BURN' && sourceChain === 'cardano' && cardanoZkMaxHuman ? cardanoZkMaxHuman : null) ??
    underlyingMaxBalance;

  const cardanoLockTxValid = useMemo(() => {
    const txH = cardanoLockTx.replace(/^0x/i, '').trim().toLowerCase();
    return txH.length === 64 && /^[0-9a-f]+$/u.test(txH);
  }, [cardanoLockTx]);

  const fiatApprox = useMemo(() => {
    const n = Number.parseFloat(amount.replace(/,/g, ''));
    if (Number.isNaN(n)) return '—';
    return `$${(n * 1).toFixed(2)}`;
  }, [amount]);

  const redeemBurnStatus = useMemo(() => {
    if (operation !== 'BURN') return 'n/a' as const;
    if (sourceChain === 'evm') return redeemBurnLinked ? ('evm-ready' as const) : ('evm-pending' as const);
    const bc = burnCommitmentHex.replace(/^0x/i, '').trim();
    if (sourceChain === 'cardano') {
      const txH = cardanoLockTx.replace(/^0x/i, '').trim();
      const spend = cardanoSpendTx.replace(/^0x/i, '').trim();
      if (
        bc.length === 64 &&
        /^[0-9a-fA-F]+$/u.test(bc) &&
        txH.length === 64 &&
        /^[0-9a-fA-F]+$/u.test(txH) &&
        spend.length === 64 &&
        /^[0-9a-fA-F]+$/u.test(spend)
      ) {
        return 'cardano-ready' as const;
      }
      return 'cardano-pending' as const;
    }
    if (sourceChain === 'midnight') {
      const txId = midnightTxIdInput.trim() || lastMidnightBurnAnchor?.txId;
      if (txId && bc.length === 64 && /^[0-9a-fA-F]+$/u.test(bc)) return 'midnight-ready' as const;
      return 'midnight-pending' as const;
    }
    return 'non-evm' as const;
  }, [
    operation,
    sourceChain,
    redeemBurnLinked,
    burnCommitmentHex,
    cardanoLockTx,
    cardanoSpendTx,
    midnightTxIdInput,
    lastMidnightBurnAnchor,
  ]);

  const buildPayload = useCallback((): LockIntentPayload | BurnIntentPayload | null => {
    const r = recipient.trim();
    if (!r) return null;
    if (operation === 'BURN' && (sourceChain === 'cardano' || sourceChain === 'midnight') && !isEvmRecipientAddress(r)) {
      return null;
    }
    const destLabel = operation === 'LOCK' ? destinationApiLabel(destChain) : undefined;
    const bcRaw = burnCommitmentHex.replace(/^0x/i, '').trim();
    if (operation === 'BURN') {
      if (bcRaw.length !== 64 || !/^[0-9a-fA-F]+$/u.test(bcRaw)) {
        return null;
      }
    }
    const bc = bcRaw.toLowerCase();
    const connected = {
      evm: evmConnected ? evmAddress : undefined,
      cardano: cardanoWalletKey ? cardanoUsedAddressesHex[0] : undefined,
    };
    if (operation === 'BURN') {
      const burn: BurnIntentPayload = {
        operation: 'BURN',
        sourceChain,
        destinationChain: destLabel,
        asset,
        assetKind: assetKindForLabel(asset),
        amount,
        recipient: r,
        burnCommitmentHex: bc,
        connected,
        note: 'Redeem intent (SRS burn anchor → unlock underlying) via bridge UI (zk-stables-relayer).',
      };
      if (sourceChain === 'cardano') {
        const txH = cardanoLockTx.replace(/^0x/i, '').trim().toLowerCase();
        const oi = Math.max(0, Number.parseInt(cardanoLockIdx, 10) || 0);
        if (txH.length !== 64 || !/^[0-9a-f]+$/u.test(txH)) return null;
        const spendRaw = cardanoSpendTx.replace(/^0x/i, '').trim().toLowerCase();
        if (spendRaw.length !== 64 || !/^[0-9a-f]+$/u.test(spendRaw)) return null;
        burn.source = {
          cardano: {
            txHash: txH,
            outputIndex: oi,
            ...(cardanoLockNonce.trim() ? { lockNonce: cardanoLockNonce.trim() } : {}),
            spendTxHash: spendRaw,
          },
        };
      }
      if (sourceChain === 'midnight') {
        const txId = midnightTxIdInput.trim() || lastMidnightBurnAnchor?.txId;
        if (!txId) return null;
        const dc = Number.parseInt(
          (midnightDestChainInput.trim() || lastMidnightBurnAnchor?.destChain || '0').trim(),
          10,
        );
        burn.source = {
          midnight: {
            txId,
            txHash: lastMidnightBurnAnchor?.txHash,
            contractAddress: lastMidnightBurnAnchor?.contractAddress ?? undefined,
            destChainId: Number.isFinite(dc) ? dc : undefined,
          },
        };
      }
      return burn;
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
    cardanoLockTx,
    cardanoLockIdx,
    cardanoLockNonce,
    cardanoSpendTx,
    midnightTxIdInput,
    midnightDestChainInput,
    lastMidnightBurnAnchor,
    evmConnected,
    evmAddress,
    cardanoWalletKey,
    cardanoUsedAddressesHex,
  ]);

  const submit = useCallback(async () => {
    const payload = buildPayload();
    if (!payload) {
      const r = recipient.trim();
      if (
        operation === 'BURN' &&
        (sourceChain === 'cardano' || sourceChain === 'midnight') &&
        r &&
        !isEvmRecipientAddress(r)
      ) {
        setError(
          'Redeem from Cardano/Midnight pays underlying on EVM only — recipient must be a 40-character hex EVM address (0x…).',
        );
      } else if (operation === 'BURN' && sourceChain === 'evm') {
        setError(`Burn ${zkSymbol} from your wallet first (button above), then Review → Confirm to notify the relayer.`);
      } else if (operation === 'BURN' && sourceChain === 'cardano') {
        setError(
          'Cardano redeem: run BridgeRelease (section below), then ensure lock tx id, output index, spend tx id, and commitment are set.',
        );
      } else if (operation === 'BURN' && sourceChain === 'midnight') {
        setError(
          'Midnight redeem: run initiateBurn in Developer tools; tx id, dest chain, and commitment sync from session state automatically.',
        );
      } else if (operation === 'BURN') {
        setError('Complete redeem prerequisites for this source chain, then Review → Confirm.');
      } else {
        setError('Add a recipient before submitting.');
      }
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
  }, [buildPayload, operation, relayerUrl, onJobUpdate, stopPoll, zkSymbol, sourceChain, recipient]);

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
            <span title="Burn zkUSDC / zkUSDT → unlock USDC / USDT on the source chain">Redeem</span>
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

      <BridgeChainRow
        label={operation === 'BURN' ? 'Redeem on' : 'From'}
        chain={sourceVisual}
        address={sourcePillAddress}
      />

      {operation === 'BURN' ? (
        <p className="mb-2 text-[11px] leading-snug text-slate-600">
          Burn <span className="font-semibold text-slate-800">{zkSymbol}</span> on the source chain you selected. After the relayer accepts the burn anchor,{' '}
          <span className="font-semibold text-slate-800">{asset}</span> (underlying stablecoin) is released on{' '}
          <span className="font-semibold text-slate-800">EVM</span> to the recipient below
          {sourceChain === 'cardano' || sourceChain === 'midnight' ? ' — use a 0x… EVM address' : ''}.
        </p>
      ) : null}

      <div className="mb-1 flex flex-wrap items-start gap-2">
        <div className="w-[7.5rem] shrink-0">
          <label className="mb-1 block text-xs font-medium text-slate-500">
            Source{operation === 'LOCK' ? ' (EVM only)' : ''}
          </label>
          <select className={selectCls + ' w-full'} value={sourceChain} onChange={(e) => setSourceChain(e.target.value as ChainChoice)}>
            <option value="evm">EVM</option>
            {operation === 'BURN' ? (
              <>
                <option value="cardano">Cardano</option>
                <option value="midnight">Midnight</option>
              </>
            ) : null}
          </select>
        </div>
        <div className="min-w-0 flex-1">
          <label className="mb-1 block text-xs font-medium text-slate-500">
            {operation === 'BURN' ? `Amount to burn (${zkSymbol})` : 'Amount'}
          </label>
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
              title={
                operation === 'BURN' && sourceChain === 'evm' && zkMaxFromWallet
                  ? `Use full ${zkSymbol} balance`
                  : operation === 'BURN' && sourceChain === 'cardano' && cardanoZkMaxHuman
                    ? `Use full ${zkSymbol} balance in your Cardano wallet`
                    : underlyingEnvConfigured
                      ? `Use full m${asset} on EVM (demo)`
                      : 'Use max from relayer demo placeholder'
              }
            >
              Max
            </button>
          </div>
        </div>
        <div className="w-full min-[380px]:w-[9.5rem] min-[380px]:shrink-0">
          <label className="mb-1 block text-xs font-medium text-slate-500 opacity-0 min-[380px]:opacity-100">You burn</label>
          <WalletPill
            chain={sourceVisual}
            symbol={operation === 'BURN' ? zkSymbol : asset}
            address={sourcePillAddress || '—'}
            balanceLabel={
              operation === 'BURN' && sourceChain === 'evm' && zkMaxFromWallet
                ? `${zkMaxFromWallet} ${zkSymbol}`
                : operation === 'BURN' && sourceChain === 'cardano'
                  ? cardanoZkMaxHuman
                    ? `${cardanoZkMaxHuman} ${zkSymbol} (wallet)`
                    : cardanoZkUnitConfigured
                      ? `0 ${zkSymbol} (wallet)`
                      : `set VITE_CARDANO_W${asset === 'USDC' ? 'USDC' : 'USDT'}_UNIT`
                : operation === 'BURN' && sourceChain === 'midnight'
                  ? `${zkSymbol} (Midnight ledger)`
                : operation === 'BURN'
                  ? `${underlyingMaxBalance} m${asset} (EVM)`
                  : `${maxBalance} max`
            }
          />
        </div>
      </div>
      <p className="mb-4 text-xs text-slate-500">
        {operation === 'BURN' ? (
          <>
            Redeem ≈ {fiatApprox} in {asset} <span className="text-slate-400">(after relayer unlock)</span>
          </>
        ) : (
          <>
            {fiatApprox} <span className="text-emerald-700">0.0%</span>
          </>
        )}
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

      {operation === 'BURN' && (
        <div className="mb-4 flex flex-wrap items-start gap-2 rounded-xl border border-emerald-100/90 bg-emerald-50/40 px-3 py-2.5">
          <div className="min-w-0 flex-1">
            <label className="mb-1 block text-xs font-medium text-slate-600">You receive (underlying stable)</label>
            <input
              className={inputCls + ' cursor-not-allowed bg-white text-lg font-semibold text-emerald-950'}
              value={amount}
              readOnly
              aria-readonly
            />
            <p className="mt-1 text-[10px] leading-snug text-slate-500">
              Same face value in <span className="font-semibold">{asset}</span> after the relayer unlocks pool funds to your recipient.
            </p>
          </div>
          <div className="w-full min-[380px]:w-[9.5rem] min-[380px]:shrink-0">
            <label className="mb-1 block text-xs font-medium text-slate-500 opacity-0 min-[380px]:opacity-100">Payout token</label>
            <WalletPill
              chain={redeemPayoutVisual}
              symbol={asset}
              address={redeemPayoutAddress || '—'}
              balanceLabel="Relayer / pool"
            />
          </div>
        </div>
      )}

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

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">Asset</label>
          <select className={selectCls} value={asset} onChange={(e) => setAsset(e.target.value as 'USDC' | 'USDT')}>
            <option value="USDC">USDC</option>
            <option value="USDT">USDT</option>
          </select>
        </div>
        <p className="mt-5 flex-1 text-xs text-slate-500">
          {operation === 'BURN' ? (
            <>
              Burn 1 {zkSymbol} → unlock 1 {asset} <span className="text-slate-400">(demo)</span>
            </>
          ) : (
            <>
              1 {asset} ≈ 1 {asset} <span className="text-slate-400">(demo)</span>
            </>
          )}
        </p>
        <p className="mt-5 text-xs font-medium text-slate-400">Fee ~$0</p>
      </div>

      <label className="mb-1.5 block text-xs font-semibold text-slate-600">
        {operation === 'LOCK' ? 'Recipient' : `Recipient (${asset} — underlying payout)`}
        <span className="ml-1.5 font-normal text-slate-400">
          ·{' '}
          {chainToLabel(
            operation === 'LOCK' ? destChain : sourceChain === 'cardano' || sourceChain === 'midnight' ? 'evm' : sourceChain,
          )}
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
        {(lockNeedsNonMidnightRecipient || (burnNeedsSourceRecipient && sourceChain === 'evm')) && (
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
        {burnNeedsEvmRecipientOnly && (
          <button type="button" className={secondaryBtn} disabled={!evmConnected || !evmAddress} onClick={() => evmAddress && setRecipient(evmAddress)}>
            Use connected EVM
          </button>
        )}
      </div>

      {operation === 'BURN' && sourceChain === 'evm' ? (
        <div className="mb-5 space-y-3 rounded-2xl border border-dashed border-amber-400/55 bg-gradient-to-b from-amber-50/95 via-white to-white px-4 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.65)]">
          <details className="rounded-xl border border-amber-200/80 bg-white px-3 py-2.5 text-left">
            <summary className="cursor-pointer select-none text-[13px] font-semibold tracking-tight text-amber-950 [list-style-position:outside] marker:text-amber-600">
              How EVM redeem works
            </summary>
            <div className="mt-3 space-y-3 border-t border-amber-100 pt-3 text-[12px] leading-relaxed text-slate-700">
              <p>
                On EVM, redeem = call <span className="font-mono text-[11px]">burn</span> on {zkSymbol} (zk-wrapped stable). That destroys your zk balance
                and emits <span className="font-semibold">Burned</span>. The relayer matches your intent to that event, then releases {asset} (underlying) to
                your recipient. Your redeem intent includes the same 32-byte <span className="font-mono text-[11px]">burnCommitment</span> as the contract
                call—we set it when you burn from your wallet and read it back from the receipt.
              </p>
              <p className="text-[11px] leading-snug text-slate-600">
                <span className="font-semibold text-slate-800">Midnight note:</span> Relayer messages like{' '}
                <span className="font-mono text-[10px]">proveHolder</span> or <span className="whitespace-nowrap">InsufficientFunds … dust</span> refer to the
                relayer&apos;s Midnight wallet on the LOCK → Midnight path, not this screen. Fund that wallet with{' '}
                <span className="font-mono text-[10px]">local-cli fund-and-register-dust</span> if needed.
              </p>
            </div>
          </details>
          <button
            type="button"
            onClick={() => void burnZkOnChain()}
            disabled={burnWalletPending || !wrappedTokenAddress || !evmCanBurnZk}
            className="w-full rounded-2xl border-2 border-teal-700/20 bg-teal-800 py-3.5 text-sm font-semibold text-white shadow-lg shadow-teal-950/15 transition-[transform,box-shadow] hover:bg-teal-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40 disabled:pointer-events-none disabled:opacity-40 motion-safe:active:scale-[0.99]"
          >
            {burnWalletPending ? 'Confirm in wallet…' : `Burn ${zkSymbol} from wallet`}
          </button>
          {burnZkDisabledReason ? (
            <p className="text-center text-xs leading-snug text-amber-900/90">{burnZkDisabledReason}</p>
          ) : null}
          {burnSideNote ? <p className="text-center text-xs leading-snug text-amber-950">{burnSideNote}</p> : null}
        </div>
      ) : null}

      {operation === 'BURN' && sourceChain === 'cardano' ? (
        <div className="mb-5 space-y-3 rounded-2xl border border-teal-200/80 bg-teal-50/40 px-4 py-4">
          <div>
            <p className="text-[12px] font-semibold text-teal-950">Cardano redeem → EVM</p>
            <p className="mt-1 text-[11px] leading-relaxed text-slate-700">
              There is no wallet-level <span className="font-mono text-[10px]">burn</span> for native {zkSymbol} in this bridge: you lock zk at the{' '}
              <span className="font-semibold">lock_pool</span> script, sign <span className="font-semibold">BridgeRelease</span>, then notify the relayer. Underlying{' '}
              {asset} is paid on <span className="font-semibold">EVM</span> to your 0x recipient. Indexer:{' '}
              <span className="font-mono text-[10px]">VITE_YACI_URL</span> or <span className="font-mono text-[10px]">VITE_BLOCKFROST_PROJECT_ID</span>.
            </p>
          </div>

          <div className="space-y-3 rounded-xl border border-violet-200/90 bg-violet-50/50 px-3 py-3">
            <p className="text-[11px] font-semibold text-violet-950">Redeem from wallet balance</p>
            <ol className="list-decimal space-y-2 pl-4 text-[11px] leading-relaxed text-slate-700">
              <li>
                <span className="font-semibold">Commitment</span> — must match <span className="font-mono text-[10px]">recipient_commitment</span> in the lock datum
                and your relayer <span className="font-mono text-[10px]">burnCommitmentHex</span>.
                <div className="mt-1.5 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className={secondaryBtn}
                    onClick={() => generateRedeemCommitment()}
                  >
                    Generate redeem commitment
                  </button>
                </div>
              </li>
              <li>
                <span className="font-semibold">Lock {zkSymbol} at bridge</span> — moves funds from your wallet to the script using the commitment above.
                <div className="mt-1.5">
                  <label className="mb-0.5 block text-[10px] font-medium text-slate-600">Lock nonce (optional uint)</label>
                  <input
                    className={inputCls + ' mb-2 max-w-[14rem] text-sm'}
                    value={cardanoLockNonce}
                    onChange={(e) => setCardanoLockNonce(e.target.value.replace(/\s/g, ''))}
                    placeholder="Random if empty"
                    inputMode="numeric"
                  />
                  <button
                    type="button"
                    disabled={
                      cardanoRedeemLockBusy ||
                      !cardanoWalletKey ||
                      cardanoWalletKey === 'demo' ||
                      !cardanoZkUnitConfigured
                    }
                    onClick={() => void cardanoLockZkForRedeem()}
                    className="w-full rounded-xl border-2 border-violet-700/25 bg-violet-800 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-violet-900 disabled:opacity-40"
                  >
                    {cardanoRedeemLockBusy ? 'Signing…' : `Sign lock at bridge (${zkSymbol})`}
                  </button>
                </div>
              </li>
              <li>
                <span className="font-semibold">BridgeRelease</span> — use the button in the section below (works for locks you just created or locks found by
                Refresh).
              </li>
            </ol>
            {cardanoRedeemLockNote ? (
              <p className="text-[11px] leading-snug text-violet-950">{cardanoRedeemLockNote}</p>
            ) : null}
          </div>

          <div className="flex flex-wrap items-start justify-between gap-2 border-t border-teal-200/60 pt-3">
            <div>
              <p className="text-[11px] font-semibold text-teal-900">Locks already at bridge script</p>
              <p className="mt-0.5 text-[10px] leading-relaxed text-slate-600">
                Recipient-only locks from <span className="font-mono">RELAYER_CARDANO_DESTINATION_LOCK_HOLD</span> or from Step 2 above.
              </p>
            </div>
            <button
              type="button"
              disabled={cardanoLockDiscoverLoading || !cardanoWalletKey || cardanoWalletKey === 'demo' || !cardanoZkUnitConfigured}
              onClick={() => setCardanoLocksRefreshKey((k) => k + 1)}
              className="shrink-0 rounded-lg border border-teal-300/80 bg-white px-3 py-1.5 text-[11px] font-semibold text-teal-900 shadow-sm hover:bg-teal-50 disabled:opacity-40"
            >
              {cardanoLockDiscoverLoading ? 'Refreshing…' : 'Refresh locks'}
            </button>
          </div>
          {!cardanoZkUnitConfigured ? (
            <p className="rounded-lg border border-amber-200/80 bg-amber-50/90 px-3 py-2 text-[11px] text-amber-950">
              Set <span className="font-mono text-[10px]">VITE_CARDANO_WUSDC_UNIT</span> /{' '}
              <span className="font-mono text-[10px]">VITE_CARDANO_WUSDT_UNIT</span> for the selected asset so the UI can find zk native locks on-chain.
            </p>
          ) : null}
          {cardanoLockDiscoverLoading ? (
            <p className="text-center text-[12px] font-medium text-teal-900">Fetching zk lock UTxOs at the bridge script…</p>
          ) : null}
          {cardanoLockDiscoverErr ? (
            <p className="rounded-lg border border-red-200/80 bg-red-50/90 px-3 py-2 text-[11px] text-red-900">{cardanoLockDiscoverErr}</p>
          ) : null}
          {!cardanoLockDiscoverLoading && cardanoZkUnitConfigured && cardanoLockCandidates.length === 0 && !cardanoLockDiscoverErr ? (
            <p className="text-[11px] leading-relaxed text-slate-600">
              No script locks listed yet — use <span className="font-semibold">Redeem from wallet balance</span> (Step 2) to create one, or{' '}
              <span className="font-semibold">Refresh locks</span> after a mint with{' '}
              <span className="font-mono text-[10px]">RELAYER_CARDANO_DESTINATION_LOCK_HOLD=true</span>. Match{' '}
              <span className="font-mono text-[10px]">VITE_CARDANO_WUSDC_UNIT</span> / <span className="font-mono text-[10px]">WUSDT_UNIT</span> to the relayer mint
              policy.
            </p>
          ) : null}
          {cardanoLockCandidates.length > 0 ? (
            <div className="space-y-2">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Select lock to release</p>
              <ul className="space-y-2">
                {cardanoLockCandidates.map((c) => {
                  const selected = cardanoLockTx === c.txHash && cardanoLockIdx === String(c.outputIndex);
                  const zk = c.assetLabel === 'USDC' ? 'zkUSDC' : 'zkUSDT';
                  const short = c.txHash.length >= 20 ? `${c.txHash.slice(0, 10)}…${c.txHash.slice(-6)}` : c.txHash;
                  return (
                    <li key={`${c.txHash}#${c.outputIndex}`}>
                      <button
                        type="button"
                        onClick={() => {
                          setCardanoLockTx(c.txHash);
                          setCardanoLockIdx(String(c.outputIndex));
                          setCardanoRedeemNote(null);
                        }}
                        className={cn(
                          'w-full rounded-xl border px-3 py-2.5 text-left text-[12px] transition-colors',
                          selected
                            ? 'border-teal-600 bg-white shadow-sm ring-2 ring-teal-500/25'
                            : 'border-teal-200/70 bg-white/80 hover:border-teal-400 hover:bg-white',
                        )}
                      >
                        <span className="font-semibold text-teal-950">
                          {c.amountFormatted} {zk}
                        </span>
                        <span className="ml-2 font-mono text-[11px] text-slate-600">
                          #{c.outputIndex} · {short}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
          <button
            type="button"
            disabled={
              cardanoRedeemBusy ||
              !cardanoWalletKey ||
              cardanoWalletKey === 'demo' ||
              cardanoLockDiscoverLoading ||
              !cardanoLockTxValid
            }
            onClick={() => void cardanoUserBridgeRelease()}
            className="w-full rounded-xl border-2 border-teal-700/25 bg-teal-800 py-3 text-sm font-semibold text-white shadow-md transition-colors hover:bg-teal-900 disabled:opacity-40"
          >
            {cardanoRedeemBusy ? 'Signing…' : 'Sign BridgeRelease in wallet'}
          </button>
          {cardanoRedeemNote ? <p className="text-center text-[11px] text-teal-950">{cardanoRedeemNote}</p> : null}
          <p className="text-[10px] leading-snug text-slate-600">
            After release, the spend tx id and <span className="font-mono">recipient_commitment</span> are filled for the relayer POST.
          </p>
        </div>
      ) : null}

      {operation === 'BURN' && sourceChain === 'midnight' ? (
        <div className="mb-5 space-y-3 rounded-2xl border border-indigo-200/80 bg-indigo-50/40 px-4 py-4">
          <p className="text-[12px] font-semibold text-indigo-950">Midnight redeem → EVM</p>
          <p className="text-[11px] leading-relaxed text-slate-700">
            Call <span className="font-mono text-[10px]">initiateBurn(destChain, recipientComm)</span> on your joined zk-stables contract. The commitment must match{' '}
            <span className="font-mono text-[10px]">burnCommitmentHex</span> below. Underlying <span className="font-semibold">{asset}</span> is paid on{' '}
            <span className="font-semibold">EVM</span> — recipient above must be 0x….
          </p>
          <div className="flex flex-wrap items-end gap-2 rounded-xl border border-indigo-200/70 bg-white/80 px-3 py-3">
            <div className="min-w-[8rem] flex-1">
              <label className="mb-1 block text-[10px] font-medium text-slate-600">Destination chain id</label>
              <input
                className={inputCls + ' text-sm'}
                value={midnightDestChainInput}
                onChange={(e) => setMidnightDestChainInput(e.target.value.replace(/\s/g, ''))}
                placeholder="e.g. 2"
                inputMode="numeric"
              />
            </div>
            <button type="button" className={secondaryBtn} onClick={() => generateRedeemCommitment()}>
              Generate redeem commitment
            </button>
            <button
              type="button"
              disabled={midnightBurnBusy || !midnightConnected || !canInitiateBurn}
              onClick={() => void midnightInitiateBurnFromBridge()}
              className="rounded-xl border-2 border-indigo-700/25 bg-indigo-800 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-900 disabled:opacity-40"
            >
              {midnightBurnBusy ? 'Proving / signing…' : `Run initiateBurn (${zkSymbol})`}
            </button>
          </div>
          {midnightFlowMessage ? (
            <p className="text-center text-[11px] font-medium text-indigo-900">{midnightFlowMessage}</p>
          ) : null}
          {midnightBurnNote ? <p className="text-center text-[11px] text-indigo-950">{midnightBurnNote}</p> : null}
          {!midnightConnected ? (
            <p className="text-[10px] text-amber-900">Connect Midnight (Lace or dev seed) and deploy/join the contract first.</p>
          ) : !canInitiateBurn ? (
            <p className="text-[10px] text-slate-600">
              Ledger state must allow initiateBurn (often after mint path). Use <span className="font-semibold">Developer tools → Circuits</span> if you need proveHolder / mint steps first.
            </p>
          ) : null}
          {lastMidnightBurnAnchor ? (
            <div className="space-y-2 rounded-xl border border-indigo-200/70 bg-white/90 px-3 py-3 text-[11px] shadow-sm">
              <div className="flex flex-wrap gap-x-2 gap-y-1">
                <span className="font-semibold text-slate-600">Tx id</span>
                <span className="break-all font-mono text-slate-900" title={lastMidnightBurnAnchor.txId}>
                  {lastMidnightBurnAnchor.txId.length > 36
                    ? `${lastMidnightBurnAnchor.txId.slice(0, 18)}…${lastMidnightBurnAnchor.txId.slice(-14)}`
                    : lastMidnightBurnAnchor.txId}
                </span>
              </div>
              <div className="flex flex-wrap gap-x-2">
                <span className="font-semibold text-slate-600">Dest chain</span>
                <span className="font-mono text-slate-900">{lastMidnightBurnAnchor.destChain}</span>
              </div>
              <div className="flex flex-wrap gap-x-2 gap-y-1">
                <span className="font-semibold text-slate-600">Commitment</span>
                <span className="break-all font-mono text-[10px] text-slate-800" title={lastMidnightBurnAnchor.recipientCommHex64}>
                  {lastMidnightBurnAnchor.recipientCommHex64}
                </span>
              </div>
              {lastMidnightBurnAnchor.txHash ? (
                <div className="flex flex-wrap gap-x-2 gap-y-1 text-[10px] text-slate-500">
                  <span className="font-semibold">Tx hash</span>
                  <span className="break-all font-mono">{lastMidnightBurnAnchor.txHash}</span>
                </div>
              ) : null}
            </div>
          ) : (
            <p className="rounded-lg border border-amber-200/80 bg-amber-50/90 px-3 py-2 text-[11px] text-amber-950">
              No <span className="font-mono text-[10px]">initiateBurn</span> anchor in this session yet. Generate a commitment above, then run{' '}
              <span className="font-semibold">initiateBurn</span> — or use Developer tools → Circuits for the same call.
            </p>
          )}
        </div>
      ) : null}

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
        zkAssetLabel={operation === 'BURN' ? zkSymbol : undefined}
        amount={amount}
        recipient={recipient.trim() || '—'}
        redeemBurnStatus={redeemBurnStatus}
        burnTxSummary={burnTxShort}
        crossChainRedeemToEvm={operation === 'BURN' && (sourceChain === 'cardano' || sourceChain === 'midnight')}
      />
    </div>
  );
};
