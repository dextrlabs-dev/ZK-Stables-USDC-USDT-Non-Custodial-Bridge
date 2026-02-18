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
import { useConnection } from 'wagmi';
import { useZkStables } from '../hooks/useZkStables.js';
import { useCrossChainWallets, type SourceChainKind } from '../contexts/CrossChainWalletContext.js';
import { AssetKind } from '../constants/zk-stables.js';

const defaultRelayerUrl = () =>
  (import.meta.env.VITE_RELAYER_URL && String(import.meta.env.VITE_RELAYER_URL).trim()) || 'http://127.0.0.1:8787';

type RelayerChainsCardano = {
  provider?: string;
  skipped?: boolean;
  note?: string;
  latestBlockHeight?: number;
  ok?: boolean;
  error?: string;
  blockfrostIgnored?: boolean;
};

type RelayerJob = {
  id: string;
  phase: string;
  lockRef: string;
  proofBundle?: { algorithm: string; digest: string; publicInputsHex: string };
  destinationHint?: string;
  depositCommitmentHex?: string;
  error?: string;
  intent: unknown;
};

const RELAYER_STUB_WARN_DISMISS_KEY = 'zk-stables-ui-dismiss-relayer-stub-warn';

function randomBytes32Hex(): string {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

/** SRS §3.1 lock intent + POST to zk-stables-relayer (`/v1/intents/lock`). */
export const CrossChainIntentPanel: React.FC = () => {
  const { address: evmAddress, isConnected: evmConnected } = useConnection();
  const {
    walletAddress: midnightShieldedAddress,
    unshieldedAddress: midnightUnshieldedAddress,
    isConnected: midnightConnected,
  } = useZkStables();
  const { cardanoUsedAddressesHex, cardanoWalletKey } = useCrossChainWallets();

  const [operation, setOperation] = useState<'LOCK' | 'BURN'>('LOCK');
  const [sourceChain, setSourceChain] = useState<SourceChainKind>('evm');
  const [destChainLabel, setDestChainLabel] = useState('midnight');
  const [asset, setAsset] = useState<'USDC' | 'USDT'>('USDC');
  const [amount, setAmount] = useState('100');
  const [recipient, setRecipient] = useState('');
  /** BURN-only: 32-byte binding for Midnight `depositCommitment` preimage (relayer validates 64 hex chars). */
  const [burnCommitmentHex, setBurnCommitmentHex] = useState(randomBytes32Hex);
  /** Optional Cardano burn test anchor (stub `depositCommitment` when both are valid 32-byte tx id). */
  const [cardanoBurnTxHex, setCardanoBurnTxHex] = useState('00'.repeat(32));
  const [cardanoBurnOutputIndex, setCardanoBurnOutputIndex] = useState('0');
  const [lastIntent, setLastIntent] = useState<string | null>(null);
  const [relayerUrl] = useState(defaultRelayerUrl);
  const [relayerJob, setRelayerJob] = useState<RelayerJob | null>(null);
  const [relayerError, setRelayerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [relayerChainsCardano, setRelayerChainsCardano] = useState<RelayerChainsCardano | null>(null);
  const [hideRelayerStubWarn, setHideRelayerStubWarn] = useState(
    () => typeof window !== 'undefined' && window.localStorage.getItem(RELAYER_STUB_WARN_DISMISS_KEY) === '1',
  );
  const [advancedJsonOpen, setAdvancedJsonOpen] = useState(false);
  const [relayerJustCompleted, setRelayerJustCompleted] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const relayerPhaseRef = useRef<string | null>(null);
  const relayerJobIdRef = useRef<string | null>(null);

  const dismissRelayerStubWarn = useCallback(() => {
    try {
      window.localStorage.setItem(RELAYER_STUB_WARN_DISMISS_KEY, '1');
    } catch {
      /* ignore quota */
    }
    setHideRelayerStubWarn(true);
  }, []);

  /** LOCK from EVM/Cardano → funds route to Midnight; recipient must be a Midnight address (never 0x / Cardano hex). */
  const lockNeedsMidnightRecipient = operation === 'LOCK' && (sourceChain === 'evm' || sourceChain === 'cardano');
  /** LOCK from Midnight → recipient is on the *destination* chain (EVM or Cardano), not Midnight. */
  const lockNeedsNonMidnightRecipient = operation === 'LOCK' && sourceChain === 'midnight';
  /** BURN → unlocked assets go to an address on the *source* chain (EVM or Cardano), not Midnight. */
  const burnNeedsSourceRecipient = operation === 'BURN';

  const hasMidnightRecipientOption = Boolean(midnightShieldedAddress || midnightUnshieldedAddress);

  const hintRecipient = useCallback(() => {
    if (operation === 'LOCK') {
      if (sourceChain === 'evm' || sourceChain === 'cardano') {
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
      else if (sourceChain === 'cardano' && cardanoWalletKey && cardanoUsedAddressesHex[0]) {
        setRecipient(cardanoUsedAddressesHex[0]);
      } else if (sourceChain === 'midnight') {
        if (evmConnected && evmAddress) setRecipient(evmAddress);
        else if (cardanoWalletKey && cardanoUsedAddressesHex[0]) setRecipient(cardanoUsedAddressesHex[0]);
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
    if (operation === 'LOCK' && (sourceChain === 'evm' || sourceChain === 'cardano')) return hasMidnightRecipientOption;
    if (operation === 'LOCK' && sourceChain === 'midnight') {
      return (evmConnected && !!evmAddress) || (!!cardanoWalletKey && cardanoUsedAddressesHex.length > 0);
    }
    if (operation === 'BURN' && sourceChain === 'evm') return evmConnected && !!evmAddress;
    if (operation === 'BURN' && sourceChain === 'cardano') return !!cardanoWalletKey && cardanoUsedAddressesHex.length > 0;
    if (operation === 'BURN' && sourceChain === 'midnight') {
      return (evmConnected && !!evmAddress) || (!!cardanoWalletKey && cardanoUsedAddressesHex.length > 0);
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
    const bc = burnCommitmentHex.replace(/^0x/i, '').trim();
    if (operation === 'BURN') {
      if (bc.length !== 64 || !/^[0-9a-fA-F]+$/.test(bc)) return null;
    }
    const base: Record<string, unknown> = {
      operation,
      sourceChain,
      destinationChain: destChainLabel.trim() || undefined,
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
          ? 'LOCK intent: relayer can pick up on-chain Locked events and build merkle-inclusion proofs when a tx anchor is present.'
          : 'BURN intent: EVM/Cardano burn tests use wrapped-token flow; burnCommitment ties the burn to Midnight depositCommitment.',
    };
    if (operation === 'BURN') {
      base.burnCommitmentHex = bc;
      if (sourceChain === 'cardano') {
        const txH = cardanoBurnTxHex.replace(/^0x/i, '').trim();
        const oi = Math.max(0, Number.parseInt(cardanoBurnOutputIndex, 10) || 0);
        if (txH.length === 64 && /^[0-9a-fA-F]+$/.test(txH)) {
          base.source = { cardano: { txHash: txH, outputIndex: oi } };
        }
      }
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
    evmConnected,
    evmAddress,
    cardanoWalletKey,
    cardanoUsedAddressesHex,
    midnightConnected,
    midnightShieldedAddress,
    midnightUnshieldedAddress,
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
          ? 'Add a recipient address, and enter the burn commitment as exactly 64 hexadecimal characters (32 bytes).'
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
      const data = (await res.json()) as { jobId?: string; job?: RelayerJob; error?: string };
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
          const j = (await st.json()) as RelayerJob;
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
  }, [buildPayload, relayerUrl, stopPoll, operation]);

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
          Send a <strong>lock</strong> or <strong>burn</strong> request to the <strong>zk-stables-relayer</strong>. The relayer
          waits for (simulated or real) finality, runs a stub proof step, then returns status and hints. You still deploy pool
          contracts on EVM/Cardano separately; this form only talks to the relayer HTTP API.
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
          <Alert severity="warning" sx={{ mb: 2 }} onClose={dismissRelayerStubWarn}>
            Reference relayer keeps jobs in memory and uses stub proofs — data is lost when the process stops. Start it with{' '}
            <code>cd zk-stables-relayer &amp;&amp; npm start</code>, or point the UI at your relayer with <code>VITE_RELAYER_URL</code>.
            Closing this message saves your choice in the browser until site data is cleared.
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
                ? 'Lock funds on the source chain toward a mint or credit on the destination.'
                : 'Burn on the source chain so funds can be released back on that chain after proof.'
            }
          >
            <MenuItem value="LOCK">LOCK</MenuItem>
            <MenuItem value="BURN">BURN</MenuItem>
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
              <MenuItem value="cardano">Cardano</MenuItem>
              <MenuItem value="midnight">Midnight</MenuItem>
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
              helperText="Decimal string as your integration expects (demo default is a plain number)."
            />
          </Stack>
          {operation === 'BURN' && (
            <>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'flex-start' }}>
                <TextField
                  label="Burn commitment"
                  size="small"
                  fullWidth
                  value={burnCommitmentHex}
                  onChange={(e) => setBurnCommitmentHex(e.target.value.replace(/\s/g, ''))}
                  helperText="Exactly 64 hex characters (32 bytes). Must match the commitment emitted when you burn on-chain."
                />
                <Button sx={{ mt: { xs: 0, sm: 0.5 } }} size="small" variant="outlined" onClick={() => setBurnCommitmentHex(randomBytes32Hex())}>
                  Generate random
                </Button>
              </Stack>
              {sourceChain === 'cardano' && (
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                  <TextField
                    label="Cardano burn transaction id"
                    size="small"
                    fullWidth
                    value={cardanoBurnTxHex}
                    onChange={(e) => setCardanoBurnTxHex(e.target.value.replace(/\s/g, ''))}
                    helperText="Optional. 64-character hex transaction id for Cardano-sourced burn tests (stub anchor)."
                  />
                  <TextField
                    label="UTxO output index"
                    size="small"
                    type="number"
                    sx={{ minWidth: 120 }}
                    value={cardanoBurnOutputIndex}
                    onChange={(e) => setCardanoBurnOutputIndex(e.target.value)}
                  />
                </Stack>
              )}
            </>
          )}
          <TextField
            label={operation === 'LOCK' ? 'Recipient on destination chain' : 'Recipient on source chain (funds return here)'}
            size="small"
            fullWidth
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            helperText={
              lockNeedsMidnightRecipient
                ? 'Use a Midnight address only (shielded mn_* or unshielded mn_addr_*). Do not use an EVM 0x or Cardano address here.'
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
          {(burnNeedsSourceRecipient || lockNeedsNonMidnightRecipient) && (
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
                  proof: {relayerJob.proofBundle.algorithm} · {relayerJob.proofBundle.digest}
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
