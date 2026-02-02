import React from 'react';
import { Card, CardContent, Typography, Stack, Button } from '@mui/material';
import { useZkStables } from '../hooks/useZkStables.js';

export const BridgeStatusCard: React.FC = () => {
  const { ledger, contractAddress, refreshLedger } = useZkStables();

  return (
    <Card id="panel-bridge-state" variant="outlined">
      <CardContent>
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
          <Typography variant="h6">On-chain bridge state</Typography>
          <Button size="small" variant="outlined" onClick={() => void refreshLedger()} disabled={!contractAddress}>
            Refresh
          </Button>
        </Stack>
        {!contractAddress && (
          <Typography color="text.secondary">Deploy or join a contract to load ledger state.</Typography>
        )}
        {contractAddress && !ledger && (
          <Typography color="text.secondary">No indexer state yet (try Refresh).</Typography>
        )}
        {ledger && (
          <Stack spacing={0.5} sx={{ fontFamily: 'monospace', fontSize: 14 }}>
            <div>state: {ledger.stateLabel}</div>
            <div>assetKind: {ledger.assetKind === 0 ? 'USDC' : 'USDT'}</div>
            <div>amount: {ledger.amount.toString()}</div>
            <div>sourceChainId: {ledger.sourceChainId.toString()}</div>
            <div>destChainId: {ledger.destChainId.toString()}</div>
            <div>mintedUnshielded: {String(ledger.mintedUnshielded)}</div>
            <div>unshieldedReleased: {String(ledger.unshieldedReleased)}</div>
            <Typography component="div" sx={{ wordBreak: 'break-all' }}>
              depositCommitment: {ledger.depositCommitmentHex}
            </Typography>
            <Typography component="div" sx={{ wordBreak: 'break-all' }}>
              recipientCommitment: {ledger.recipientCommitmentHex}
            </Typography>
          </Stack>
        )}
      </CardContent>
    </Card>
  );
};
