import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useConnection, useConnect, usePublicClient, useReadContract, useSwitchChain, useWriteContract } from 'wagmi';
import { formatUnits, isAddress, parseUnits, type Address, type Hex } from 'viem';
import { hardhat } from 'viem/chains';
import { parseEnvEthereumAddress } from '../../utils/envAddress.js';
import { useCrossChainWallets, type SourceChainKind } from '../../contexts/CrossChainWalletContext.js';
import { useZkStables } from '../../hooks/useZkStables.js';
import { browserLockZkAtBridgeScript } from '../../cardano/browserLockZkAtBridgeScript.js';
import { sumWalletNativeUnitBalance } from '../../cardano/cardanoWalletZkBalance.js';
import { fetchYaciAddressNativeAssetQuantity, resolveYaciStoreBaseUrl } from '../../lib/yaciAddressBalance.js';
import { discoverCardanoBridgeLocks, type CardanoBridgeLockCandidate } from '../../cardano/discoverBridgeLockUtxos.js';
import { userWalletBridgeReleaseLockUtxo } from '../../cardano/userBridgeRelease.js';
import { isDemoCardanoMnemonicConfigured } from '../../cardano/demoMnemonicMeshWallet.js';
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
import { demoWalletsEnabled } from '../../demo/constants.js';
import {
  erc20BalanceOfAbi,
  erc20ApproveAbi,
  poolLockAbi,
  parseBurnedFromReceipt,
  parseLockedFromReceipt,
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
  const {
    address: evmAddress,
    isConnected: evmConnected,
    status: evmStatus,
    connector: evmConnector,
    chain: evmChain,
  } = useConnection();
  const { connectors, connect, isPending: evmConnectPending, error: evmConnectError } = useConnect();
  const { switchChain } = useSwitchChain();
  const mockConnector = useMemo(() => connectors.find((c) => c.id === 'mock'), [connectors]);
  const primaryEvmConnector = connectors[0];

  useEffect(() => {
    if (evmConnector?.id !== 'mock' || evmChain?.id === hardhat.id) return;
    switchChain({ chainId: hardhat.id });
  }, [evmChain?.id, evmConnector?.id, switchChain]);
  const { cardanoUsedAddressesHex, cardanoWalletKey } = useCrossChainWallets();
  const {
    lastMidnightBurnAnchor,
    ledger,
    initiateBurn,
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
  const [burnCommitmentHex, setBurnCommitmentHex] = useState('');
  const [burnTxHashInput, setBurnTxHashInput] = useState('');
  const [burnSideNote, setBurnSideNote] = useState<string | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const usedCommitmentsRef = useRef<Set<string>>(new Set());

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
  }, [operation, asset, sourceChain]);

  const cardanoZkUnitConfigured = useMemo(() => {
    const u = asset === 'USDC' ? import.meta.env.VITE_CARDANO_WUSDC_UNIT : import.meta.env.VITE_CARDANO_WUSDT_UNIT;
    return Boolean(String(u ?? '').trim());
  }, [asset]);

  /** Lock discovery scans both zk native units; enable Refresh when either is set in env. */
  const cardanoDiscoverUnitsConfigured = useMemo(
    () =>
      Boolean(String(import.meta.env.VITE_CARDANO_WUSDC_UNIT ?? '').trim()) ||
      Boolean(String(import.meta.env.VITE_CARDANO_WUSDT_UNIT ?? '').trim()),
    [],
  );

  const cardanoDemoMnemonicSigning = useMemo(
    () => cardanoWalletKey === 'demo' && isDemoCardanoMnemonicConfigured(),
    [cardanoWalletKey],
  );

  const cardanoCanSignBridgeOps = useMemo(
    () => cardanoWalletKey === 'demo' && isDemoCardanoMnemonicConfigured(),
    [cardanoWalletKey],
  );

  useEffect(() => {
    let cancelled = false;
    const skipDiscover =
      !cardanoWalletKey || (cardanoWalletKey === 'demo' && !isDemoCardanoMnemonicConfigured());
    if (operation !== 'BURN' || sourceChain !== 'cardano' || skipDiscover) {
      setCardanoLockCandidates([]);
      setCardanoLockDiscoverErr(null);
      setCardanoLockDiscoverLoading(false);
      return;
    }
    if (!cardanoDiscoverUnitsConfigured) {
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
      useDemoMnemonicWallet: cardanoDemoMnemonicSigning,
      relayerBaseUrl: relayerUrl,
      asset,
    })
      .then((c) => {
        if (cancelled) return;
        setCardanoLockCandidates(c);
        if (c.length > 0) {
          setCardanoLockTx(c[0].txHash);
          setCardanoLockIdx(String(c[0].outputIndex));
        }
        /* Do not clear cardanoLockTx / cardanoLockIdx when the list is empty: Step 2 already set
         * them, and Yaci/Mesh can return [] transiently or until indexer catches up. */
      })
      .catch((e) => {
        if (cancelled) return;
        setCardanoLockDiscoverErr(e instanceof Error ? e.message : String(e));
        setCardanoLockCandidates([]);
        /* Keep manual / Step 2 lock fields so Sign BridgeRelease stays usable while discovery fails. */
      })
      .finally(() => {
        if (!cancelled) setCardanoLockDiscoverLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    operation,
    sourceChain,
    cardanoWalletKey,
    cardanoDemoMnemonicSigning,
    asset,
    relayerUrl,
    cardanoDiscoverUnitsConfigured,
    cardanoLocksRefreshKey,
  ]);

  const cardanoNativeDecimals = Math.min(
    18,
    Math.max(0, Number.parseInt(String(import.meta.env.VITE_CARDANO_NATIVE_DECIMALS ?? '6'), 10) || 6),
  );

  const cardanoZkBalanceLabelContext = useMemo(() => {
    if (operation !== 'BURN' || sourceChain !== 'cardano') return 'wallet' as const;
    if (cardanoWalletKey && cardanoWalletKey !== 'demo') return 'wallet' as const;
    if (cardanoWalletKey === 'demo' && isDemoCardanoMnemonicConfigured()) return 'wallet' as const;
    return 'on-chain' as const;
  }, [operation, sourceChain, cardanoWalletKey]);

  useEffect(() => {
    let cancelled = false;
    if (operation !== 'BURN' || sourceChain !== 'cardano' || !cardanoZkUnitConfigured) {
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

    const useMeshBalance = Boolean(
      cardanoWalletKey && (cardanoWalletKey !== 'demo' || isDemoCardanoMnemonicConfigured()),
    );
    if (useMeshBalance) {
      void sumWalletNativeUnitBalance({
        cip30WalletKey: cardanoWalletKey!,
        useDemoMnemonicWallet: cardanoWalletKey === 'demo',
        unit,
      }).then((b) => {
        if (!cancelled) setCardanoZkWalletAtomic(b);
      });
      return () => {
        cancelled = true;
      };
    }

    const yaciBase = resolveYaciStoreBaseUrl();
    const bech32 = adaSrc.trim();
    if (!yaciBase || !bech32) {
      setCardanoZkWalletAtomic(null);
      return;
    }

    void fetchYaciAddressNativeAssetQuantity({ yaciStoreBaseUrl: yaciBase, bech32, assetUnit: unit })
      .then((b) => {
        if (!cancelled) setCardanoZkWalletAtomic(b);
      })
      .catch(() => {
        if (!cancelled) setCardanoZkWalletAtomic(null);
      });
    return () => {
      cancelled = true;
    };
  }, [
    operation,
    sourceChain,
    cardanoWalletKey,
    asset,
    cardanoZkUnitConfigured,
    cardanoLocksRefreshKey,
    adaSrc,
  ]);

  const cardanoZkMaxHuman = useMemo(() => {
    if (cardanoZkWalletAtomic === null || cardanoZkWalletAtomic <= 0n) return null;
    try {
      return formatUnits(cardanoZkWalletAtomic, cardanoNativeDecimals);
    } catch {
      return null;
    }
  }, [cardanoZkWalletAtomic, cardanoNativeDecimals]);

  const poolLockAddress = useMemo(
    () => parseEnvEthereumAddress(import.meta.env.VITE_EVM_POOL_LOCK),
    [],
  );

  const publicClient = usePublicClient();
  const { writeContractAsync, isPending: walletPending } = useWriteContract();

  const wrappedTokenAddress = useMemo((): Address | undefined => {
    const raw =
      asset === 'USDT'
        ? import.meta.env.VITE_DEMO_WUSDT_ADDRESS
        : import.meta.env.VITE_DEMO_WUSDC_ADDRESS;
    return parseEnvEthereumAddress(raw);
  }, [asset]);

  /** `isConnected` stays false briefly during `connecting` even when `address` is already set — still allow burn. */
  const evmCanBurnZk = Boolean(evmAddress) && (evmConnected || evmStatus === 'connecting' || evmStatus === 'reconnecting');
  /**
   * Same holder as the EVM source pill: wagmi address when connected, else relayer demo account (0xf39…).
   * `useConnection().address` is undefined with mock/disconnected UI — balanceOf must still target the shown address.
   */
  const evmUnderlyingBalanceAddress = useMemo((): Address | undefined => {
    const raw = evmConnected && evmAddress ? evmAddress : evm0;
    return raw && isAddress(raw) ? (raw as Address) : undefined;
  }, [evmConnected, evmAddress, evm0]);

  const burnZkDisabledReason = useMemo(() => {
    if (walletPending) return null;
    if (!wrappedTokenAddress) {
      return import.meta.env.DEV
        ? 'Set VITE_DEMO_WUSDC_ADDRESS / VITE_DEMO_WUSDT_ADDRESS in .env, then restart Vite.'
        : 'Token address not configured.';
    }
    if (!evmCanBurnZk) {
      return 'Connect an EVM wallet to burn zk tokens.';
    }
    return null;
  }, [walletPending, evmCanBurnZk, wrappedTokenAddress]);

  const underlyingUsdcAddr = useMemo(() => parseEnvEthereumAddress(import.meta.env.VITE_DEMO_USDC_ADDRESS), []);
  const underlyingUsdtAddr = useMemo(() => parseEnvEthereumAddress(import.meta.env.VITE_DEMO_USDT_ADDRESS), []);
  const underlyingPayoutAddr = useMemo(
    () => (asset === 'USDC' ? underlyingUsdcAddr : underlyingUsdtAddr),
    [asset, underlyingUsdcAddr, underlyingUsdtAddr],
  );
  const underlyingEnvConfigured = Boolean(underlyingUsdcAddr && underlyingUsdtAddr);
  const underlyingReadsEnabled =
    underlyingEnvConfigured && sourceChain === 'evm' && Boolean(evmUnderlyingBalanceAddress);

  const { data: liveUsdcBalRaw } = useReadContract({
    address: underlyingUsdcAddr,
    abi: erc20BalanceOfAbi,
    functionName: 'balanceOf',
    args: underlyingReadsEnabled && evmUnderlyingBalanceAddress ? [evmUnderlyingBalanceAddress] : undefined,
    query: { enabled: underlyingReadsEnabled },
  });
  const { data: liveUsdtBalRaw } = useReadContract({
    address: underlyingUsdtAddr,
    abi: erc20BalanceOfAbi,
    functionName: 'balanceOf',
    args: underlyingReadsEnabled && evmUnderlyingBalanceAddress ? [evmUnderlyingBalanceAddress] : undefined,
    query: { enabled: underlyingReadsEnabled },
  });

  const zkSymbol = asset === 'USDC' ? 'zkUSDC' : 'zkUSDT';

  

  const redeemBurnLinked = useMemo(() => {
    if (operation !== 'BURN' || sourceChain !== 'evm') return false;
    const bc = burnCommitmentHex.replace(/^0x/i, '').trim();
    return burnTxHashInput.length > 0 && bc.length === 64 && /^[0-9a-fA-F]+$/u.test(bc);
  }, [operation, sourceChain, burnTxHashInput, burnCommitmentHex]);

  const burnCommitmentBare = useMemo(() => burnCommitmentHex.replace(/^0x/i, '').trim(), [burnCommitmentHex]);
  const burnCommitmentFieldValid = useMemo(
    () => burnCommitmentBare.length === 64 && /^[0-9a-fA-F]+$/u.test(burnCommitmentBare),
    [burnCommitmentBare],
  );

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
  }, [operation, sourceChain, lastMidnightBurnAnchor]);

  const cardanoUserBridgeRelease = useCallback(async () => {
    setCardanoRedeemNote(null);
    if (!cardanoWalletKey) {
      setCardanoRedeemNote(
        import.meta.env.DEV
          ? 'Enable Cardano in-app signing: set VITE_DEMO_CARDANO_WALLET_MNEMONIC (same as relayer) and rebuild.'
          : 'Cardano wallet not configured.',
      );
      return;
    }
    if (cardanoWalletKey === 'demo' && !isDemoCardanoMnemonicConfigured()) {
      setCardanoRedeemNote(
        import.meta.env.DEV
          ? 'Cardano wallet not configured — set VITE_DEMO_CARDANO_WALLET_MNEMONIC (same as relayer) and rebuild.'
          : 'Cardano wallet not configured.',
      );
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
        useDemoMnemonicWallet: cardanoWalletKey === 'demo',
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
    setCardanoRedeemLockNote(null);
    setMidnightBurnNote(null);
    try {
      setBurnCommitmentHex(randomBytes32Hex());
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setCardanoRedeemLockNote(`Could not generate commitment: ${msg}`);
      setMidnightBurnNote(`Could not generate commitment: ${msg}`);
    }
  }, []);

  const cardanoLockZkForRedeem = useCallback(async () => {
    setCardanoRedeemLockNote(null);
    const bc = burnCommitmentHex.replace(/^0x/i, '').trim().toLowerCase();
    if (bc.length !== 64 || !/^[0-9a-f]+$/u.test(bc)) {
      setCardanoRedeemLockNote('Generate a redeem commitment first (Step 1).');
      return;
    }
    if (!cardanoWalletKey) {
      setCardanoRedeemLockNote(
        import.meta.env.DEV
          ? 'Restore the in-app Cardano wallet (mnemonic must be set in the build via VITE_DEMO_CARDANO_WALLET_MNEMONIC).'
          : 'Cardano wallet not configured.',
      );
      return;
    }
    if (cardanoWalletKey === 'demo' && !isDemoCardanoMnemonicConfigured()) {
      setCardanoRedeemLockNote(
        import.meta.env.DEV
          ? 'Set VITE_DEMO_CARDANO_WALLET_MNEMONIC (same phrase as RELAYER_CARDANO_WALLET_MNEMONIC) and rebuild.'
          : 'Cardano wallet not configured.',
      );
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
        useDemoMnemonicWallet: cardanoWalletKey === 'demo',
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
    if (!midnightConnected) {
      setMidnightBurnNote('Connect Midnight wallet first.');
      return;
    }
    const depBytes = new Uint8Array(32);
    for (let i = 0; i < 32; i++) depBytes[i] = parseInt(bc.slice(i * 2, i * 2 + 2), 16);
    setMidnightBurnBusy(true);
    try {
      await initiateBurn({ depositCommitment: depBytes, recipientCommHex64: bc, destChain: '2' });
      setMidnightBurnNote('initiateBurn submitted. Fields below update from the indexer — then Review → Confirm.');
    } catch (e) {
      setMidnightBurnNote(e instanceof Error ? e.message : String(e));
    } finally {
      setMidnightBurnBusy(false);
    }
  }, [
    burnCommitmentHex,
    initiateBurn,
    midnightConnected,
  ]);

  const [lockBusy, setLockBusy] = useState(false);
  const [lockNote, setLockNote] = useState<string | null>(null);
  /** Set after a successful `pool.lock` so HTTP LOCK carries `source.evm` (relayer proves real deposit). */
  const [evmLockAnchor, setEvmLockAnchor] = useState<{
    txHash: Hex;
    logIndex: number;
    blockNumber: string;
    poolLockAddress: Address;
    token: Address;
    nonce: Hex;
    amountRaw: bigint;
  } | null>(null);

  useEffect(() => {
    setEvmLockAnchor(null);
  }, [amount, recipient, asset, destChain, operation, sourceChain]);

  const underlyingTokenAddr = useMemo((): Address | undefined => {
    const raw = asset === 'USDT' ? import.meta.env.VITE_DEMO_USDT_ADDRESS : import.meta.env.VITE_DEMO_USDC_ADDRESS;
    return parseEnvEthereumAddress(raw);
  }, [asset]);

  const evmLockOnChain = useCallback(async () => {
    setLockNote(null);
    if (!poolLockAddress) {
      setLockNote('Set VITE_EVM_POOL_LOCK in .env and rebuild.');
      return;
    }
    if (!underlyingTokenAddr) {
      setLockNote('Set VITE_DEMO_USDC_ADDRESS / VITE_DEMO_USDT_ADDRESS in .env and rebuild.');
      return;
    }
    if (!evmAddress || !publicClient) {
      setLockNote('Connect an EVM wallet first.');
      return;
    }
    const r = recipient.trim();
    if (!r) {
      setLockNote('Set a recipient address.');
      return;
    }
    let raw: bigint;
    try {
      raw = parseUnits(amount.trim() || '0', 6);
    } catch {
      setLockNote('Amount must be a decimal number (6 decimals).');
      return;
    }
    if (raw <= 0n) {
      setLockNote('Amount must be greater than zero.');
      return;
    }
    const nonce = `0x${randomBytes32Hex()}` as Hex;
    setLockBusy(true);
    try {
      const approveHash = await writeContractAsync({
        address: underlyingTokenAddr,
        abi: erc20ApproveAbi,
        functionName: 'approve',
        args: [poolLockAddress, raw],
      });
      await publicClient.waitForTransactionReceipt({ hash: approveHash });

      const lockHash = await writeContractAsync({
        address: poolLockAddress,
        abi: poolLockAbi,
        functionName: 'lock',
        args: [underlyingTokenAddr, raw, r as Address, nonce],
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash: lockHash });
      if (!poolLockAddress) {
        setLockNote('Internal error: pool address missing after lock.');
        return;
      }
      const parsed = parseLockedFromReceipt(receipt, poolLockAddress);
      if (!parsed) {
        setLockNote(
          `Tx ${lockHash.slice(0, 14)}… confirmed but no Locked event found for this pool — check VITE_EVM_POOL_LOCK.`,
        );
        setEvmLockAnchor(null);
        return;
      }
      setEvmLockAnchor({
        txHash: parsed.txHash,
        logIndex: parsed.logIndex,
        blockNumber: parsed.blockNumber.toString(),
        poolLockAddress,
        token: parsed.token,
        nonce: parsed.nonce,
        amountRaw: parsed.amount,
      });
      setLockNote(
        `Locked on-chain — tx ${lockHash.slice(0, 14)}… (block ${receipt.blockNumber}). ` +
          `Review → Confirm sends this lock to the relayer (mint will not run without this on-chain anchor).`,
      );
    } catch (e) {
      setLockNote(e instanceof Error ? e.message : String(e));
    } finally {
      setLockBusy(false);
    }
  }, [amount, evmAddress, publicClient, recipient, writeContractAsync, poolLockAddress, underlyingTokenAddr]);

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

  const destPillAddress = useMemo(() => {
    if (operation === 'BURN') return sourcePillAddress;
    if (destChain === 'evm') return evm1 ?? evm0 ?? '';
    if (destChain === 'cardano') return adaDst;
    return demo.midnight.shieldedExample;
  }, [operation, destChain, sourcePillAddress, evm1, evm0, adaDst, demo.midnight.shieldedExample]);

  const underlyingMaxBalance = useMemo(() => {
    if (!underlyingEnvConfigured) {
      return asset === 'USDC' ? demo.demoBalances.usdc : demo.demoBalances.usdt;
    }
    if (sourceChain !== 'evm') {
      return asset === 'USDC' ? demo.demoBalances.usdc : demo.demoBalances.usdt;
    }
    if (!evmUnderlyingBalanceAddress) return '0';
    const raw = asset === 'USDC' ? liveUsdcBalRaw : liveUsdtBalRaw;
    if (raw === undefined) return '0';
    return formatUnits(raw, 6);
  }, [
    asset,
    demo.demoBalances.usdc,
    demo.demoBalances.usdt,
    evmUnderlyingBalanceAddress,
    liveUsdcBalRaw,
    liveUsdtBalRaw,
    sourceChain,
    underlyingEnvConfigured,
  ]);

  /** Lock is only offered when the displayed underlying balance is greater than zero (avoids signing a doomed tx). */
  const hasPositiveUnderlyingForLock = useMemo(() => {
    const n = Number.parseFloat(String(underlyingMaxBalance).replace(/,/g, ''));
    return Number.isFinite(n) && n > 0;
  }, [underlyingMaxBalance]);

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

  /** When signing is still impossible (no mnemonic in build or demo disconnected). */
  const cardanoSignBlockedWhy = useMemo((): string | null => {
    if (operation !== 'BURN' || sourceChain !== 'cardano') return null;
    if (!cardanoWalletKey) {
      return import.meta.env.DEV
        ? 'Set VITE_DEMO_CARDANO_WALLET_MNEMONIC (same phrase as the relayer bridge wallet) and rebuild — signing is mnemonic-only (no browser wallet).'
        : 'Cardano wallet not configured.';
    }
    if (cardanoWalletKey === 'demo' && !isDemoCardanoMnemonicConfigured()) {
      return import.meta.env.DEV
        ? 'Cardano wallet not configured: add VITE_DEMO_CARDANO_WALLET_MNEMONIC (copy from relayer .env) and rebuild.'
        : 'Cardano wallet not configured.';
    }
    return null;
  }, [operation, sourceChain, cardanoWalletKey]);

  const signLockAtBridgeTitle = useMemo(() => {
    if (cardanoRedeemLockBusy) return 'Signing transaction…';
    if (!cardanoZkUnitConfigured) return 'Set VITE_CARDANO_WUSDC_UNIT / WUSDT_UNIT and rebuild.';
    if (cardanoSignBlockedWhy) return cardanoSignBlockedWhy;
    return `Lock ${zkSymbol} at the bridge script with the commitment above`;
  }, [cardanoRedeemLockBusy, cardanoZkUnitConfigured, cardanoSignBlockedWhy, zkSymbol]);

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
      const crossChainRedeem = sourceChain === 'cardano' || sourceChain === 'midnight';
      const bcOk = bcRaw.length === 64 && /^[0-9a-fA-F]+$/u.test(bcRaw);
      if (bcOk && usedCommitmentsRef.current.has(bcRaw.toLowerCase())) {
        setError('This commitment was already submitted. Generate a new one to avoid a duplicate burn nonce on-chain.');
        return null;
      }
      if (!crossChainRedeem && !bcOk) {
        return null;
      }
      if (crossChainRedeem && bcRaw.length > 0 && !bcOk) {
        return null;
      }
    }
    const bc =
      bcRaw.length === 64 && /^[0-9a-fA-F]+$/u.test(bcRaw) ? bcRaw.toLowerCase() : '';
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
          (lastMidnightBurnAnchor?.destChain || '2').trim(),
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
    if (sourceChain === 'evm') {
      if (!evmLockAnchor || !underlyingTokenAddr) return null;
      if (underlyingTokenAddr.toLowerCase() !== evmLockAnchor.token.toLowerCase()) return null;
      let wantRaw: bigint;
      try {
        wantRaw = parseUnits(amount.trim() || '0', 6);
      } catch {
        return null;
      }
      if (wantRaw !== evmLockAnchor.amountRaw) return null;
      return {
        operation: 'LOCK',
        sourceChain,
        destinationChain: destLabel,
        asset,
        assetKind: assetKindForLabel(asset),
        amount,
        recipient: r,
        connected,
        note: 'LOCK intent via bridge UI (zk-stables-relayer); anchored to on-chain pool.lock.',
        source: {
          evm: {
            txHash: evmLockAnchor.txHash,
            logIndex: evmLockAnchor.logIndex,
            blockNumber: evmLockAnchor.blockNumber,
            poolLockAddress: evmLockAnchor.poolLockAddress,
            token: evmLockAnchor.token,
            nonce: evmLockAnchor.nonce,
          },
        },
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
    cardanoLockTx,
    cardanoLockIdx,
    cardanoLockNonce,
    cardanoSpendTx,
    midnightTxIdInput,
    lastMidnightBurnAnchor,
    evmConnected,
    evmAddress,
    cardanoWalletKey,
    cardanoUsedAddressesHex,
    evmLockAnchor,
    underlyingTokenAddr,
  ]);

  const submit = useCallback(async () => {
    if (operation === 'LOCK' && sourceChain === 'evm' && !evmLockAnchor) {
      setError(
        'Mint requires locking USDC/USDT on-chain first (use “Lock … on-chain” with a connected wallet), then Review → Confirm without changing amount or asset.',
      );
      return;
    }
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
          'Complete Cardano BridgeRelease flow first, then Review → Confirm.',
        );
      } else if (operation === 'BURN' && sourceChain === 'midnight') {
        setError(
          'Run initiateBurn on Midnight first, then Review → Confirm.',
        );
      } else if (operation === 'BURN') {
        setError('Complete redeem prerequisites first, then Review → Confirm.');
      } else if (operation === 'LOCK' && sourceChain === 'evm') {
        setError(
          'Amount and asset must match your last on-chain lock, and the locked token must be the selected USDC/USDT.',
        );
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
      if (payload.operation === 'LOCK') {
        setEvmLockAnchor(null);
      }
      if (payload.operation === 'BURN' && 'burnCommitmentHex' in payload && payload.burnCommitmentHex) {
        usedCommitmentsRef.current.add(payload.burnCommitmentHex.toLowerCase());
        setBurnCommitmentHex('');
      }
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
  }, [buildPayload, operation, relayerUrl, onJobUpdate, stopPoll, zkSymbol, sourceChain, recipient, evmLockAnchor]);

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
            <span title="Burn zkUSDC / zkUSDT → unlock USDC / USDT on EVM">Redeem</span>
          </button>
        </div>
      </div>

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
                    ? `Use full ${zkSymbol} balance (${cardanoZkBalanceLabelContext})`
                    : underlyingEnvConfigured
                      ? `Use full ${asset} balance on EVM`
                      : 'Use max from relayer'
              }
            >
              Max
            </button>
          </div>
        </div>
        <div className="w-full min-[380px]:w-[9.5rem] min-[380px]:shrink-0">
          <label className="mb-1 block text-xs font-medium text-slate-500 opacity-0 min-[380px]:opacity-100">
            {operation === 'BURN' ? 'You burn' : 'Balance'}
          </label>
          <WalletPill
            chain={sourceVisual}
            symbol={operation === 'BURN' ? zkSymbol : asset}
            address={sourcePillAddress || '—'}
            balanceLabel={
              operation === 'BURN' && sourceChain === 'evm' && zkMaxFromWallet
                ? `${zkMaxFromWallet} ${zkSymbol}`
                : operation === 'BURN' && sourceChain === 'cardano'
                  ? cardanoZkMaxHuman
                    ? `${cardanoZkMaxHuman} ${zkSymbol} (${cardanoZkBalanceLabelContext})`
                    : cardanoZkUnitConfigured
                      ? `0 ${zkSymbol} (${cardanoZkBalanceLabelContext})`
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
            <label className="mb-1 block text-xs font-medium text-slate-600">You receive ({asset} on EVM)</label>
            <input
              className={inputCls + ' cursor-not-allowed bg-white text-lg font-semibold text-emerald-950'}
              value={amount}
              readOnly
              aria-readonly
            />
            
          </div>
          <div className="w-full min-[380px]:w-[9.5rem] min-[380px]:shrink-0">
            <label className="mb-1 block text-xs font-medium text-slate-500 opacity-0 min-[380px]:opacity-100">Payout token</label>
            <WalletPill
              chain={redeemPayoutVisual}
              symbol={asset}
              address={underlyingPayoutAddr ?? '—'}
              balanceLabel="ERC-20"
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
              Burn 1 {zkSymbol} → unlock 1 {asset}
            </>
          ) : (
            <>
              1 {asset} ≈ 1 {asset} <span className="text-slate-400">(1:1)</span>
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

      {operation === 'LOCK' && sourceChain === 'evm' ? (
        <div className="mb-5 space-y-3">
          <button
            type="button"
            onClick={() => void evmLockOnChain()}
            disabled={
              lockBusy ||
              walletPending ||
              !poolLockAddress ||
              !evmAddress ||
              !hasPositiveUnderlyingForLock
            }
            className="w-full rounded-2xl border-2 border-emerald-700/20 bg-emerald-800 py-3.5 text-sm font-semibold text-white shadow-lg shadow-emerald-950/15 transition-[transform,box-shadow] hover:bg-emerald-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40 disabled:pointer-events-none disabled:opacity-40 motion-safe:active:scale-[0.99]"
          >
            {lockBusy ? 'Confirm in wallet…' : walletPending ? 'Waiting…' : `Lock ${asset} on-chain`}
          </button>
          {!poolLockAddress ? (
            <p className="text-center text-xs leading-snug text-amber-900/90">Set VITE_EVM_POOL_LOCK in .env and rebuild.</p>
          ) : !evmAddress ? (
            <div className="space-y-2">
              <p className="text-center text-xs leading-snug text-amber-900/90">
                Sign <span className="font-mono text-[10px]">approve</span> + <span className="font-mono text-[10px]">lock</span> with a connected
                wallet. Balances can show the demo address before you connect — use a button below.
              </p>
              <div className="flex flex-wrap justify-center gap-2">
                <button
                  type="button"
                  className={secondaryBtn}
                  disabled={evmConnectPending || !primaryEvmConnector}
                  onClick={() => primaryEvmConnector && connect({ connector: primaryEvmConnector })}
                >
                  {evmConnectPending ? 'Connecting…' : 'Connect wallet'}
                </button>
                {demoWalletsEnabled() && mockConnector ? (
                  <button
                    type="button"
                    className={cn(
                      secondaryBtn,
                      'border-indigo-200 bg-indigo-50 text-indigo-900 hover:border-indigo-300 hover:bg-indigo-100',
                    )}
                    disabled={evmConnectPending}
                    onClick={() => connect({ connector: mockConnector, chainId: hardhat.id })}
                  >
                    Use Anvil demo account
                  </button>
                ) : null}
              </div>
              {evmConnectError ? (
                <p className="text-center text-[11px] text-red-700">{evmConnectError.message}</p>
              ) : null}
            </div>
          ) : !hasPositiveUnderlyingForLock ? (
            <p className="text-center text-xs leading-snug text-amber-900/90">
              {underlyingEnvConfigured && sourceChain === 'evm' && (asset === 'USDC' ? liveUsdcBalRaw : liveUsdtBalRaw) === undefined
                ? `Loading ${asset} balance…`
                : `No ${asset} balance to lock — fund this account or switch asset.`}
            </p>
          ) : null}
          {lockNote ? <p className="text-center text-xs leading-snug text-emerald-950">{lockNote}</p> : null}
        </div>
      ) : null}

      {operation === 'BURN' && sourceChain === 'evm' ? (
        <div className="mb-5 space-y-3">
          <button
            type="button"
            onClick={() => void burnZkOnChain()}
            disabled={walletPending || !wrappedTokenAddress || !evmCanBurnZk}
            className="w-full rounded-2xl border-2 border-teal-700/20 bg-teal-800 py-3.5 text-sm font-semibold text-white shadow-lg shadow-teal-950/15 transition-[transform,box-shadow] hover:bg-teal-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40 disabled:pointer-events-none disabled:opacity-40 motion-safe:active:scale-[0.99]"
          >
            {walletPending ? 'Confirm in wallet…' : `Burn ${zkSymbol} from wallet`}
          </button>
          {burnZkDisabledReason ? (
            <p className="text-center text-xs leading-snug text-amber-900/90">{burnZkDisabledReason}</p>
          ) : null}
          {burnSideNote ? <p className="text-center text-xs leading-snug text-amber-950">{burnSideNote}</p> : null}
        </div>
      ) : null}

      {operation === 'BURN' && sourceChain === 'cardano' ? (
        <div className="mb-5 space-y-3 rounded-2xl border border-teal-200/80 bg-teal-50/40 px-4 py-4">
          <p className="text-[12px] font-semibold text-teal-950">Cardano redeem → EVM</p>
          {cardanoSignBlockedWhy ? (
            <p className="text-[11px] text-amber-950">{cardanoSignBlockedWhy}</p>
          ) : null}

          <div className="space-y-3 rounded-xl border border-violet-200/90 bg-violet-50/50 px-3 py-3">
            <div className="flex flex-wrap gap-2">
              <button type="button" className={secondaryBtn} onClick={() => generateRedeemCommitment()}>
                Generate commitment
              </button>
              <button type="button" className={secondaryBtn} disabled={!burnCommitmentFieldValid} onClick={() => void navigator.clipboard.writeText(burnCommitmentBare)}>
                Copy hex
              </button>
            </div>
            <textarea
              className={cn(
                inputCls,
                'min-h-[3rem] resize-y font-mono text-[11px] leading-snug',
                burnCommitmentFieldValid ? 'border-emerald-300/90 ring-1 ring-emerald-500/15' : '',
              )}
              value={burnCommitmentHex}
              onChange={(e) =>
                setBurnCommitmentHex(
                  e.target.value.replace(/^0x/i, '').replace(/[^0-9a-fA-F]/gu, '').slice(0, 64),
                )
              }
              placeholder="32-byte hex commitment"
              spellCheck={false}
              autoComplete="off"
              aria-label="Redeem burn commitment hex"
            />
            <button
              type="button"
              disabled={cardanoRedeemLockBusy || !cardanoCanSignBridgeOps || !cardanoZkUnitConfigured}
              title={signLockAtBridgeTitle}
              onClick={() => void cardanoLockZkForRedeem()}
              className="w-full rounded-xl border-2 border-violet-700/25 bg-violet-800 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-violet-900 disabled:opacity-40"
            >
              {cardanoRedeemLockBusy ? 'Signing…' : `Lock ${zkSymbol} at bridge`}
            </button>
            {cardanoRedeemLockNote ? (
              <p className="text-[11px] text-violet-950">{cardanoRedeemLockNote}</p>
            ) : null}
          </div>

          <div className="flex items-center justify-between gap-2 border-t border-teal-200/60 pt-3">
            <p className="text-[11px] font-semibold text-teal-900">Bridge locks</p>
            <button
              type="button"
              disabled={cardanoLockDiscoverLoading || !cardanoCanSignBridgeOps || !cardanoDiscoverUnitsConfigured}
              onClick={() => setCardanoLocksRefreshKey((k) => k + 1)}
              className="shrink-0 rounded-lg border border-teal-300/80 bg-white px-3 py-1.5 text-[11px] font-semibold text-teal-900 shadow-sm hover:bg-teal-50 disabled:opacity-40"
            >
              {cardanoLockDiscoverLoading ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
          {cardanoLockDiscoverErr ? (
            <p className="text-[11px] text-red-900">{cardanoLockDiscoverErr}</p>
          ) : null}
          {cardanoLockCandidates.length > 0 ? (
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
                      <span className="font-semibold text-teal-950">{c.amountFormatted} {zk}</span>
                      <span className="ml-2 font-mono text-[11px] text-slate-600">#{c.outputIndex} · {short}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : null}
          <button
            type="button"
            disabled={cardanoRedeemBusy || !cardanoCanSignBridgeOps || cardanoLockDiscoverLoading || !cardanoLockTxValid}
            onClick={() => void cardanoUserBridgeRelease()}
            className="w-full rounded-xl border-2 border-teal-700/25 bg-teal-800 py-3 text-sm font-semibold text-white shadow-md transition-colors hover:bg-teal-900 disabled:opacity-40"
          >
            {cardanoRedeemBusy ? 'Signing…' : 'Sign BridgeRelease'}
          </button>
          {cardanoRedeemNote ? <p className="text-center text-[11px] text-teal-950">{cardanoRedeemNote}</p> : null}
        </div>
      ) : null}

      {operation === 'BURN' && sourceChain === 'midnight' ? (
        <div className="mb-5 space-y-3 rounded-2xl border border-indigo-200/80 bg-indigo-50/40 px-4 py-4">
          <p className="text-[12px] font-semibold text-indigo-950">Midnight redeem → EVM</p>
          <div className="space-y-2 rounded-xl border border-indigo-200/70 bg-white/80 px-3 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-indigo-700">Select deposit to burn</p>
            {ledger && ledger.deposits.filter((d) => d.status === 1).length > 0 ? (
              <div className="space-y-1.5">
                {ledger.deposits.filter((d) => d.status === 1).map((d) => {
                  const selected = burnCommitmentHex === d.depositCommitmentHex;
                  return (
                    <button
                      key={d.depositCommitmentHex}
                      type="button"
                      onClick={() => setBurnCommitmentHex(d.depositCommitmentHex)}
                      className={cn(
                        'w-full rounded-xl border px-3 py-2.5 text-left text-[12px] transition-colors',
                        selected
                          ? 'border-indigo-600 bg-white shadow-sm ring-2 ring-indigo-500/25'
                          : 'border-indigo-200/70 bg-white/80 hover:border-indigo-400 hover:bg-white',
                      )}
                    >
                      <span className="font-semibold text-indigo-950">{d.assetKind === 0 ? 'zkUSDC' : 'zkUSDT'} · {d.amount.toString()}</span>
                      <span className="ml-2 font-mono text-[10px] text-slate-500">{d.depositCommitmentHex.slice(0, 10)}…{d.depositCommitmentHex.slice(-6)}</span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="text-[11px] text-amber-900">No active deposits — bridge a LOCK (EVM → Midnight) first.</p>
            )}
            {burnCommitmentFieldValid ? (
              <p className="break-all font-mono text-[10px] text-slate-500">{burnCommitmentHex}</p>
            ) : null}
            <button
              type="button"
              disabled={midnightBurnBusy || !midnightConnected || !burnCommitmentFieldValid}
              onClick={() => void midnightInitiateBurnFromBridge()}
              className="w-full rounded-xl border-2 border-indigo-700/25 bg-indigo-800 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-900 disabled:opacity-40"
            >
              {midnightBurnBusy ? 'Proving…' : `initiateBurn (${zkSymbol})`}
            </button>
          </div>
          {midnightFlowMessage ? (
            <p className="text-center text-[11px] font-medium text-indigo-900">{midnightFlowMessage}</p>
          ) : null}
          {midnightBurnNote ? <p className="text-center text-[11px] text-indigo-950">{midnightBurnNote}</p> : null}
          {!midnightConnected ? (
            <p className="text-[10px] text-amber-900">Connect Midnight wallet first.</p>
          ) : null}
          {lastMidnightBurnAnchor ? (
            <div className="space-y-1 rounded-xl border border-indigo-200/70 bg-white/90 px-3 py-2.5 text-[11px]">
              <div className="flex flex-wrap gap-x-2">
                <span className="font-semibold text-slate-600">Tx</span>
                <span className="break-all font-mono text-slate-900" title={lastMidnightBurnAnchor.txId}>
                  {lastMidnightBurnAnchor.txId.length > 36
                    ? `${lastMidnightBurnAnchor.txId.slice(0, 18)}…${lastMidnightBurnAnchor.txId.slice(-14)}`
                    : lastMidnightBurnAnchor.txId}
                </span>
              </div>
              {lastMidnightBurnAnchor.txHash ? (
                <div className="flex flex-wrap gap-x-2 text-[10px] text-slate-500">
                  <span className="font-semibold">Hash</span>
                  <span className="break-all font-mono">{lastMidnightBurnAnchor.txHash}</span>
                </div>
              ) : null}
            </div>
          ) : null}
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
        evmLockAnchorSummary={
          operation === 'LOCK' && evmLockAnchor
            ? `${evmLockAnchor.txHash.slice(0, 12)}… · log ${evmLockAnchor.logIndex} · block ${evmLockAnchor.blockNumber}`
            : undefined
        }
      />
    </div>
  );
};
