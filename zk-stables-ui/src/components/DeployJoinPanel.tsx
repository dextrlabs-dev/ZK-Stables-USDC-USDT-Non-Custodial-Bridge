import React, { useCallback, useEffect, useState } from 'react';
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
import { AssetKind } from '../constants/zk-stables.js';
import { useZkStables } from '../hooks/useZkStables.js';
import type { BridgeDeployment } from '../contexts/ZkStablesContext.js';
import { LaceWalletCard } from './LaceWalletCard.js';
import { deriveBytes32HexFromGenesis, normalizeGenesisSeedHashHex } from '../utils/genesisSeed.js';

export const DeployJoinPanel: React.FC = () => {
  const {
    deployment$,
    flowMessage,
    isConnected,
    isConnecting,
    deployParams,
    setDeployParams,
    joinAddress,
    setJoinAddress,
    connectAndDeploy,
    connectAndJoin,
    proveHolder,
    mintWrappedUnshielded,
    initiateBurn,
    finalizeBurn,
  } = useZkStables();

  const [deployment, setDeployment] = useState<BridgeDeployment>({ status: 'idle' });
  const [genesisSeedInput, setGenesisSeedInput] = useState(
    '0000000000000000000000000000000000000000000000000000000000000001',
  );
  const [genesisSeedHashHex, setGenesisSeedHashHex] = useState<string | null>(null);
  const [genesisErr, setGenesisErr] = useState<string | null>(null);

  useEffect(() => {
    const sub = deployment$.subscribe(setDeployment);
    return () => sub.unsubscribe();
  }, [deployment$]);

  const net = import.meta.env.VITE_NETWORK_ID || 'undeployed';

  const deployJoinDisabled = !isConnected || isConnecting || deployment.status === 'in-progress';

  const deriveFromGenesis = useCallback(async () => {
    setGenesisErr(null);
    try {
      const seedHex = await normalizeGenesisSeedHashHex(genesisSeedInput);
      setGenesisSeedHashHex(seedHex);
      const dep = await deriveBytes32HexFromGenesis({ genesisSeedHashHex: seedHex, label: 'zkstables:depositCommitment:v1' });
      const op = await deriveBytes32HexFromGenesis({ genesisSeedHashHex: seedHex, label: 'zkstables:operatorSk:v1' });
      const holder = await deriveBytes32HexFromGenesis({ genesisSeedHashHex: seedHex, label: 'zkstables:holderSk:v1' });
      setDeployParams((p) => ({
        ...p,
        depositCommitmentHex: dep,
        operatorSkHex: op,
        holderSkHex: holder,
      }));
    } catch (e) {
      setGenesisErr(e instanceof Error ? e.message : String(e));
    }
  }, [genesisSeedInput, setDeployParams]);

  const runGenesisDemo = useCallback(async () => {
    setGenesisErr(null);
    try {
      await deriveFromGenesis();
      // Deploy (requires Lace already connected; connectAndDeploy will error with guidance if not).
      await connectAndDeploy();
      // Run a minimal “all operations” path on the deployed contract.
      await proveHolder();
      await mintWrappedUnshielded();
      await initiateBurn();
      await finalizeBurn();
    } catch (e) {
      setGenesisErr(e instanceof Error ? e.message : String(e));
    }
  }, [connectAndDeploy, deriveFromGenesis, finalizeBurn, initiateBurn, mintWrappedUnshielded, proveHolder]);

  return (
    <Stack id="panel-midnight-deploy" spacing={2}>
      <LaceWalletCard />
      <Card variant="outlined">
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Deploy and join
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Dev demo: operator and holder secrets stay in this browser tab only. Connect Lace above, then deploy or join
            on network <code>{net}</code>.
          </Typography>
          {!isConnected && (
            <Alert severity="info" sx={{ mb: 2 }}>
              Connect Midnight Lace first (shielded address appears in the card above).
            </Alert>
          )}
          {flowMessage && (
            <Alert severity="info" sx={{ mb: 2 }}>
              {flowMessage}
            </Alert>
          )}
          {deployment.status === 'failed' && (
            <Alert severity="error" sx={{ mb: 2, '& .MuiAlert-message': { width: '100%' } }}>
              <Typography variant="body2" component="div" sx={{ whiteSpace: 'pre-line' }}>
                {deployment.error.message}
              </Typography>
            </Alert>
          )}

          <Typography variant="subtitle2" sx={{ mt: 2 }}>
            Deploy (new instance)
          </Typography>
          <Stack spacing={1.5} sx={{ mt: 1, mb: 2 }}>
            <Typography variant="body2" color="text.secondary">
              Prefill (recommended): paste a <b>genesis seed hash</b> (64 hex) or any string. We derive deterministic
              `depositCommitment`, operator SK, and holder SK for reproducible Midnight deploys.
            </Typography>
            {genesisErr && <Alert severity="error">{genesisErr}</Alert>}
            <TextField
              label="Genesis seed hash (64 hex) or string"
              fullWidth
              size="small"
              value={genesisSeedInput}
              onChange={(e) => setGenesisSeedInput(e.target.value)}
            />
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              <Button variant="outlined" onClick={() => void deriveFromGenesis()}>
                Derive deploy params from genesis seed
              </Button>
              <Button variant="contained" disabled={deployJoinDisabled} onClick={() => void runGenesisDemo()}>
                One-click Genesis deploy + run all Midnight ops
              </Button>
              <Button
                variant="text"
                onClick={() => {
                  setDeployParams((p) => ({ ...p, sourceChainId: '31337', amount: '1000000', assetKind: AssetKind.USDC }));
                }}
              >
                Prefill local demo (sourceChainId=31337, 1e6, USDC)
              </Button>
            </Box>
            {genesisSeedHashHex && (
              <Typography variant="caption" sx={{ wordBreak: 'break-all' }}>
                normalized genesisSeedHash: <code>{genesisSeedHashHex}</code>
              </Typography>
            )}

            <TextField
              label="Deposit commitment (64 hex)"
              fullWidth
              size="small"
              value={deployParams.depositCommitmentHex}
              onChange={(e) => setDeployParams((p) => ({ ...p, depositCommitmentHex: e.target.value.replace(/\s/g, '') }))}
            />
            <TextField
              select
              label="Asset kind"
              size="small"
              value={deployParams.assetKind}
              onChange={(e) => setDeployParams((p) => ({ ...p, assetKind: Number(e.target.value) }))}
            >
              <MenuItem value={AssetKind.USDC}>USDC</MenuItem>
              <MenuItem value={AssetKind.USDT}>USDT</MenuItem>
            </TextField>
            <TextField
              label="Source chain id"
              size="small"
              value={deployParams.sourceChainId}
              onChange={(e) => setDeployParams((p) => ({ ...p, sourceChainId: e.target.value }))}
            />
            <TextField
              label="Amount (ledger units)"
              size="small"
              value={deployParams.amount}
              onChange={(e) => setDeployParams((p) => ({ ...p, amount: e.target.value }))}
            />
            <TextField
              label="Operator SK (64 hex)"
              fullWidth
              size="small"
              value={deployParams.operatorSkHex}
              onChange={(e) => setDeployParams((p) => ({ ...p, operatorSkHex: e.target.value.replace(/\s/g, '') }))}
            />
            <TextField
              label="Holder SK (64 hex)"
              fullWidth
              size="small"
              value={deployParams.holderSkHex}
              onChange={(e) => setDeployParams((p) => ({ ...p, holderSkHex: e.target.value.replace(/\s/g, '') }))}
            />
            <Button variant="contained" disabled={deployJoinDisabled} onClick={() => void connectAndDeploy()}>
              Deploy new contract
            </Button>
          </Stack>

          <Typography variant="subtitle2">Join existing</Typography>
          <Box sx={{ display: 'flex', gap: 1, mt: 1, flexWrap: 'wrap' }}>
            <TextField
              label="Contract address"
              size="small"
              fullWidth
              sx={{ flex: 1, minWidth: 200 }}
              value={joinAddress}
              onChange={(e) => setJoinAddress(e.target.value.trim())}
            />
            <Button variant="outlined" disabled={deployJoinDisabled} onClick={() => void connectAndJoin()}>
              Join contract
            </Button>
          </Box>
        </CardContent>
      </Card>
    </Stack>
  );
};
