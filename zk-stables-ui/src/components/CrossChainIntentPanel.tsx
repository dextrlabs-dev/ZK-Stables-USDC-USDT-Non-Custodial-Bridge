import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useConnection } from 'wagmi';
import { useZkStables } from '../hooks/useZkStables.js';
import { useCrossChainWallets, type SourceChainKind } from '../contexts/CrossChainWalletContext.js';
import { AssetKind } from '../constants/zk-stables.js';

const defaultRelayerUrl = () =>
  (import.meta.env.VITE_RELAYER_URL && String(import.meta.env.VITE_RELAYER_URL).trim()) || 'http://127.0.0.1:8787';

type RelayerJob = {
  id: string;
  phase: string;
  lockRef: string;
  proofBundle?: { algorithm: string; digest: string; publicInputsHex: string };
  destinationHint?: string;
  error?: string;
  intent: unknown;
};

/** SRS §3.1 lock intent + POST to zk-stables-relayer (`/v1/intents/lock`). */
export const CrossChainIntentPanel: React.FC = () => {
  const { address: evmAddress, isConnected: evmConnected } = useConnection();
  const { walletAddress: midnightAddress, isConnected: midnightConnected } = useZkStables();
  const { cardanoUsedAddressesHex, cardanoWalletKey } = useCrossChainWallets();

  const [operation, setOperation] = useState<'LOCK' | 'BURN'>('LOCK');
  const [sourceChain, setSourceChain] = useState<SourceChainKind>('evm');
  const [destChainLabel, setDestChainLabel] = useState('midnight');
  const [asset, setAsset] = useState<'USDC' | 'USDT'>('USDC');
  const [amount, setAmount] = useState('100');
  const [recipient, setRecipient] = useState('');
  const [lastIntent, setLastIntent] = useState<string | null>(null);
  const [relayerUrl] = useState(defaultRelayerUrl);
  const [relayerJob, setRelayerJob] = useState<RelayerJob | null>(null);
  const [relayerError, setRelayerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const hintRecipient = useCallback(() => {
    // LOCK: recipient is destination address.
    // BURN: recipient is the *source* chain address to receive unlocked funds.
    if (operation === 'LOCK') {
      if (sourceChain === 'evm' && midnightConnected && midnightAddress) setRecipient(midnightAddress);
      else if (sourceChain === 'midnight' && evmConnected && evmAddress) setRecipient(evmAddress);
      else if (sourceChain === 'cardano' && midnightConnected && midnightAddress) setRecipient(midnightAddress);
      else if (sourceChain === 'cardano' && evmConnected && evmAddress) setRecipient(evmAddress);
      return;
    }
    // For demo burn flow on EVM, default to unlocking back to the connected EVM address.
    if (operation === 'BURN' && evmConnected && evmAddress) setRecipient(evmAddress);
  }, [operation, sourceChain, evmConnected, evmAddress, midnightConnected, midnightAddress]);

  const canPrefill = useMemo(() => {
    if (sourceChain === 'evm') return midnightConnected && !!midnightAddress;
    if (sourceChain === 'midnight') return evmConnected && !!evmAddress;
    if (sourceChain === 'cardano') return (midnightConnected && !!midnightAddress) || (evmConnected && !!evmAddress);
    return false;
  }, [sourceChain, evmConnected, evmAddress, midnightConnected, midnightAddress]);

  const buildPayload = useCallback(() => {
    const r = recipient.trim();
    if (!r) return null;
    return {
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
        midnight: midnightConnected ? midnightAddress : undefined,
      },
      note:
        operation === 'LOCK'
          ? 'LOCK: relayer may ingest on-chain Locked logs and generate merkle-inclusion-v1 proofs when anchored.'
          : 'BURN: relayer ingests Burned logs and can unlock underlying via unlockWithInclusionProof when configured.',
    };
  }, [
    operation,
    recipient,
    sourceChain,
    destChainLabel,
    asset,
    amount,
    evmConnected,
    evmAddress,
    cardanoWalletKey,
    cardanoUsedAddressesHex,
    midnightConnected,
    midnightAddress,
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

  const submitToRelayer = useCallback(async () => {
    const payload = buildPayload();
    if (!payload) {
      setRelayerError('Recipient required.');
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
      if (!job?.id) throw new Error('no job in response');
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

  return (
    <Card id="panel-cross-chain-intent" variant="outlined">
      <CardContent>
        <Typography variant="h6" gutterBottom>
          Cross-chain intent (LOCK/BURN)
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Sends the same JSON to the <strong>zk-stables-relayer</strong> service: synthetic finality wait → stub proof →
          destination hint. Pool contracts on EVM/Cardano are still separate deploys; the relayer is the orchestration
          shell from the architecture doc.
        </Typography>
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
          Relayer base URL: <code>{relayerUrl}</code> (<code>VITE_RELAYER_URL</code>)
        </Typography>
        <Alert severity="warning" sx={{ mb: 2 }}>
          Relayer uses in-memory jobs and stub proofs. Run <code>cd zk-stables-relayer &amp;&amp; npm start</code> on the
          same host or set <code>VITE_RELAYER_URL</code>.
        </Alert>
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
            helperText={operation === 'LOCK' ? 'LOCK → mint on destination' : 'BURN → unlock on source'}
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
              label="Destination chain (label)"
              size="small"
              fullWidth
              value={destChainLabel}
              onChange={(e) => setDestChainLabel(e.target.value)}
              helperText="Logical name or chain id string for routing (relayer config)."
            />
          </Stack>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField select label="Asset" size="small" value={asset} onChange={(e) => setAsset(e.target.value as 'USDC' | 'USDT')}>
              <MenuItem value="USDC">USDC</MenuItem>
              <MenuItem value="USDT">USDT</MenuItem>
            </TextField>
            <TextField label="Amount" size="small" fullWidth value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Stack>
          <TextField
            label={operation === 'LOCK' ? 'Recipient on destination' : 'Recipient on source (unlock-to)'}
            size="small"
            fullWidth
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            helperText="Address, bech32, or contract account per destination chain."
          />
          <Stack direction="row" flexWrap="wrap" gap={1}>
            <Button variant="outlined" disabled={!canPrefill} onClick={hintRecipient}>
              Prefill from connected wallets
            </Button>
            <Button variant="contained" onClick={recordLockIntent}>
              Record intent (JSON)
            </Button>
            <Button variant="contained" color="secondary" disabled={submitting} onClick={() => void submitToRelayer()}>
              {submitting ? 'Submitting…' : 'Submit to relayer'}
            </Button>
          </Stack>
          {relayerJob && (
            <Box>
              <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                Relayer job <code>{relayerJob.id}</code> — phase: <strong>{relayerJob.phase}</strong>
              </Typography>
              <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5 }}>
                lockRef: <code>{relayerJob.lockRef}</code>
              </Typography>
              {relayerJob.proofBundle && (
                <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-all' }}>
                  proof: {relayerJob.proofBundle.algorithm} · {relayerJob.proofBundle.digest}
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
          {lastIntent && (
            <Box>
              <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                Last intent (JSON)
              </Typography>
              <Box
                component="pre"
                sx={{
                  p: 1,
                  bgcolor: 'action.hover',
                  borderRadius: 1,
                  fontSize: 12,
                  overflow: 'auto',
                  maxHeight: 280,
                }}
              >
                {lastIntent}
              </Box>
            </Box>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
};
