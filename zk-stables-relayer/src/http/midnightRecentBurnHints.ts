/**
 * Operator console: list zk-stables-registry ledger deposits that can anchor a Midnight → EVM BURN
 * (same indexer path as preflight; no wallet).
 */
import { Buffer } from 'node:buffer';
import type { Context } from 'hono';
import type { Logger } from 'pino';
import { ContractState as MidnightOnchainContractState } from '@midnight-ntwrk/compact-runtime';
import { getPublicStates } from '@midnight-ntwrk/midnight-js-contracts';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import type { ContractState as LedgerWasmContractState } from '@midnight-ntwrk/ledger-v8';
import { ZkStablesRegistry } from '@zk-stables/midnight-contract';
import { formatTokenUnitsToDecimal, parseDecimalAmountToUnits } from '../adapters/amount.js';
import { relayerBridgeSnapshot } from '../config/bridgeRecipients.js';
import { getMidnightContractAddress } from '../midnight/service.js';
import { RelayerMidnightConfig } from '../midnight/config.js';
import { listJobs } from '../store.js';
import type { BurnIntent } from '../types.js';

const REGISTRY_BURNED = 3;
const ACTIVE = 1;
const EXIT_PENDING = 2;

function u8ToHex32(b: Uint8Array): string {
  return Buffer.from(b).toString('hex').toLowerCase();
}

function midnightTxIdFromJobs(depositHex: string): string | undefined {
  const want = depositHex.toLowerCase();
  for (const j of listJobs()) {
    const intent = j.intent as BurnIntent;
    if (intent.operation !== 'BURN' || intent.sourceChain !== 'midnight') continue;
    const d = intent.source?.midnight?.depositCommitmentHex?.replace(/^0x/i, '').toLowerCase();
    if (d !== want) continue;
    const tid = intent.source?.midnight?.txId?.trim() || intent.source?.midnight?.txHash?.trim();
    if (tid) return tid;
  }
  return undefined;
}

export type MidnightBurnHintRow = {
  jobId: string;
  asset: 'USDC' | 'USDT';
  amount: string;
  recipient: string;
  burnCommitmentHex: string;
  midnight: NonNullable<BurnIntent['source']>['midnight'];
  createdAt: string;
  phase: string;
};

export async function collectMidnightBurnHintsForAssetAmount(
  logger: Logger,
  asset: 'USDC' | 'USDT',
  amountStr: string,
): Promise<{
  hints: MidnightBurnHintRow[];
  contractAddress: string | null;
  scanNote?: string;
  want: { asset: 'USDC' | 'USDT'; amount: string };
}> {
  const want = { asset, amount: amountStr };
  const decimals = Number(process.env.RELAYER_CARDANO_ASSET_DECIMALS ?? 6);
  let wantUnits: bigint;
  try {
    wantUnits = parseDecimalAmountToUnits(amountStr, decimals);
  } catch (e) {
    return {
      hints: [],
      contractAddress: null,
      scanNote: e instanceof Error ? e.message : 'invalid amount',
      want,
    };
  }
  const wantAssetKind = asset === 'USDT' ? 1 : 0;

  const contractAddress = (await getMidnightContractAddress())?.trim().toLowerCase() ?? null;
  if (!contractAddress) {
    return {
      hints: [],
      contractAddress: null,
      scanNote: 'Midnight registry contract address not known (deploy / set RELAYER_MIDNIGHT_CONTRACT_ADDRESS).',
      want,
    };
  }

  const cfg = new RelayerMidnightConfig();
  const indexerHttp = (process.env.RELAYER_MIDNIGHT_INDEXER_URL ?? cfg.indexer).trim();
  const indexerWs = cfg.indexerWS.trim();
  const pdp = indexerPublicDataProvider(indexerHttp, indexerWs);

  let contractState: unknown;
  try {
    ({ contractState } = await getPublicStates(pdp, contractAddress));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.warn({ err: e }, 'midnightRecentBurnHints: getPublicStates failed');
    return {
      hints: [],
      contractAddress,
      scanNote: `Indexer getPublicStates failed: ${msg}`,
      want,
    };
  }

  const wasmState = contractState as LedgerWasmContractState;
  let onchainFull: MidnightOnchainContractState;
  try {
    onchainFull = MidnightOnchainContractState.deserialize(new Uint8Array(wasmState.serialize()));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      hints: [],
      contractAddress,
      scanNote: `Could not deserialize registry state: ${msg}`,
      want,
    };
  }

  let L: ReturnType<typeof ZkStablesRegistry.ledger>;
  try {
    L = ZkStablesRegistry.ledger(onchainFull.data);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      hints: [],
      contractAddress,
      scanNote: `Could not open registry ledger: ${msg}`,
      want,
    };
  }

  const evmRec = relayerBridgeSnapshot().evmRecipient?.trim() ?? '';
  const rows: MidnightBurnHintRow[] = [];

  for (const [depKey, status] of L.depositStatus) {
    const st = Number(status);
    if (st === REGISTRY_BURNED) continue;

    if (!L.depositAmount.member(depKey)) continue;
    const rawAmt = L.depositAmount.lookup(depKey);
    if (rawAmt !== wantUnits) continue;

    if (!L.depositAssetKind.member(depKey)) continue;
    const ak = Number(L.depositAssetKind.lookup(depKey));
    if (ak !== wantAssetKind) continue;

    const depHex = u8ToHex32(depKey);
    if (depHex.length !== 64) continue;

    const minted =
      L.depositMintedUnshielded.member(depKey) && Number(L.depositMintedUnshielded.lookup(depKey)) === 1;
    const recipientComm = L.depositRecipientComm.member(depKey) ? L.depositRecipientComm.lookup(depKey) : null;
    if (!recipientComm) continue;
    const burnHex = u8ToHex32(recipientComm);
    if (burnHex.length !== 64) continue;

    const destChainId = L.depositDestChain.member(depKey) ? Number(L.depositDestChain.lookup(depKey)) : 2;
    const amountDisplay = formatTokenUnitsToDecimal(rawAmt, decimals);

    const baseMidnight: NonNullable<BurnIntent['source']>['midnight'] = {
      depositCommitmentHex: depHex,
      destChainId,
      contractAddress,
    };

    if (st === ACTIVE) {
      if (!minted) continue;
      rows.push({
        jobId: `midnight-ledger-${depHex}`,
        asset,
        amount: amountDisplay,
        recipient: evmRec,
        burnCommitmentHex: burnHex,
        midnight: { ...baseMidnight },
        createdAt: new Date().toISOString(),
        phase: 'registry-active-needs-initiate-burn',
      });
      continue;
    }

    if (st === EXIT_PENDING) {
      const txId = midnightTxIdFromJobs(depHex);
      if (!txId) {
        logger.debug({ dep: depHex.slice(0, 16) }, 'midnightRecentBurnHints: exit-pending deposit without relayer job txId — skipped');
        continue;
      }
      rows.push({
        jobId: `midnight-ledger-${depHex}`,
        asset,
        amount: amountDisplay,
        recipient: evmRec,
        burnCommitmentHex: burnHex,
        midnight: { ...baseMidnight, txId },
        createdAt: new Date().toISOString(),
        phase: 'registry-exit-pending',
      });
    }
  }

  const limit = Math.min(25, Math.max(1, Number(process.env.RELAYER_MIDNIGHT_RECENT_BURN_HINTS_LIMIT ?? 15)));
  const sorted = rows.sort((a, b) => {
    const pa = a.phase.includes('exit-pending') ? 0 : 1;
    const pb = b.phase.includes('exit-pending') ? 0 : 1;
    return pa - pb;
  });
  const out = sorted.slice(0, limit);

  return {
    hints: out,
    contractAddress,
    want,
    scanNote:
      out.length === 0
        ? 'No registry deposit matched this amount and asset with minted unshielded (active) or exit-pending + relayer job txId.'
        : undefined,
  };
}

export async function handleMidnightRecentBurnHints(c: Context, logger: Logger) {
  const assetRaw = (c.req.query('asset') ?? 'USDC').trim().toUpperCase();
  if (assetRaw !== 'USDC' && assetRaw !== 'USDT') {
    return c.json({ error: 'asset must be USDC or USDT' }, 400);
  }
  const asset = assetRaw as 'USDC' | 'USDT';
  const amountStr = (c.req.query('amount') ?? '').trim();
  if (!amountStr) {
    return c.json({ error: 'amount query required (decimal, e.g. 0.05)' }, 400);
  }

  const pack = await collectMidnightBurnHintsForAssetAmount(logger, asset, amountStr);
  return c.json({
    hints: pack.hints,
    count: pack.hints.length,
    contractAddress: pack.contractAddress,
    want: pack.want,
    ...(pack.scanNote ? { scanNote: pack.scanNote } : {}),
  });
}
