import React, { useMemo } from 'react';
import { Box, Card, CardContent, Typography, Stack, Button } from '@mui/material';
import { formatUnits } from 'viem';
import { useZkStables } from '../hooks/useZkStables.js';
import type { RegistryDepositEntry } from '../contexts/ZkStablesContext.js';
import { REGISTRY_DEPOSIT_STATUS_BURNED } from '../constants/registryDepositStatus.js';

function StateRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Stack
      direction={{ xs: 'column', sm: 'row' }}
      spacing={{ xs: 0.25, sm: 2 }}
      sx={{
        py: 0.75,
        borderBottom: 1,
        borderColor: 'divider',
        '&:last-of-type': { borderBottom: 0 },
      }}
    >
      <Typography
        component="dt"
        variant="caption"
        color="text.secondary"
        sx={{ fontWeight: 600, minWidth: { sm: 140 }, flexShrink: 0 }}
      >
        {label}
      </Typography>
      <Box component="dd" sx={{ m: 0, minWidth: 0 }}>
        {children}
      </Box>
    </Stack>
  );
}

const LEDGER_AMOUNT_DECIMALS = 6;

const emptyRegistryDeposits: RegistryDepositEntry[] = [];

export const BridgeStatusCard: React.FC = () => {
  const { ledger, contractAddress, refreshLedger } = useZkStables();

  const { openDeposits, burnedCount } = useMemo(() => {
    if (!ledger) return { openDeposits: emptyRegistryDeposits, burnedCount: 0 };
    const burnedCount = ledger.deposits.filter((d) => d.status === REGISTRY_DEPOSIT_STATUS_BURNED).length;
    const openDeposits = ledger.deposits.filter((d) => d.status !== REGISTRY_DEPOSIT_STATUS_BURNED);
    return { openDeposits, burnedCount };
  }, [ledger]);

  return (
    <Card id="panel-bridge-state" variant="outlined">
      <CardContent>
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
          <Typography variant="h6" component="h3">
            On-chain bridge state
          </Typography>
          <Button size="small" variant="outlined" onClick={() => void refreshLedger()} disabled={!contractAddress}>
            Refresh
          </Button>
        </Stack>
        {!contractAddress && (
          <Typography variant="body2" color="text.secondary">
            Deploy or join a Midnight contract first — then you can load on-chain bridge state here.
          </Typography>
        )}
        {contractAddress && !ledger && (
          <Typography variant="body2" color="text.secondary">
            No data from the indexer yet. Check your Midnight indexer, then press Refresh.
          </Typography>
        )}
        {ledger && (
          <Stack component="dl" spacing={0} sx={{ m: 0 }}>
            <StateRow label="Bridge operator">
              <Typography variant="body2" component="div" sx={{ wordBreak: 'break-all', fontFamily: 'monospace', fontSize: '0.75rem' }}>
                {ledger.bridgeOperatorHex.slice(0, 16)}…
              </Typography>
            </StateRow>
            <StateRow label="Open deposits">
              <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                {ledger.depositCount}
                {burnedCount > 0 ? (
                  <Typography component="span" variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>
                    {burnedCount} finalized burn{burnedCount === 1 ? '' : 's'} omitted (supply destroyed on-chain).
                  </Typography>
                ) : null}
              </Typography>
            </StateRow>
            {openDeposits.map((dep) => (
              <Box key={dep.depositCommitmentHex} sx={{ pl: 1, py: 0.5, borderLeft: 2, borderColor: 'divider', mb: 1 }}>
                <Typography variant="caption" sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
                  {dep.depositCommitmentHex.slice(0, 16)}…
                </Typography>
                <Typography variant="body2">
                  {dep.statusLabel} · {dep.assetKind === 0 ? 'USDC' : 'USDT'} · {formatUnits(dep.amount, LEDGER_AMOUNT_DECIMALS)}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  minted={String(dep.mintedUnshielded)} released={String(dep.unshieldedReleased)}
                </Typography>
              </Box>
            ))}
          </Stack>
        )}
      </CardContent>
    </Card>
  );
};
