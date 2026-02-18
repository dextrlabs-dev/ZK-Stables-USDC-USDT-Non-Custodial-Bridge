import React from 'react';
import { Alert, Button, Card, CardContent, Stack, TextField, Typography } from '@mui/material';
import { useZkStables } from '../hooks/useZkStables.js';

export const CircuitActions: React.FC = () => {
  const {
    isConnected,
    contractAddress,
    burnDestChain,
    setBurnDestChain,
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

  return (
    <Card id="panel-circuits" variant="outlined">
      <CardContent>
        <Typography variant="h6" component="h3" gutterBottom>
          Midnight contract actions
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          Buttons call the zk-stables Compact contract using the same names as in code (<code>proveHolder</code>, etc.).
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
        <Typography variant="subtitle2" color="primary.light" sx={{ mt: 2 }}>
          Holder steps
        </Typography>
        <Stack direction="row" flexWrap="wrap" gap={1} sx={{ mt: 1 }}>
          <Button
            variant="outlined"
            disabled={!isConnected || !contractAddress || !canProveHolder}
            onClick={() => void proveHolder()}
            title="Contract method: proveHolder"
          >
            Prove holder
          </Button>
        </Stack>
        <Typography variant="subtitle2" color="secondary.light" sx={{ mt: 2 }}>
          Operator steps
        </Typography>
        <Stack direction="row" flexWrap="wrap" gap={1} sx={{ mt: 1 }}>
          <Button
            variant="outlined"
            disabled={!isConnected || !contractAddress || !canMint}
            onClick={() => void mintWrappedUnshielded()}
            title="Contract method: mintWrappedUnshielded"
          >
            Mint wrapped (unshielded)
          </Button>
          <Button
            variant="outlined"
            disabled={!isConnected || !contractAddress || !canFinalizeBurn}
            onClick={() => void finalizeBurn()}
            title="Contract method: finalizeBurn"
          >
            Finalize burn
          </Button>
        </Stack>
        <Typography variant="subtitle2" color="primary.light" sx={{ mt: 2 }}>
          Holder — burn and transfer
        </Typography>
        <Stack spacing={1.5} sx={{ mt: 1 }}>
          <TextField
            label="Destination chain id (for initiateBurn)"
            size="small"
            value={burnDestChain}
            onChange={(e) => setBurnDestChain(e.target.value)}
          />
          <TextField
            label="Recipient commitment (64 hex)"
            size="small"
            fullWidth
            value={recipientCommHex}
            onChange={(e) => setRecipientCommHex(e.target.value.replace(/\s/g, ''))}
            helperText="Used by initiateBurn on the contract."
          />
          <Button
            variant="outlined"
            disabled={!isConnected || !contractAddress || !canInitiateBurn}
            onClick={() => void initiateBurn()}
            title="Contract method: initiateBurn"
          >
            Start burn
          </Button>
          <TextField
            label="Recipient Midnight address (mn_addr… or hex)"
            size="small"
            fullWidth
            value={sendToAddressInput}
            onChange={(e) => setSendToAddressInput(e.target.value)}
            helperText="For sendWrappedUnshieldedToUser."
          />
          <Button
            variant="outlined"
            disabled={!isConnected || !contractAddress || !canSendWrapped}
            onClick={() => void sendWrappedUnshieldedToUser()}
            title="Contract method: sendWrappedUnshieldedToUser"
          >
            Send wrapped to user
          </Button>
        </Stack>
      </CardContent>
    </Card>
  );
};
