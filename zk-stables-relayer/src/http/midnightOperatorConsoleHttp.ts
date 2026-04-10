import { Buffer } from 'node:buffer';
import { createHash, randomBytes } from 'node:crypto';
import type { Context } from 'hono';
import type { Logger } from 'pino';
import { isAddress } from 'viem';
import { ContractState as MidnightOnchainContractState } from '@midnight-ntwrk/compact-runtime';
import { getPublicStates } from '@midnight-ntwrk/midnight-js-contracts';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import type { ContractState as LedgerWasmContractState } from '@midnight-ntwrk/ledger-v8';
import { ZkStablesRegistry } from '@zk-stables/midnight-contract';
import { parseDecimalAmountToUnits } from '../adapters/amount.js';
import { isMidnightRelayerInitEnabled } from '../adapters/midnightOperatorConsoleTx.js';
import {
  mergeRelayerBridgeIntoConnected,
  relayerBridgeEvmRecipient,
} from '../config/bridgeRecipients.js';
import { serializeRelayerJob } from '../jobSerialization.js';
import {
  readMidnightRegistryDepositBurnPreflight,
  submitMidnightInitiateBurnHttp,
  getMidnightContractAddress,
} from '../midnight/service.js';
import { RelayerMidnightConfig } from '../midnight/config.js';
import { enqueueLockIntent } from '../pipeline/runJob.js';
import type { BurnIntent } from '../types.js';

function assetKindN(asset: 'USDC' | 'USDT'): number {
  return asset === 'USDT' ? 1 : 0;
}

function u8ToHex32(b: Uint8Array): string {
  return Buffer.from(b).toString('hex').toLowerCase();
}

const REGISTRY_BURNED = 3;
const ACTIVE = 1;
const EXIT_PENDING = 2;

/**
 * Directly scan the Midnight registry for a deposit matching the given asset+amount,
 * preferring ACTIVE (minted) over EXIT_PENDING. Unlike collectMidnightBurnHintsForAssetAmount,
 * this also accepts EXIT_PENDING deposits so the operator can re-drive stuck redeems.
 */
async function findMidnightDeposit(
  logger: Logger,
  asset: 'USDC' | 'USDT',
  amountStr: string,
): Promise<{
  found: boolean;
  contractAddress: string | null;
  depHex?: string;
  recHex?: string;
  status?: number;
  destChainId?: number;
  error?: string;
}> {
  const decimals = Number(process.env.RELAYER_CARDANO_ASSET_DECIMALS ?? 6);
  let wantUnits: bigint;
  try {
    wantUnits = parseDecimalAmountToUnits(amountStr, decimals);
  } catch (e) {
    return { found: false, contractAddress: null, error: e instanceof Error ? e.message : 'invalid amount' };
  }
  const wantAK = asset === 'USDT' ? 1 : 0;

  const contractAddress = (await getMidnightContractAddress())?.trim().toLowerCase() ?? null;
  if (!contractAddress) {
    return { found: false, contractAddress: null, error: 'RELAYER_MIDNIGHT_CONTRACT_ADDRESS not set' };
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
    return { found: false, contractAddress, error: `Indexer getPublicStates failed: ${msg}` };
  }

  const wasmState = contractState as LedgerWasmContractState;
  let onchainFull: MidnightOnchainContractState;
  try {
    onchainFull = MidnightOnchainContractState.deserialize(new Uint8Array(wasmState.serialize()));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { found: false, contractAddress, error: `Deserialize failed: ${msg}` };
  }

  let L: ReturnType<typeof ZkStablesRegistry.ledger>;
  try {
    L = ZkStablesRegistry.ledger(onchainFull.data);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { found: false, contractAddress, error: `Ledger open failed: ${msg}` };
  }

  type Match = { depHex: string; recHex: string; status: number; destChainId: number };
  const matches: Match[] = [];

  for (const [depKey, status] of L.depositStatus) {
    const st = Number(status);
    if (st === REGISTRY_BURNED) continue;
    if (st !== ACTIVE && st !== EXIT_PENDING) continue;

    if (!L.depositAmount.member(depKey)) continue;
    if (L.depositAmount.lookup(depKey) !== wantUnits) continue;

    if (!L.depositAssetKind.member(depKey)) continue;
    if (Number(L.depositAssetKind.lookup(depKey)) !== wantAK) continue;

    const minted = L.depositMintedUnshielded.member(depKey) && Number(L.depositMintedUnshielded.lookup(depKey)) === 1;
    if (!minted) continue;

    const depHex = u8ToHex32(depKey);
    if (depHex.length !== 64) continue;

    const recipientComm = L.depositRecipientComm.member(depKey) ? L.depositRecipientComm.lookup(depKey) : null;
    if (!recipientComm) continue;
    const recHex = u8ToHex32(recipientComm);
    if (recHex.length !== 64) continue;

    const destChainId = L.depositDestChain.member(depKey) ? Number(L.depositDestChain.lookup(depKey)) : 2;
    matches.push({ depHex, recHex, status: st, destChainId });
  }

  // prefer ACTIVE over EXIT_PENDING
  matches.sort((a, b) => (a.status === ACTIVE ? 0 : 1) - (b.status === ACTIVE ? 0 : 1));
  const best = matches[0];
  if (!best) {
    return { found: false, contractAddress, error: `No registry deposit matched ${asset} ${amountStr} with minted=1 (active or exit-pending). Checked ${matches.length} candidates.` };
  }
  return { found: true, contractAddress, ...best };
}

export async function handlePostMidnightOperatorRedeemToEvm(c: Context, logger: Logger) {
  if (!isMidnightRelayerInitEnabled()) {
    return c.json(
      {
        error:
          'Midnight relayer not initialized. Set RELAYER_MIDNIGHT_ENABLED=true or RELAYER_OPERATOR_CONSOLE_MIDNIGHT_TX / RELAYER_OPERATOR_CONSOLE_ALL with wallet + RELAYER_MIDNIGHT_CONTRACT_ADDRESS.',
      },
      503,
    );
  }
  type Body = { asset?: string; amount?: string; evmPayout?: string };
  let body: Body;
  try {
    body = (await c.req.json()) as Body;
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }
  const assetRaw = String(body.asset ?? 'USDC').trim().toUpperCase();
  if (assetRaw !== 'USDC' && assetRaw !== 'USDT') {
    return c.json({ error: 'asset must be USDC or USDT' }, 400);
  }
  const asset = assetRaw as 'USDC' | 'USDT';
  const amount = String(body.amount ?? '').trim();
  if (!amount) return c.json({ error: 'amount required (decimal string)' }, 400);
  let payoutRaw = String(body.evmPayout ?? '').trim();
  if (!payoutRaw) {
    const pk = process.env.RELAYER_EVM_PRIVATE_KEY?.trim();
    if (pk && /^0x[0-9a-fA-F]{64}$/u.test(pk)) {
      try {
        const { privateKeyToAccount } = await import('viem/accounts');
        payoutRaw = privateKeyToAccount(pk as `0x${string}`).address;
      } catch { /* fall through */ }
    }
  }
  if (!payoutRaw) {
    payoutRaw = relayerBridgeEvmRecipient() ?? '';
  }
  if (!isAddress(payoutRaw)) {
    return c.json({ error: 'evmPayout must be a 0x + 40 hex EVM address (or set RELAYER_EVM_PRIVATE_KEY / RELAYER_BRIDGE_EVM_RECIPIENT)' }, 400);
  }
  const payout = payoutRaw as `0x${string}`;

  const scan = await findMidnightDeposit(logger, asset, amount);
  if (!scan.found || !scan.depHex || !scan.recHex) {
    return c.json(
      {
        error: scan.error ?? 'No matching Midnight registry deposit for this amount and asset.',
        contractAddress: scan.contractAddress,
      },
      400,
    );
  }

  const { depHex, recHex, destChainId, contractAddress: scanContract } = scan;
  let contractAddress = scanContract ?? '';
  let txId = '';
  let txHash = '';

  if (scan.status === ACTIVE) {
    const skipPreflight =
      process.env.RELAYER_MIDNIGHT_INITIATE_BURN_SKIP_PREFLIGHT === '1' ||
      process.env.RELAYER_MIDNIGHT_INITIATE_BURN_SKIP_PREFLIGHT === 'true';
    const depositCommitment = Uint8Array.from(Buffer.from(depHex, 'hex'));
    if (!skipPreflight) {
      const pre = await readMidnightRegistryDepositBurnPreflight(logger, depositCommitment);
      if (!pre.okForInitiateBurn) {
        return c.json({ error: 'deposit_not_ready_for_initiateBurn', preflight: pre }, 409);
      }
    }
    const recipientCommitment = Uint8Array.from(Buffer.from(recHex, 'hex'));
    try {
      const out = await submitMidnightInitiateBurnHttp(logger, {
        depositCommitment,
        destChainId: BigInt(destChainId ?? 2),
        recipientCommitment,
      });
      txId = out.txId;
      txHash = out.txHash;
      contractAddress = out.contractAddress || contractAddress;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.warn({ err: e }, 'POST /v1/midnight/operator/redeem-to-evm: initiateBurn failed');
      return c.json({ error: msg }, 400);
    }
  } else {
    // EXIT_PENDING — initiateBurn already done; generate a synthetic txId so the job can proceed
    const nonce = randomBytes(16).toString('hex');
    txId = createHash('sha256').update(`operator-midnight-exit:${depHex}:${nonce}:${Date.now()}`, 'utf8').digest('hex');
    logger.info(
      { depHex: depHex.slice(0, 16), status: scan.status },
      'POST /v1/midnight/operator/redeem-to-evm: deposit is EXIT_PENDING — skipping initiateBurn, using synthetic txId',
    );
  }

  const burnIntent: BurnIntent = {
    operation: 'BURN',
    sourceChain: 'midnight',
    destinationChain: 'evm',
    asset,
    assetKind: assetKindN(asset),
    amount: amount.trim(),
    recipient: payout,
    burnCommitmentHex: recHex,
    note: 'BURN via POST /v1/midnight/operator/redeem-to-evm',
    source: {
      midnight: {
        txId,
        ...(txHash ? { txHash } : {}),
        destChainId: destChainId ?? 2,
        depositCommitmentHex: depHex,
        ...(contractAddress ? { contractAddress } : {}),
      },
    },
  };
  mergeRelayerBridgeIntoConnected(burnIntent);

  try {
    const job = await enqueueLockIntent(logger, burnIntent);
    if (!job) {
      return c.json({ error: 'duplicate or skipped' }, 409);
    }
    logger.info({ jobId: job.id, asset, amount }, 'POST /v1/midnight/operator/redeem-to-evm: job enqueued');
    return c.json({ jobId: job.id, job: serializeRelayerJob(job) }, 202);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.warn({ err: e }, 'POST /v1/midnight/operator/redeem-to-evm failed');
    return c.json({ error: msg }, 400);
  }
}
