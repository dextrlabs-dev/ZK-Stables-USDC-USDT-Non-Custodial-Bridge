import React, { useCallback, useMemo, useState } from 'react';
import { Alert, Button, Card, CardContent, MenuItem, Stack, TextField, Typography } from '@mui/material';
import { useZkStables } from '../hooks/useZkStables.js';

function hexToUint8Array(hex: string): Uint8Array {
  const clean = hex.replace(/^0x/i, '');
  const arr = new Uint8Array(clean.length / 2);
  for (let i = 0; i < arr.length; i++) arr[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return arr;
}

export const CircuitActions: React.FC = () => {
  const {
    isConnected,
    contractAddress,
    ledger,
    recipientCommHex,
    setRecipientCommHex,
    sendToAddressInput,
    setSendToAddressInput,
    proveHolder,
    mintWrappedUnshielded,
    initiateBurn,
    sendWrappedUnshieldedToUser,
    finalizeBurn,
    canProveHolder,
    canMint,
    canInitiateBurn,
    canSendWrapped,
    canFinalizeBurn,
    flowMessage,
  } = useZkStables();

  const [selectedDepHex, setSelectedDepHex] = useState('');

  const depositOptions = useMemo(
    () => (ledger?.deposits ?? []).map((d) => ({
      hex: d.depositCommitmentHex,
      label: `${d.depositCommitmentHex.slice(0, 8)}… · ${d.statusLabel} · ${d.assetKind === 0 ? 'USDC' : 'USDT'}`,
      status: d.status,
    })),
    [ledger],
  );

  const selectedDep = useMemo(
    () => (selectedDepHex ? hexToUint8Array(selectedDepHex) : undefined),
    [selectedDepHex],
  );

  const depStatus = useMemo(
    () => depositOptions.find((o) => o.hex === selectedDepHex)?.status ?? 0,
    [depositOptions, selectedDepHex],
  );

  const handleProveHolder = useCallback(() => {
    if (selectedDep) void proveHolder(selectedDep);
  }, [proveHolder, selectedDep]);

  const handleMint = useCallback(() => {
    if (selectedDep) void mintWrappedUnshielded(selectedDep);
  }, [mintWrappedUnshielded, selectedDep]);

  const handleInitiateBurn = useCallback(() => {
    if (selectedDep) void initiateBurn({ depositCommitment: selectedDep, destChain: '2' });
  }, [initiateBurn, selectedDep]);

  const handleSendWrapped = useCallback(() => {
    if (selectedDep) void sendWrappedUnshieldedToUser(selectedDep);
  }, [sendWrappedUnshieldedToUser, selectedDep]);

  const handleFinalizeBurn = useCallback(() => {
    if (selectedDep) void finalizeBurn(selectedDep);
  }, [finalizeBurn, selectedDep]);

  const noDeposits = depositOptions.length === 0;

  return (
    <Card id="panel-circuits" variant="outlined">
      <CardContent>
        <Typography variant="h6" component="h3" gutterBottom>
          Midnight registry actions
        </Typography>
        {!isConnected && (
          <Alert severity="warning">Connect Midnight Lace (or dev seed) to sign transactions.</Alert>
        )}
        {isConnected && !contractAddress && (
          <Alert severity="warning">Deploy or join a contract in the panel above before running these steps.</Alert>
        )}
        {flowMessage && (
          <Alert severity="info" sx={{ my: 1 }}>
            {flowMessage}
          </Alert>
        )}

        <TextField
          select
          label="Select deposit"
          size="small"
          fullWidth
          value={selectedDepHex}
          onChange={(e) => setSelectedDepHex(e.target.value)}
          sx={{ mt: 2 }}
          disabled={noDeposits}
          helperText={noDeposits ? 'No deposits registered yet — bridge a LOCK first.' : undefined}
        >
          {depositOptions.map((o) => (
            <MenuItem key={o.hex} value={o.hex}>
              {o.label}
            </MenuItem>
          ))}
        </TextField>

        <Typography variant="subtitle2" color="primary.light" sx={{ mt: 2 }}>
          Mint steps (status: Active)
        </Typography>
        <Stack direction="row" flexWrap="wrap" gap={1} sx={{ mt: 1 }}>
          <Button
            variant="outlined"
            disabled={!isConnected || !contractAddress || !selectedDep || !canProveHolder || depStatus !== 1}
            onClick={handleProveHolder}
          >
            Prove holder
          </Button>
          <Button
            variant="outlined"
            disabled={!isConnected || !contractAddress || !selectedDep || !canMint || depStatus !== 1}
            onClick={handleMint}
          >
            Mint wrapped (unshielded)
          </Button>
        </Stack>

        <Typography variant="subtitle2" color="primary.light" sx={{ mt: 2 }}>
          Burn flow (1 → 2 → 3)
        </Typography>
        <Stack spacing={1.5} sx={{ mt: 1 }}>
          <TextField
            label="Recipient commitment (64 hex)"
            size="small"
            fullWidth
            value={recipientCommHex}
            onChange={(e) => setRecipientCommHex(e.target.value.replace(/\s/g, ''))}
          />
          <Button
            variant="outlined"
            disabled={!isConnected || !contractAddress || !selectedDep || !canInitiateBurn || depStatus !== 1}
            onClick={handleInitiateBurn}
          >
            1. Start burn (initiateBurn)
          </Button>
          <TextField
            label="Recipient Midnight address (mn_addr… or hex)"
            size="small"
            fullWidth
            value={sendToAddressInput}
            onChange={(e) => setSendToAddressInput(e.target.value)}
          />
          <Button
            variant="outlined"
            disabled={!isConnected || !contractAddress || !selectedDep || !canSendWrapped || depStatus !== 2}
            onClick={handleSendWrapped}
          >
            2. Send wrapped to user
          </Button>
          <Button
            variant="outlined"
            disabled={!isConnected || !contractAddress || !selectedDep || !canFinalizeBurn || depStatus !== 2}
            onClick={handleFinalizeBurn}
          >
            3. Finalize burn
          </Button>
        </Stack>
      </CardContent>
    </Card>
  );
};
