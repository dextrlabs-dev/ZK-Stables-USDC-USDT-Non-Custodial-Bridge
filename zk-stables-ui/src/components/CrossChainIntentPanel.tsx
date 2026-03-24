import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Collapse,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { useConnection, usePublicClient, useWriteContract } from 'wagmi';
import { formatUnits, isAddress, parseUnits, type Address, type Hex } from 'viem';
import { parseEnvEthereumAddress } from '../utils/envAddress.js';
import { useZkStables } from '../hooks/useZkStables.js';
import { useCrossChainWallets, type SourceChainKind } from '../contexts/CrossChainWalletContext.js';
import { AssetKind } from '../constants/zk-stables.js';
import {
  formatZkBurnWalletError,
  parseBurnedFromReceipt,
  randomBytes32Hex,
  zkStableBurnAbi,
} from '../lib/evmZkStableBurn.js';
import { proofAlgorithmSummary } from '../lib/bridgeJobTxLog.js';
import {
  defaultRelayerBaseUrl,
  type RelayerJobApi,
  type RelayerHealthChains,
} from '../lib/relayerClient.js';

type RelayerChainsCardano = NonNullable<RelayerHealthChains['cardano']> & {
  latestBlockHeight?: number;
  error?: string;
  blockfrostIgnored?: boolean;
};

const RELAYER_STUB_WARN_DISMISS_KEY = 'zk-stables-ui-dismiss-relayer-stub-warn';

function isEvmRecipientAddress(addr: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/u.test(addr.trim());
}

/** SRS §3.1 lock intent + POST to zk-stables-relayer (`/v1/intents/lock`). */
export const CrossChainIntentPanel: React.FC = () => {
  const publicClient = usePublicClient();
  const { writeContractAsync, isPending: evmBurnWalletPending } = useWriteContract();
  const { address: evmAddress, isConnected: evmConnected, status: evmStatus } = useConnection();
  const {
    walletAddress: midnightShieldedAddress,
    unshieldedAddress: midnightUnshieldedAddress,
    isConnected: midnightConnected,
    lastMidnightBurnAnchor,
  } = useZkStables();
  const { cardanoUsedAddressesHex, cardanoWalletKey } = useCrossChainWallets();

  const [operation, setOperation] = useState<'LOCK' | 'BURN'>('LOCK');
  const [sourceChain, setSourceChain] = useState<SourceChainKind>('evm');
  const [destChainLabel, setDestChainLabel] = useState('midnight');
  const [asset, setAsset] = useState<'USDC' | 'USDT'>('USDC');
  const [amount, setAmount] = useState('100');
  const [recipient, setRecipient] = useState('');
  /** BURN-only: must match on-chain `burn(..., burnCommitment)` on zkUSDC/zkUSDT (see `Burned` event). */
  const [burnCommitmentHex, setBurnCommitmentHex] = useState('');
  const [evmBurnWalletMsg, setEvmBurnWalletMsg] = useState<string | null>(null);
  /** Optional Cardano burn test anchor (stub `depositCommitment` when both are valid 32-byte tx id). */
  const [cardanoBurnTxHex, setCardanoBurnTxHex] = useState('00'.repeat(32));
  const [cardanoBurnOutputIndex, setCardanoBurnOutputIndex] = useState('0');
  const [cardanoBurnSpendTxHex, setCardanoBurnSpendTxHex] = useState('');
  const [midnightBurnTxId, setMidnightBurnTxId] = useState('');
  const [midnightBurnDestChain, setMidnightBurnDestChain] = useState('');
  const [lastIntent, setLastIntent] = useState<string | null>(null);
  const [relayerUrl] = useState(defaultRelayerBaseUrl);
  const [relayerJob, setRelayerJob] = useState<RelayerJobApi | null>(null);
  const [relayerError, setRelayerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [relayerChainsCardano, setRelayerChainsCardano] = useState<RelayerChainsCardano | null>(null);
  const [hideRelayerStubWarn, setHideRelayerStubWarn] = useState(
    () => typeof window !== 'undefined' && window.localStorage.getItem(RELAYER_STUB_WARN_DISMISS_KEY) === '1',
  );
  const [advancedJsonOpen, setAdvancedJsonOpen] = useState(false);
  const [relayerJustCompleted, setRelayerJustCompleted] = useState(false);
  /** EVM LOCK: required by relayer — from `ZkStablesPoolLock.lock` receipt (see main Bridge card for one-click lock). */
  const [evmLockTxHash, setEvmLockTxHash] = useState('');
  const [evmLockLogIndex, setEvmLockLogIndex] = useState('');
  const [evmLockBlockNumber, setEvmLockBlockNumber] = useState('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const relayerPhaseRef = useRef<string | null>(null);
  const relayerJobIdRef = useRef<string | null>(null);

  useEffect(() => {
    setBurnCommitmentHex('');
    setEvmBurnWalletMsg(null);
    setMidnightBurnTxId('');
    setMidnightBurnDestChain('');
    setEvmLockTxHash('');
    setEvmLockLogIndex('');
    setEvmLockBlockNumber('');
  }, [operation, asset, sourceChain]);

  useEffect(() => {
    if (operation === 'LOCK') setSourceChain('evm');
  }, [operation]);

  useEffect(() => {
    if (operation !== 'BURN' || sourceChain !== 'midnight') return;
    if (!lastMidnightBurnAnchor) {
      setBurnCommitmentHex('');
      setMidnightBurnTxId('');
      setMidnightBurnDestChain('');
      return;
    }
    setBurnCommitmentHex(lastMidnightBurnAnchor.recipientCommHex64);
    setMidnightBurnTxId(lastMidnightBurnAnchor.txId);
    setMidnightBurnDestChain(lastMidnightBurnAnchor.destChain);
  }, [operation, sourceChain, lastMidnightBurnAnchor]);

  const wrappedTokenAddress = useMemo((): Address | undefined => {
    const raw =
      asset === 'USDT'
        ? import.meta.env.VITE_DEMO_WUSDT_ADDRESS
        : import.meta.env.VITE_DEMO_WUSDC_ADDRESS;
    return parseEnvEthereumAddress(raw);
  }, [asset]);

  const evmCanBurnZk = Boolean(evmAddress) && (evmConnected || evmStatus === 'connecting' || evmStatus === 'reconnecting');

  const zkSymbol = asset === 'USDC' ? 'zkUSDC' : 'zkUSDT';

  const burnZkFromWallet = useCallback(async () => {
    setEvmBurnWalletMsg(null);
    if (!wrappedTokenAddress) {
      setEvmBurnWalletMsg('Set VITE_DEMO_WUSDC_ADDRESS / VITE_DEMO_WUSDT_ADDRESS for the selected asset.');
      return;
    }
    if (!evmAddress) {
      setEvmBurnWalletMsg('Connect an EVM wallet on the same network as the zk tokens.');
      return;
    }
    if (!publicClient) {
      setEvmBurnWalletMsg('RPC client not ready.');
      return;
    }
    const r = recipient.trim();
    if (!isAddress(r)) {
      setEvmBurnWalletMsg('Set a valid 0x recipient for underlying USDC/USDT unlock.');
      return;
    }
    let raw: bigint;
    try {
      raw = parseUnits(amount.trim() || '0', 6);
    } catch {
      setEvmBurnWalletMsg('Amount must be a decimal number (6 decimals).');
      return;
    }
    if (raw <= 0n) {
      setEvmBurnWalletMsg('Amount must be greater than zero.');
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
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      const parsed = parseBurnedFromReceipt(receipt, wrappedTokenAddress);
      if (parsed) {
        setBurnCommitmentHex(parsed.burnCommitmentHex);
        setRecipient(parsed.recipientOnSource);
        setAmount(formatUnits(BigInt(parsed.amount), 6));
        setEvmBurnWalletMsg(
          `${zkSymbol} burned on-chain; redeem commitment stored for the relayer. Use Send to relayer when ready.`,
        );
      } else {
        setEvmBurnWalletMsg('Tx mined but no Burned log for this token (wrong network or contract?).');
      }
    } catch (e) {
      setEvmBurnWalletMsg(formatZkBurnWalletError(e));
    }
  }, [amount, evmAddress, publicClient, recipient, wrappedTokenAddress, writeContractAsync, zkSymbol]);

  const dismissRelayerStubWarn = useCallback(() => {
    try {
      window.localStorage.setItem(RELAYER_STUB_WARN_DISMISS_KEY, '1');
    } catch {
      /* ignore quota */
    }
    setHideRelayerStubWarn(true);
  }, []);

  /** LOCK from EVM → funds route to Midnight; recipient must be a Midnight address. */
  const lockNeedsMidnightRecipient = operation === 'LOCK' && sourceChain === 'evm';
  /** LOCK from Midnight → recipient is on the *destination* chain (EVM or Cardano), not Midnight. */
  const lockNeedsNonMidnightRecipient = operation === 'LOCK' && sourceChain === 'midnight';
  /** BURN → unlocked underlying on EVM only for Cardano/Midnight source. */
  const burnNeedsEvmRecipientOnly = operation === 'BURN' && (sourceChain === 'cardano' || sourceChain === 'midnight');
  /** BURN → unlocked assets go to an address on the *source* chain (EVM or Cardano), not Midnight. */
  const burnNeedsSourceRecipient = operation === 'BURN';

  const hasMidnightRecipientOption = Boolean(midnightShieldedAddress || midnightUnshieldedAddress);

  const hintRecipient = useCallback(() => {
    if (operation === 'LOCK') {
      if (sourceChain === 'evm') {
        if (midnightShieldedAddress) setRecipient(midnightShieldedAddress);
        else if (midnightUnshieldedAddress) setRecipient(midnightUnshieldedAddress);
        return;
      }
      if (sourceChain === 'midnight') {
        if (evmConnected && evmAddress) setRecipient(evmAddress);
        else if (cardanoWalletKey && cardanoUsedAddressesHex[0]) setRecipient(cardanoUsedAddressesHex[0]);
        return;
      }
      return;
    }
    if (operation === 'BURN') {
      if (sourceChain === 'evm' && evmConnected && evmAddress) setRecipient(evmAddress);
      else if (sourceChain === 'cardano' || sourceChain === 'midnight') {
        if (evmConnected && evmAddress) setRecipient(evmAddress);
      }
    }
  }, [
    operation,
    sourceChain,
    evmConnected,
    evmAddress,
    cardanoWalletKey,
    cardanoUsedAddressesHex,
    midnightShieldedAddress,
    midnightUnshieldedAddress,
  ]);

  const canPrefill = useMemo(() => {
    if (operation === 'LOCK' && sourceChain === 'evm') return hasMidnightRecipientOption;
    if (operation === 'LOCK' && sourceChain === 'midnight') {
      return (evmConnected && !!evmAddress) || (!!cardanoWalletKey && cardanoUsedAddressesHex.length > 0);
    }
    if (operation === 'BURN' && sourceChain === 'evm') return evmConnected && !!evmAddress;
    if (operation === 'BURN' && (sourceChain === 'cardano' || sourceChain === 'midnight')) {
      return evmConnected && !!evmAddress;
    }
    return false;
  }, [
    operation,
    sourceChain,
    evmConnected,
    evmAddress,
    cardanoWalletKey,
    cardanoUsedAddressesHex,
    hasMidnightRecipientOption,
  ]);

  const buildPayload = useCallback(() => {
    const r = recipient.trim();
    if (!r) return null;
    if (burnNeedsEvmRecipientOnly && !isEvmRecipientAddress(r)) return null;
    const bcRaw = burnCommitmentHex.replace(/^0x/i, '').trim();
    if (operation === 'BURN') {
      if (bcRaw.length !== 64 || !/^[0-9a-fA-F]+$/.test(bcRaw)) {
        return null;
      }
    }
    const bc = bcRaw.toLowerCase();
    const destChainResolved = destChainLabel.trim() || undefined;
    const base: Record<string, unknown> = {
      operation,
      sourceChain,
      destinationChain: destChainResolved,
      asset,
      assetKind: asset === 'USDC' ? AssetKind.USDC : AssetKind.USDT,
      amount,
      recipient: r,
      connected: {
        evm: evmConnected ? evmAddress : undefined,
        cardano: cardanoWalletKey ? cardanoUsedAddressesHex[0] : undefined,
        midnight: midnightConnected ? midnightShieldedAddress ?? undefined : undefined,
        midnightUnshielded: midnightConnected ? midnightUnshieldedAddress ?? undefined : undefined,
      },
      note:
        operation === 'LOCK'
          ? 'LOCK intent: EVM lock of USDC/USDT toward zk mint on destination (HTTP API requires sourceChain evm).'
          : `Redeem intent: burn ${zkSymbol} on source chain; burnCommitment must match; underlying ${asset} pays out on EVM for Cardano/Midnight source.`,
    };
    if (operation === 'BURN') {
      base.burnCommitmentHex = bc;
      if (sourceChain === 'cardano') {
        const txH = cardanoBurnTxHex.replace(/^0x/i, '').trim().toLowerCase();
        const oi = Math.max(0, Number.parseInt(cardanoBurnOutputIndex, 10) || 0);
        const spend = cardanoBurnSpendTxHex.replace(/^0x/i, '').trim().toLowerCase();
        if (txH.length === 64 && /^[0-9a-f]+$/.test(txH)) {
          const cardanoSrc: Record<string, unknown> = { txHash: txH, outputIndex: oi };
          if (spend.length === 64 && /^[0-9a-f]+$/.test(spend)) cardanoSrc.spendTxHash = spend;
          base.source = { cardano: cardanoSrc };
        }
      }
      if (sourceChain === 'midnight') {
        const txId = midnightBurnTxId.trim() || lastMidnightBurnAnchor?.txId;
        if (txId) {
          const dc = Number.parseInt(
            (midnightBurnDestChain.trim() || lastMidnightBurnAnchor?.destChain || '0').trim(),
            10,
          );
          base.source = {
            midnight: {
              txId,
              txHash: lastMidnightBurnAnchor?.txHash,
              contractAddress: lastMidnightBurnAnchor?.contractAddress ?? undefined,
              destChainId: Number.isFinite(dc) ? dc : undefined,
            },
          };
        }
      }
    }
    if (operation === 'LOCK' && sourceChain === 'evm') {
      const tx = evmLockTxHash.trim();
      const liStr = evmLockLogIndex.trim();
      const bn = evmLockBlockNumber.trim();
      if (!/^0x[0-9a-fA-F]{64}$/u.test(tx) || liStr === '' || bn === '') {
        return null;
      }
      const li = Number.parseInt(liStr, 10);
      if (!Number.isInteger(li) || li < 0) return null;
      base.source = {
        evm: {
          txHash: tx,
          logIndex: li,
          blockNumber: bn,
        },
      };
    }
    return base;
  }, [
    operation,
    recipient,
    sourceChain,
    destChainLabel,
    asset,
    amount,
    burnCommitmentHex,
    cardanoBurnTxHex,
    cardanoBurnOutputIndex,
    cardanoBurnSpendTxHex,
    midnightBurnTxId,
    midnightBurnDestChain,
    lastMidnightBurnAnchor,
    evmConnected,
    evmAddress,
    cardanoWalletKey,
    cardanoUsedAddressesHex,
    midnightConnected,
    midnightShieldedAddress,
    midnightUnshieldedAddress,
    zkSymbol,
    evmLockTxHash,
    evmLockLogIndex,
    evmLockBlockNumber,
  ]);

  const recordLockIntent = useCallback(() => {
    const payload = buildPayload();
    if (!payload) {
      setLastIntent(null);
      return;
    }
    setLastIntent(JSON.stringify(payload, null, 2));
    // eslint-disable-next-line no-console
    console.info('[ZK-Stables] lock intent', payload);
  }, [buildPayload]);

  const stopPoll = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => () => stopPoll(), [stopPoll]);

  useEffect(() => {
    if (!relayerJob) {
      relayerPhaseRef.current = null;
      relayerJobIdRef.current = null;
      return;
    }
    if (relayerJobIdRef.current !== relayerJob.id) {
      relayerJobIdRef.current = relayerJob.id;
      relayerPhaseRef.current = relayerJob.phase;
      return;
    }
    const prev = relayerPhaseRef.current;
    relayerPhaseRef.current = relayerJob.phase;
    if (relayerJob.phase === 'completed' && prev !== null && prev !== 'completed') {
      setRelayerJustCompleted(true);
      const t = window.setTimeout(() => setRelayerJustCompleted(false), 1400);
      return () => window.clearTimeout(t);
    }
    return undefined;
  }, [relayerJob]);

  useEffect(() => {
    let cancelled = false;
    const base = relayerUrl.replace(/\/$/, '');
    void (async () => {
      try {
        const res = await fetch(`${base}/v1/health/chains`);
        const data = (await res.json()) as { cardano?: RelayerChainsCardano };
        if (!cancelled) setRelayerChainsCardano(data.cardano ?? null);
      } catch {
        if (!cancelled) setRelayerChainsCardano(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [relayerUrl]);

  const submitToRelayer = useCallback(async () => {
    const payload = buildPayload();
    if (!payload) {
      setRelayerError(
        operation === 'BURN'
          ? sourceChain === 'evm'
            ? `Burn ${zkSymbol} from your wallet first, then send the redeem intent.`
            : sourceChain === 'cardano' || sourceChain === 'midnight'
              ? 'Redeem from Cardano/Midnight requires an EVM 0x… recipient (40 hex chars) and valid burn fields.'
              : 'Add a recipient before submitting.'
          : sourceChain === 'evm'
            ? 'LOCK from EVM needs recipient plus lock tx hash (0x + 64 hex), log index, and block number from your on-chain pool.lock — or use the Bridge card “Lock … on-chain” flow.'
            : 'Add a recipient address before submitting.',
      );
      return;
    }
    setRelayerError(null);
    setSubmitting(true);
    setRelayerJob(null);
    stopPoll();
    try {
      const endpoint = operation === 'BURN' ? 'burn' : 'lock';
      const res = await fetch(`${relayerUrl.replace(/\/$/, '')}/v1/intents/${endpoint}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as { jobId?: string; job?: RelayerJobApi; error?: string };
      if (!res.ok) throw new Error(data.error ?? res.statusText);
      const job = data.job;
      if (!job?.id) {
        throw new Error(
          'The relayer did not return a job id. Start zk-stables-relayer (npm start in zk-stables-relayer) and check VITE_RELAYER_URL.',
        );
      }
      setRelayerJob(job);
      pollRef.current = setInterval(async () => {
        try {
          const st = await fetch(`${relayerUrl.replace(/\/$/, '')}/v1/jobs/${job.id}`);
          const j = (await st.json()) as RelayerJobApi;
          if (st.ok) {
            setRelayerJob(j);
            if (j.phase === 'completed' || j.phase === 'failed') stopPoll();
          }
        } catch {
          /* ignore transient */
        }
      }, 400);
    } catch (e) {
      setRelayerError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }, [buildPayload, relayerUrl, stopPoll, operation, zkSymbol, sourceChain]);

  const cardanoStatusTooltip =
    relayerChainsCardano &&
    (relayerChainsCardano.skipped
      ? relayerChainsCardano.note ??
        'The relayer has no Cardano indexer. Set RELAYER_YACI_URL or RELAYER_BLOCKFROST_PROJECT_ID on the relayer if you need Cardano health.'
      : [
          `Indexer: ${relayerChainsCardano.provider ?? '—'}`,
          `Latest block: ${relayerChainsCardano.latestBlockHeight ?? (relayerChainsCardano.ok === false ? 'unavailable' : '—')}`,
          relayerChainsCardano.error ? `Problem: ${relayerChainsCardano.error}` : null,
          relayerChainsCardano.blockfrostIgnored ? 'Using Yaci only; Blockfrost is not used for Cardano on this relayer.' : null,
        ]
          .filter(Boolean)
          .join('\n'));

  return (
    <Card
      id="panel-cross-chain-intent"
      variant="outlined"
      sx={{
        borderColor: 'primary.dark',
        borderWidth: 1,
        borderStyle: 'solid',
      }}
    >
      <CardContent>
        <Typography variant="h6" component="h2" gutterBottom>
          Cross-chain intents
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Send a <strong>lock</strong> (mint path: you must <strong>already</strong> have called on-chain <code>approve</code> + <code>ZkStablesPoolLock.lock</code> so USDC/USDT
          moved into the pool; the relayer then proves that <code>Locked</code> log) or <strong>redeem</strong> (burn zk on source chain; underlying pays on EVM for Cardano/Midnight
          burns). HTTP LOCK requires <code>sourceChain: evm</code> and <code>source.evm</code> (tx hash, log index, block number). Use the main Bridge card for a guided lock +
          submit flow.
        </Typography>
        <Stack direction="row" flexWrap="wrap" alignItems="center" gap={1} sx={{ mb: 1 }}>
          <Typography variant="caption" color="text.secondary">
            Relayer URL
          </Typography>
          <Typography variant="caption" component="span" color="text.secondary">
            <code>{relayerUrl}</code>
          </Typography>
          {relayerChainsCardano && cardanoStatusTooltip && (
            <Tooltip title={cardanoStatusTooltip} slotProps={{ tooltip: { sx: { whiteSpace: 'pre-line', maxWidth: 380 } } }}>
              <Chip
                size="small"
                variant="outlined"
                color={relayerChainsCardano.skipped ? 'default' : relayerChainsCardano.ok === false ? 'warning' : 'success'}
                label={
                  relayerChainsCardano.skipped
                    ? 'Cardano indexer: off'
                    : `Cardano: ${relayerChainsCardano.provider ?? 'connected'} · block ${relayerChainsCardano.latestBlockHeight ?? '—'}`
                }
                sx={{ maxWidth: '100%' }}
              />
            </Tooltip>
          )}
        </Stack>
        {!hideRelayerStubWarn && (
          <Alert severity="info" sx={{ mb: 2 }} onClose={dismissRelayerStubWarn}>
            Production relayer enforces real proofs (<code>RELAYER_STRICT_PROOFS=true</code>). Jobs are kept in memory — data is lost when the process stops. Start it with{' '}
            <code>cd zk-stables-relayer &amp;&amp; npm start</code>, or point the UI at your relayer with <code>VITE_RELAYER_URL</code>.
          </Alert>
        )}
        {relayerError && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setRelayerError(null)}>
            {relayerError}
          </Alert>
        )}
        <Stack spacing={2}>
          <TextField
            select
            label="Operation"
            size="small"
            fullWidth
            value={operation}
            onChange={(e) => setOperation(e.target.value as 'LOCK' | 'BURN')}
            helperText={
              operation === 'LOCK'
                ? 'Requires a real on-chain pool.lock first; fill lock tx + log index below (or use the Bridge card).'
                : `Redeem: burn ${zkSymbol} on the source chain; underlying ${asset} is paid on EVM after proof (Cardano/Midnight source).`
            }
          >
            <MenuItem value="LOCK">LOCK</MenuItem>
            <MenuItem value="BURN">REDEEM (burn zk → USDC/USDT)</MenuItem>
          </TextField>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              select
              label="Source chain"
              size="small"
              fullWidth
              value={sourceChain}
              onChange={(e) => setSourceChain(e.target.value as SourceChainKind)}
            >
              <MenuItem value="evm">EVM (Ethereum L1 / L2)</MenuItem>
              <MenuItem value="cardano" disabled={operation === 'LOCK'}>
                Cardano {operation === 'LOCK' ? '(LOCK via HTTP is EVM-only)' : ''}
              </MenuItem>
              <MenuItem value="midnight" disabled={operation === 'LOCK'}>
                Midnight {operation === 'LOCK' ? '(LOCK via HTTP is EVM-only)' : ''}
              </MenuItem>
            </TextField>
            <TextField
              label="Destination chain label"
              size="small"
              fullWidth
              value={destChainLabel}
              onChange={(e) => setDestChainLabel(e.target.value)}
              helperText="Name or id the relayer uses for routing (e.g. midnight). Must match how the relayer is configured."
            />
          </Stack>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField select label="Asset" size="small" value={asset} onChange={(e) => setAsset(e.target.value as 'USDC' | 'USDT')}>
              <MenuItem value="USDC">USDC</MenuItem>
              <MenuItem value="USDT">USDT</MenuItem>
            </TextField>
            <TextField
              label="Amount"
              size="small"
              fullWidth
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              helperText={
                operation === 'BURN'
                  ? `Face value: you burn ${zkSymbol} and unlock the same amount in ${asset}.`
                  : 'Decimal string as your integration expects.'
              }
            />
          </Stack>
          {operation === 'LOCK' && sourceChain === 'evm' && (
            <Stack spacing={1.5}>
              <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.5 }}>
                From your <code>ZkStablesPoolLock.lock</code> receipt: transaction hash, <code>Locked</code> log index, and block number (USDC/USDT must already be in the pool).
              </Typography>
              <TextField
                label="Lock transaction hash"
                size="small"
                fullWidth
                value={evmLockTxHash}
                onChange={(e) => setEvmLockTxHash(e.target.value.trim())}
                placeholder="0x + 64 hex chars"
              />
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField
                  label="Locked log index"
                  size="small"
                  fullWidth
                  value={evmLockLogIndex}
                  onChange={(e) => setEvmLockLogIndex(e.target.value.trim())}
                  placeholder="e.g. 0"
                />
                <TextField
                  label="Block number"
                  size="small"
                  fullWidth
                  value={evmLockBlockNumber}
                  onChange={(e) => setEvmLockBlockNumber(e.target.value.trim())}
                />
              </Stack>
            </Stack>
          )}
          {operation === 'BURN' && (
            <>
              {sourceChain === 'evm' && (
                <Stack spacing={1.5}>
                  <Box
                    component="details"
                    sx={{
                      borderRadius: 2,
                      border: '1px solid',
                      borderColor: 'warning.light',
                      bgcolor: 'warning.50',
                      px: 2,
                      py: 1.25,
                    }}
                  >
                    <Box
                      component="summary"
                      sx={{
                        cursor: 'pointer',
                        fontWeight: 600,
                        fontSize: 13,
                        color: 'warning.dark',
                        listStylePosition: 'outside',
                      }}
                    >
                      How EVM redeem works
                    </Box>
                    <Typography variant="caption" component="div" color="text.secondary" sx={{ mt: 1.5, display: 'block', lineHeight: 1.55 }}>
                      On EVM, redeem = call <code>burn</code> on {zkSymbol}. That destroys your zk balance and emits <strong>Burned</strong>. The relayer
                      matches your intent to that event, then releases {asset} (underlying) to your recipient. The redeem intent includes the same 32-byte{' '}
                      <code>burnCommitment</code> as the contract — it is created when you use the wallet burn button and read back from the receipt (nothing
                      to paste).
                    </Typography>
                    <Typography variant="caption" component="div" color="text.secondary" sx={{ mt: 1.25, display: 'block', lineHeight: 1.5 }}>
                      <strong>Midnight note:</strong> Relayer messages like <code>proveHolder</code> or insufficient dust refer to the relayer&apos;s Midnight
                      wallet on LOCK → Midnight, not this flow. Use <code>local-cli fund-and-register-dust</code> for that wallet if needed.
                    </Typography>
                  </Box>
                  <Button
                    variant="contained"
                    color="secondary"
                    size="medium"
                    disabled={evmBurnWalletPending || !wrappedTokenAddress || !evmCanBurnZk}
                    onClick={() => void burnZkFromWallet()}
                    sx={{ alignSelf: 'flex-start' }}
                  >
                    {evmBurnWalletPending ? 'Confirm in wallet…' : `Burn ${zkSymbol} from wallet`}
                  </Button>
                  {!evmBurnWalletPending && (!wrappedTokenAddress || !evmCanBurnZk) ? (
                    <Typography variant="caption" color="warning.dark" sx={{ display: 'block', maxWidth: 420 }}>
                      {!wrappedTokenAddress
                        ? 'Set VITE_DEMO_WUSDC_ADDRESS / VITE_DEMO_WUSDT_ADDRESS in .env and restart Vite.'
                        : 'Connect an EVM wallet to burn zk tokens.'}
                    </Typography>
                  ) : null}
                  {evmBurnWalletMsg ? (
                    <Typography variant="caption" color={/burned on-chain/i.test(evmBurnWalletMsg) ? 'success' : 'error'}>
                      {evmBurnWalletMsg}
                    </Typography>
                  ) : null}
                </Stack>
              )}
              {sourceChain === 'cardano' && (
                <Alert severity="info" variant="outlined" sx={{ py: 0.75 }}>
                  <Typography variant="caption">
                    Cardano redeem: use the main bridge card for user <strong>BridgeRelease</strong>, or paste lock ref + <strong>spend tx</strong> (64 hex
                    each) after you spend the lock UTxO. Relayer matches <code>burnCommitmentHex</code> to lock datum <code>recipient_commitment</code> (see{' '}
                    <code>docs/BURN_ANCHOR_SPEC.md</code>). Underlying <strong>{asset}</strong> is sent to your <strong>EVM 0x…</strong> recipient after the relayer
                    runs.
                  </Typography>
                </Alert>
              )}
              {sourceChain === 'midnight' && (
                <Alert severity="info" variant="outlined" sx={{ py: 0.75 }}>
                  <Typography variant="caption" component="div">
                    Midnight redeem: run <strong>initiateBurn</strong> in Developer tools. <code>txId</code>, dest chain, and <code>burnCommitmentHex</code> sync from
                    the last successful call in this session — no manual entry. Underlying <strong>{asset}</strong> pays out on <strong>EVM</strong> to your 0x…
                    recipient.
                  </Typography>
                  {lastMidnightBurnAnchor ? (
                    <Typography variant="caption" component="div" sx={{ mt: 1, fontFamily: 'ui-monospace, monospace', wordBreak: 'break-all' }}>
                      <strong>Tx id:</strong> {lastMidnightBurnAnchor.txId}
                      <br />
                      <strong>Dest chain:</strong> {lastMidnightBurnAnchor.destChain}
                      <br />
                      <strong>Commitment:</strong> {lastMidnightBurnAnchor.recipientCommHex64}
                    </Typography>
                  ) : (
                    <Typography variant="caption" color="warning.main" sx={{ mt: 1, display: 'block' }}>
                      No anchor yet — run initiateBurn first, then build/send the intent.
                    </Typography>
                  )}
                </Alert>
              )}
              {sourceChain === 'cardano' && (
                <Stack spacing={2}>
                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                    <TextField
                      label="Lock UTxO transaction id (64 hex)"
                      size="small"
                      fullWidth
                      value={cardanoBurnTxHex}
                      onChange={(e) => setCardanoBurnTxHex(e.target.value.replace(/\s/g, ''))}
                    />
                    <TextField
                      label="Output index"
                      size="small"
                      type="number"
                      sx={{ minWidth: 120 }}
                      value={cardanoBurnOutputIndex}
                      onChange={(e) => setCardanoBurnOutputIndex(e.target.value)}
                    />
                  </Stack>
                  <TextField
                    label="BridgeRelease spend transaction id (64 hex)"
                    size="small"
                    fullWidth
                    value={cardanoBurnSpendTxHex}
                    onChange={(e) => setCardanoBurnSpendTxHex(e.target.value.replace(/\s/g, ''))}
                    helperText="Required for POST /v1/intents/burn from this panel (proves the lock was consumed)."
                  />
                </Stack>
              )}
            </>
          )}
          <TextField
            label={
              operation === 'LOCK'
                ? 'Recipient on destination chain'
                : burnNeedsEvmRecipientOnly
                  ? `Recipient on EVM (${asset} payout)`
                  : 'Recipient on source chain (funds return here)'
            }
            size="small"
            fullWidth
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            helperText={
              lockNeedsMidnightRecipient
                ? 'Use a Midnight address only (shielded mn_* or unshielded mn_addr_*). Do not use an EVM 0x or Cardano address here.'
                : burnNeedsEvmRecipientOnly
                  ? `Redeem pays underlying ${asset} on EVM only. Use a 40-character hex EVM address (0x…).`
                  : burnNeedsSourceRecipient
                    ? 'Use an address on the same chain you selected as source — EVM 0x, or Cardano payment credential hex from your wallet. Not a Midnight address.'
                    : lockNeedsNonMidnightRecipient
                      ? 'Destination is EVM or Cardano — paste or fill an address for that chain, not Midnight.'
                      : 'Paste the address format your chosen chain expects.'
            }
          />
          {lockNeedsMidnightRecipient && (
            <Stack direction="row" flexWrap="wrap" gap={1} alignItems="center">
              <Typography variant="caption" color="text.secondary">
                Fill Midnight address from wallet
              </Typography>
              <Button
                size="small"
                variant="outlined"
                disabled={!midnightShieldedAddress}
                onClick={() => midnightShieldedAddress && setRecipient(midnightShieldedAddress)}
              >
                Shielded (Zswap)
              </Button>
              <Button
                size="small"
                variant="outlined"
                disabled={!midnightUnshieldedAddress}
                onClick={() => midnightUnshieldedAddress && setRecipient(midnightUnshieldedAddress)}
              >
                Unshielded (tNight)
              </Button>
            </Stack>
          )}
          {burnNeedsEvmRecipientOnly && (
            <Stack direction="row" flexWrap="wrap" gap={1} alignItems="center">
              <Typography variant="caption" color="text.secondary">
                EVM recipient only
              </Typography>
              <Button
                size="small"
                variant="outlined"
                disabled={!evmConnected || !evmAddress}
                onClick={() => evmAddress && setRecipient(evmAddress)}
              >
                EVM (connected)
              </Button>
            </Stack>
          )}
          {(burnNeedsSourceRecipient || lockNeedsNonMidnightRecipient) && !burnNeedsEvmRecipientOnly && (
              <Stack direction="row" flexWrap="wrap" gap={1} alignItems="center">
                <Typography variant="caption" color="text.secondary">
                  Fill EVM or Cardano address from wallet
                </Typography>
                <Button
                  size="small"
                  variant="outlined"
                  disabled={!evmConnected || !evmAddress}
                  onClick={() => evmAddress && setRecipient(evmAddress)}
                >
                  EVM (connected)
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  disabled={!cardanoWalletKey || !cardanoUsedAddressesHex[0]}
                  onClick={() => cardanoUsedAddressesHex[0] && setRecipient(cardanoUsedAddressesHex[0])}
                >
                  Cardano (first used address)
                </Button>
              </Stack>
            )}
          <Stack direction="row" flexWrap="wrap" gap={1} alignItems="center">
            <Button variant="contained" color="primary" disabled={submitting} onClick={() => void submitToRelayer()}>
              {submitting ? 'Sending…' : 'Send to relayer'}
            </Button>
            <Button variant="outlined" disabled={!canPrefill} onClick={hintRecipient}>
              Fill recipient from wallets
            </Button>
            <Button
              variant="text"
              size="small"
              color="inherit"
              onClick={() => setAdvancedJsonOpen((o) => !o)}
              endIcon={
                <ExpandMoreIcon
                  sx={{
                    transform: advancedJsonOpen ? 'rotate(180deg)' : 'none',
                    transition: 'transform 0.2s ease',
                  }}
                />
              }
            >
              Advanced — inspect JSON
            </Button>
          </Stack>
          <Collapse in={advancedJsonOpen}>
            <Stack spacing={1} sx={{ pt: 1, pl: 0.5 }}>
              <Typography variant="caption" color="text.secondary">
                Build the same payload as <strong>Send to relayer</strong>, log it in the browser console, and show it below for
                copy/paste or debugging.
              </Typography>
              <Button variant="outlined" size="small" onClick={recordLockIntent} sx={{ alignSelf: 'flex-start' }}>
                Build JSON preview
              </Button>
              {lastIntent && (
                <Box>
                  <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                    Payload preview (JSON)
                  </Typography>
                  <Box
                    component="pre"
                    sx={(t) => ({
                      ...t.typography.dataMonoDense,
                      p: 1,
                      bgcolor: 'action.hover',
                      borderRadius: 1,
                      overflow: 'auto',
                      maxHeight: 280,
                      m: 0,
                    })}
                  >
                    {lastIntent}
                  </Box>
                </Box>
              )}
            </Stack>
          </Collapse>
          {relayerJob && (
            <Box
              sx={{
                position: 'relative',
                pl: relayerJob.phase === 'completed' ? 1.5 : 0,
                borderLeft:
                  relayerJob.phase === 'completed' ? 3 : 0,
                borderColor: relayerJob.phase === 'completed' ? 'success.main' : 'transparent',
                borderRadius: relayerJob.phase === 'completed' ? 1 : 0,
                transition: 'border-color 0.35s ease, padding-left 0.35s ease',
                ...(relayerJustCompleted && {
                  '@keyframes relayerSuccessGlow': {
                    '0%': { boxShadow: '0 0 0 0 rgba(63, 185, 80, 0.5)' },
                    '100%': { boxShadow: '0 0 0 14px rgba(63, 185, 80, 0)' },
                  },
                  '@media (prefers-reduced-motion: no-preference)': {
                    animation: 'relayerSuccessGlow 0.9s ease-out 1',
                  },
                }),
              }}
            >
              {relayerJob.phase === 'completed' && (
                <Stack direction="row" alignItems="center" gap={0.75} sx={{ mb: 1, color: 'success.light' }}>
                  <CheckCircleIcon sx={{ fontSize: 20 }} aria-hidden />
                  <Typography variant="body2" fontWeight={600} component="p" sx={{ m: 0 }}>
                    Relayer finished this job — proof details below.
                  </Typography>
                </Stack>
              )}
              <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                Relayer job <code>{relayerJob.id}</code> — status: <strong>{relayerJob.phase}</strong>
              </Typography>
              <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5 }}>
                Reference id: <code>{relayerJob.lockRef}</code>
              </Typography>
              {relayerJob.proofBundle && (
                <Typography variant="dataMonoDense" component="div" sx={{ wordBreak: 'break-all' }}>
                  proof: {proofAlgorithmSummary(relayerJob.proofBundle.algorithm)} · {relayerJob.proofBundle.digest}
                </Typography>
              )}
              {relayerJob.depositCommitmentHex && (
                <Typography variant="dataMonoDense" component="div" sx={{ wordBreak: 'break-all', mt: 0.5 }}>
                  depositCommitment: {relayerJob.depositCommitmentHex}
                </Typography>
              )}
              {relayerJob.destinationHint && (
                <Typography variant="body2" sx={{ mt: 1 }}>
                  {relayerJob.destinationHint}
                </Typography>
              )}
              {relayerJob.error && (
                <Alert severity="error" sx={{ mt: 1 }}>
                  {relayerJob.error}
                </Alert>
              )}
            </Box>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
};
