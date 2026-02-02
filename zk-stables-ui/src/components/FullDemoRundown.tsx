import React, { useCallback } from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Link,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';

const defaultRelayerHealth = () =>
  (import.meta.env.VITE_RELAYER_URL && String(import.meta.env.VITE_RELAYER_URL).trim()) || 'http://127.0.0.1:8787';

function scrollToId(id: string) {
  const el = document.getElementById(id);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

const Jump: React.FC<{ id: string; children: React.ReactNode }> = ({ id, children }) => (
  <Link
    component="button"
    type="button"
    variant="body2"
    onClick={() => scrollToId(id)}
    sx={{ verticalAlign: 'baseline', textAlign: 'left', p: 0, border: 0, background: 'none', cursor: 'pointer' }}
  >
    {children}
  </Link>
);

/**
 * End-to-end demo guide aligned with:
 * - Software Requirements Specification (ZK-Stables USDC/USDT Non-Custodial Bridge)
 * - Architectural Planning / System Architecture Blueprint (lock→prove→mint / burn→prove→unlock)
 */
export const FullDemoRundown: React.FC = () => {
  const relayerBase = defaultRelayerHealth();

  const openRelayerHealth = useCallback(() => {
    window.open(`${relayerBase}/v1/health/chains`, '_blank', 'noopener,noreferrer');
  }, [relayerBase]);

  return (
    <Card id="full-demo-rundown" variant="outlined" sx={{ borderColor: 'primary.dark' }}>
      <CardContent>
        <Typography variant="h5" component="h2" gutterBottom>
          Full demo rundown (SRS & architecture blueprint)
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          This walkthrough mirrors the official documents: non-custodial pools, relayer observation, proof generation,
          destination mint/release, burn, and source unlock. The reference UI implements a dev slice (local EVM + Midnight
          Compact + relayer); production targets add full SNARK verification and Cardano/Plutus parity.
        </Typography>

        <Stack direction="row" flexWrap="wrap" gap={1} sx={{ mb: 2 }}>
          <Button size="small" variant="contained" onClick={() => scrollToId('panel-cross-chain-intent')}>
            Cross-chain intents
          </Button>
          <Button size="small" variant="outlined" onClick={() => scrollToId('panel-midnight-deploy')}>
            Midnight deploy & wallet
          </Button>
          <Button size="small" variant="outlined" onClick={() => scrollToId('panel-evm')}>
            EVM wallet
          </Button>
          <Button size="small" variant="outlined" onClick={() => scrollToId('panel-cardano')}>
            Cardano wallet
          </Button>
          <Button size="small" variant="outlined" onClick={() => scrollToId('panel-bridge-state')}>
            On-chain bridge state
          </Button>
          <Button size="small" variant="outlined" onClick={() => scrollToId('panel-circuits')}>
            Circuits
          </Button>
          <Button size="small" variant="outlined" onClick={() => scrollToId('panel-tx-log')}>
            Transaction log
          </Button>
          <Button size="small" variant="text" onClick={openRelayerHealth}>
            Relayer health (open)
          </Button>
        </Stack>

        <Accordion defaultExpanded>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Typography fontWeight={600}>1. Product scope (SRS §1–2)</Typography>
          </AccordionSummary>
          <AccordionDetails>
            <Typography variant="body2" paragraph>
              ZK-Stables is a <strong>non-custodial</strong> bridge for USDC/USDT across <strong>EVM</strong>,{' '}
              <strong>Cardano</strong>, and <strong>Midnight</strong>. Users lock on a source chain; the system proves
              finality and event inclusion; destination contracts mint or release equivalent value. ZK replaces custodial
              multisig for verification (full SNARK path is staged in <code>zk/</code>).
            </Typography>
            <Stack direction="row" flexWrap="wrap" gap={0.5}>
              <Chip size="small" label="Non-custodial pools" variant="outlined" />
              <Chip size="small" label="ZK-verified finality (target)" variant="outlined" />
              <Chip size="small" label="SDK / widget surface" variant="outlined" />
            </Stack>
          </AccordionDetails>
        </Accordion>

        <Accordion defaultExpanded>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Typography fontWeight={600}>2. End-to-end workflows (blueprint)</Typography>
          </AccordionSummary>
          <AccordionDetails>
            <Typography variant="subtitle2" gutterBottom>
              Lock → proof → mint / release
            </Typography>
            <Box component="ol" sx={{ pl: 2, mb: 2 }}>
              <Typography component="li" variant="body2">
                User locks assets on the <strong>source</strong> chain (pool contract); a lock event includes nonce and
                metadata <Chip size="small" sx={{ ml: 0.5 }} label="FR-3.1.1" />.
              </Typography>
              <Typography component="li" variant="body2">
                <strong>Relayer</strong> observes the event, waits for finality, builds inclusion + finality data, and
                produces a proof bundle <Chip size="small" sx={{ ml: 0.5 }} label="FR-3.1.2" />.
              </Typography>
              <Typography component="li" variant="body2">
                <strong>Destination</strong> verifier checks the proof; wrapped or ledger state updates; recipient receives
                funds <Chip size="small" sx={{ ml: 0.5 }} label="FR-3.1.3" />.
              </Typography>
            </Box>
            <Typography variant="subtitle2" gutterBottom>
              Burn → proof → unlock
            </Typography>
            <Box component="ol" sx={{ pl: 2 }}>
              <Typography component="li" variant="body2">
                User burns wrapped (or equivalent) on the <strong>destination</strong>; burn event is emitted{' '}
                <Chip size="small" sx={{ ml: 0.5 }} label="FR-3.1.4" />.
              </Typography>
              <Typography component="li" variant="body2">
                Relayer proves burn finality / inclusion and submits to <strong>source</strong> unlock verifier.
              </Typography>
              <Typography component="li" variant="body2">
                Source pool releases locked assets to the recipient; nonce replay prevented{' '}
                <Chip size="small" sx={{ ml: 0.5 }} label="FR-3.1.5" />.
              </Typography>
            </Box>
          </AccordionDetails>
        </Accordion>

        <Accordion>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Typography fontWeight={600}>3. What to run locally (stack)</Typography>
          </AccordionSummary>
          <AccordionDetails>
            <Typography variant="body2" component="div" sx={{ mb: 1 }}>
              For the integrated demo:
            </Typography>
            <Box component="ul" sx={{ pl: 2, mb: 1 }}>
              <Typography component="li" variant="body2">
                <code>midnight-local-network</code>: node <code>:9944</code>, indexer <code>:8088</code>, proof-server{' '}
                <code>:6300</code>
              </Typography>
              <Typography component="li" variant="body2">
                Anvil (or dev EVM) <code>:8545</code> with pool / mint / wrapped contracts deployed
              </Typography>
              <Typography component="li" variant="body2">
                Relayer <code>:8787</code> with <code>VITE_RELAYER_URL</code> pointing at it; use{' '}
                <Button size="small" onClick={openRelayerHealth}>
                  GET /v1/health/chains
                </Button>{' '}
                to confirm EVM + indexer + optional Cardano.
              </Typography>
            </Box>
            <Alert severity="info">
              Open this UI on the same host as the services (or tunnel ports) so the browser can reach ports 6300, 8088,
              9944. Use <strong>Connect dev seed (no Lace)</strong> in{' '}
              <Jump id="panel-midnight-deploy">Midnight</Jump> for a deterministic local wallet; fund the shown{' '}
              <strong>unshielded</strong> address from your dev faucet if transactions fail with insufficient balance.
            </Alert>
          </AccordionDetails>
        </Accordion>

        <Accordion defaultExpanded>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Typography fontWeight={600}>4. UI steps mapped to SRS (happy path)</Typography>
          </AccordionSummary>
          <AccordionDetails>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Step</TableCell>
                  <TableCell>SRS / architecture</TableCell>
                  <TableCell>In this UI</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                <TableRow>
                  <TableCell>A</TableCell>
                  <TableCell>
                    <Chip size="small" label="FR-3.1.1" /> Lock intent + on-chain lock (EVM pool)
                  </TableCell>
                  <TableCell>
                    <Jump id="panel-demo-wallets">Optional: load demo EVM + Cardano</Jump>; connect real{' '}
                    <Jump id="panel-evm">EVM</Jump>. Submit <strong>LOCK</strong> in{' '}
                    <Jump id="panel-cross-chain-intent">Cross-chain intents</Jump> (relayer ingests watcher events).
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>B</TableCell>
                  <TableCell>
                    <Chip size="small" label="FR-3.1.2" /> Finality + inclusion / proof bundle
                  </TableCell>
                  <TableCell>
                    Relayer pipeline (see job status in same panel). Reference impl uses merkle-inclusion + confirmations;
                    SNARK statement from blueprint §3.3 is future work.
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>C</TableCell>
                  <TableCell>
                    <Chip size="small" label="FR-3.1.3" /> Mint / release on destination
                  </TableCell>
                  <TableCell>
                    Connect <Jump id="panel-midnight-deploy">Midnight</Jump>; deploy or join Compact contract; run{' '}
                    <Jump id="panel-circuits">proveHolder</Jump> then <strong>mintWrappedUnshielded</strong>. Watch{' '}
                    <Jump id="panel-bridge-state">On-chain bridge state</Jump>.
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>D</TableCell>
                  <TableCell>
                    <Chip size="small" label="FR-3.1.4" /> Burn on destination
                  </TableCell>
                  <TableCell>
                    <Jump id="panel-circuits">initiateBurn</Jump> / finalize flow per contract state; or EVM wrapped burn +
                    <strong> BURN</strong> intent in <Jump id="panel-cross-chain-intent">Cross-chain intents</Jump>.
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>E</TableCell>
                  <TableCell>
                    <Chip size="small" label="FR-3.1.5" /> Unlock on source
                  </TableCell>
                  <TableCell>
                    Relayer <code>unlockWithInclusionProof</code> path on EVM pool when configured; intent type BURN in UI.
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>F</TableCell>
                  <TableCell>
                    <Chip size="small" label="FR-3.2.1" /> Pooled liquidity
                  </TableCell>
                  <TableCell>
                    Separate USDC/USDT pools per chain in design; reference contracts include pool lock + vault scaffolding
                    (see repo <code>evm/</code>).
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </AccordionDetails>
        </Accordion>

        <Accordion>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Typography fontWeight={600}>5. Non-functional targets (SRS §4.1 — informational)</Typography>
          </AccordionSummary>
          <AccordionDetails>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Metric</TableCell>
                  <TableCell>Target (per SRS)</TableCell>
                  <TableCell>Notes</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                <TableRow>
                  <TableCell>Lock → mint latency</TableCell>
                  <TableCell>EVM ~30 min · Cardano ~8 h · Midnight ~15 min (±20%)</TableCell>
                  <TableCell>Not validated in dev; local finality is immediate.</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>Burn → unlock latency</TableCell>
                  <TableCell>Same order of magnitude per chain</TableCell>
                  <TableCell>Watch relayer job phases in UI when wired.</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>Throughput</TableCell>
                  <TableCell>Peak 10 ops/min; ~1 proof/min</TableCell>
                  <TableCell>Stress testing not in this demo.</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </AccordionDetails>
        </Accordion>

        <Accordion>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Typography fontWeight={600}>6. Blueprint component checklist</Typography>
          </AccordionSummary>
          <AccordionDetails>
            <Box component="ul" sx={{ pl: 2 }}>
              <Typography component="li" variant="body2">
                <strong>Source contracts</strong>: lock, verifiable events, nonce replay protection
              </Typography>
              <Typography component="li" variant="body2">
                <strong>Relayer</strong>: monitor events, finality rules, proof generation / submission
              </Typography>
              <Typography component="li" variant="body2">
                <strong>ZK circuits</strong>: header finality, event inclusion, optional privacy predicates (§3.3)
              </Typography>
              <Typography component="li" variant="body2">
                <strong>Destination contracts</strong>: verify proofs, mint/release, state machine
              </Typography>
              <Typography component="li" variant="body2">
                <strong>SDK surface</strong> (illustrative): <code>lock</code>, <code>burn</code>, <code>getStatus</code>,{' '}
                <code>estimateFee</code>, <code>subscribeEvents</code> — see repo <code>sdk/</code>
              </Typography>
            </Box>
          </AccordionDetails>
        </Accordion>

        <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 2 }}>
          Document references: Software Requirements Specification (ZK-Stables USDC/USDT Non-Custodial Bridge); Architectural
          Planning – Feasibility Report & System Architecture Blueprint.
        </Typography>
      </CardContent>
    </Card>
  );
};
