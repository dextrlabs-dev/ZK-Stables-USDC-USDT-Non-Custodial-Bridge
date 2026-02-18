import React, { useEffect, useState } from 'react';
import { Alert, Button, Card, CardContent, Chip, MenuItem, Stack, TextField, Typography } from '@mui/material';
import { useCrossChainWallets } from '../contexts/CrossChainWalletContext.js';

export const CardanoWalletCard: React.FC = () => {
  const {
    cardanoWalletKey,
    cardanoUsedAddressesHex,
    cardanoNetworkId,
    cardanoDisplay,
    isDemoCardano,
    cardanoBech32Preview,
    applyDemoCardano,
    listCardanoWallets,
    connectCardano,
    disconnectCardano,
  } = useCrossChainWallets();

  const [keys, setKeys] = useState<string[]>([]);
  const [selected, setSelected] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const t = window.setInterval(() => setKeys(listCardanoWallets()), 600);
    return () => window.clearInterval(t);
  }, [listCardanoWallets]);

  useEffect(() => {
    if (keys.length && !selected) setSelected(keys[0]!);
  }, [keys, selected]);

  return (
    <Card id="panel-cardano" variant="outlined">
      <CardContent>
        <Stack direction="row" alignItems="center" gap={1} sx={{ mb: 0.5 }}>
          <Typography variant="h6" component="h3">
            Cardano (CIP-30)
          </Typography>
          {isDemoCardano && <Chip size="small" label="Synthetic demo" color="secondary" variant="outlined" />}
        </Stack>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Connect a Cardano browser wallet (CIP-30) for address discovery. On-chain Plutus lock/unlock flows are not wired in
          this demo yet.
        </Typography>
        {keys.length === 0 && (
          <Alert severity="info" sx={{ mb: 2 }}>
            No Cardano extension found (<code>window.cardano</code>). Install a CIP-30 wallet (e.g. Eternl, Nami), enable it
            for this site, then refresh.
          </Alert>
        )}
        {err && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setErr(null)}>
            {err}
          </Alert>
        )}
        {cardanoWalletKey && cardanoDisplay && (
          <Typography variant="body2" sx={{ mb: 1 }}>
            <strong>{cardanoWalletKey}</strong>
            {' · Network id '}
            {cardanoNetworkId ?? '—'}
            {cardanoBech32Preview && (
              <>
                <br />
                <Typography component="span" variant="dataMono" sx={{ wordBreak: 'break-all' }}>
                  {cardanoBech32Preview}
                </Typography>
              </>
            )}
            <br />
            <Typography component="span" variant="dataMono" sx={{ wordBreak: 'break-all' }}>
              {cardanoUsedAddressesHex[0] ?? cardanoDisplay}
            </Typography>
          </Typography>
        )}
        <Stack direction="row" flexWrap="wrap" gap={1} alignItems="center">
          <TextField
            select
            size="small"
            label="Extension"
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            sx={{ minWidth: 160 }}
            disabled={!keys.length}
          >
            {keys.map((k) => (
              <MenuItem key={k} value={k}>
                {k}
              </MenuItem>
            ))}
          </TextField>
          <Button
            variant="contained"
            disabled={!selected || !!cardanoWalletKey || busy}
            onClick={() => {
              setErr(null);
              setBusy(true);
              void connectCardano(selected)
                .catch((e) => setErr(e instanceof Error ? e.message : String(e)))
                .finally(() => setBusy(false));
            }}
          >
            {busy ? 'Connecting…' : 'Connect Cardano'}
          </Button>
          <Button variant="outlined" disabled={!cardanoWalletKey} onClick={disconnectCardano}>
            Disconnect
          </Button>
          <Button variant="text" size="small" disabled={!!cardanoWalletKey} onClick={applyDemoCardano}>
            Use synthetic demo (no extension)
          </Button>
        </Stack>
      </CardContent>
    </Card>
  );
};
