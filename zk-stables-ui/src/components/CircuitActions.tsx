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
        <Typography variant="h6" gutterBottom>
          Circuits
        </Typography>
        {!isConnected && <Alert severity="warning">Connect Lace to sign transactions.</Alert>}
        {isConnected && !contractAddress && <Alert severity="warning">Deploy or join a contract first.</Alert>}
        {flowMessage && (
          <Alert severity="info" sx={{ my: 1 }}>
            {flowMessage}
          </Alert>
        )}
        <Typography variant="subtitle2" color="primary.light" sx={{ mt: 2 }}>
          Holder
        </Typography>
        <Stack direction="row" flexWrap="wrap" gap={1} sx={{ mt: 1 }}>
          <Button
            variant="outlined"
            disabled={!isConnected || !contractAddress || !canProveHolder}
            onClick={() => void proveHolder()}
          >
            proveHolder
          </Button>
        </Stack>
        <Typography variant="subtitle2" color="secondary.light" sx={{ mt: 2 }}>
          Operator
        </Typography>
        <Stack direction="row" flexWrap="wrap" gap={1} sx={{ mt: 1 }}>
          <Button
            variant="outlined"
            disabled={!isConnected || !contractAddress || !canMint}
            onClick={() => void mintWrappedUnshielded()}
          >
            mintWrappedUnshielded
          </Button>
          <Button
            variant="outlined"
            disabled={!isConnected || !contractAddress || !canFinalizeBurn}
            onClick={() => void finalizeBurn()}
          >
            finalizeBurn
          </Button>
        </Stack>
        <Typography variant="subtitle2" color="primary.light" sx={{ mt: 2 }}>
          Holder — exit path
        </Typography>
        <Stack spacing={1.5} sx={{ mt: 1 }}>
          <TextField
            label="initiateBurn: dest chain id"
            size="small"
            value={burnDestChain}
            onChange={(e) => setBurnDestChain(e.target.value)}
          />
          <TextField
            label="initiateBurn: recipient commitment (64 hex)"
            size="small"
            fullWidth
            value={recipientCommHex}
            onChange={(e) => setRecipientCommHex(e.target.value.replace(/\s/g, ''))}
          />
          <Button
            variant="outlined"
            disabled={!isConnected || !contractAddress || !canInitiateBurn}
            onClick={() => void initiateBurn()}
          >
            initiateBurn
          </Button>
          <TextField
            label="sendWrapped: mn_addr… or UserAddress hex"
            size="small"
            fullWidth
            value={sendToAddressInput}
            onChange={(e) => setSendToAddressInput(e.target.value)}
          />
          <Button
            variant="outlined"
            disabled={!isConnected || !contractAddress || !canSendWrapped}
            onClick={() => void sendWrappedUnshieldedToUser()}
          >
            sendWrappedUnshieldedToUser
          </Button>
        </Stack>
      </CardContent>
    </Card>
  );
};
