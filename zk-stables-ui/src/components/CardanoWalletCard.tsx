import React from 'react';
import { Alert, Button, Card, CardContent, Chip, Stack, Typography } from '@mui/material';
import { useCrossChainWallets } from '../contexts/CrossChainWalletContext.js';
import { isDemoCardanoMnemonicConfigured } from '../cardano/demoMnemonicMeshWallet.js';

export const CardanoWalletCard: React.FC = () => {
  const {
    cardanoWalletKey,
    cardanoUsedAddressesHex,
    cardanoNetworkId,
    cardanoDisplay,
    isDemoCardano,
    cardanoBech32Preview,
    applyDemoCardano,
    disconnectCardano,
  } = useCrossChainWallets();

  const mnemonicOk = isDemoCardanoMnemonicConfigured();
  const connected = Boolean(cardanoWalletKey && cardanoDisplay);

  return (
    <Card id="panel-cardano" variant="outlined">
      <CardContent>
        <Stack direction="row" alignItems="center" gap={1} sx={{ mb: 0.5 }}>
          <Typography variant="h6" component="h3">
            Cardano (in-app signing)
          </Typography>
          {isDemoCardano && <Chip size="small" label="Demo row" color="secondary" variant="outlined" />}
        </Stack>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Lock and BridgeRelease use <code>VITE_DEMO_CARDANO_WALLET_MNEMONIC</code> (same phrase as{' '}
          <code>RELAYER_CARDANO_WALLET_MNEMONIC</code>) baked into the build. The UI turns this on automatically when the env var
          is set; there is no browser extension connect.
        </Typography>
        {!mnemonicOk && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            Set <code>VITE_DEMO_CARDANO_WALLET_MNEMONIC</code> in <code>.env.development</code> / <code>.env.production</code>,
            rebuild, then reload. Without it you only get a synthetic address preview (no signing).
          </Alert>
        )}
        {connected && (
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
        {!connected && mnemonicOk && (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            Disconnected — restore the in-app wallet to load addresses from the mnemonic.
          </Typography>
        )}
        <Stack direction="row" flexWrap="wrap" gap={1} alignItems="center">
          {!cardanoWalletKey ? (
            <Button variant="contained" onClick={applyDemoCardano}>
              {mnemonicOk ? 'Restore in-app wallet' : 'Use synthetic preview (no signing)'}
            </Button>
          ) : null}
          <Button variant="outlined" disabled={!cardanoWalletKey} onClick={disconnectCardano}>
            Disconnect
          </Button>
        </Stack>
      </CardContent>
    </Card>
  );
};
