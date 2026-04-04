import type { Logger } from 'pino';
import type { Context } from 'hono';
import { blockfrostAddressUtxos } from '../adapters/cardanoBlockfrost.js';
import { blockfrostNetwork, blockfrostProjectId, cardanoIndexerMode, resolveYaciBaseUrl } from '../adapters/cardanoIndexer.js';
import { yaciAddressUtxos } from '../adapters/cardanoYaci.js';
import { ensureCardanoBridgeWallet } from '../adapters/cardanoPayout.js';
import { loadBlueprint } from '../adapters/cardanoAiken/blueprint.js';
import { getLockPoolScript } from '../adapters/cardanoAiken/scripts.js';
import { relayerBridgeSnapshot } from '../config/bridgeRecipients.js';
import { isRelayerCardanoOperatorConsoleTxEnabled } from '../adapters/cardanoOperatorConsoleTx.js';
import { isRelayerEvmOperatorConsoleTxEnabled } from '../adapters/evmOperatorConsoleTx.js';
import {
  isRelayerMidnightOperatorConsoleTxEnabled,
  isRelayerOperatorConsoleAllEnabled,
} from '../adapters/midnightOperatorConsoleTx.js';
import { listJobs } from '../store.js';
import type { BurnIntent, LockIntent, RelayerJob } from '../types.js';

type SerializedUtxo = {
  ref: string;
  txHash: string;
  outputIndex: number;
  amount: Array<{ unit: string; quantity: string }>;
};

function aggregateAmounts(rows: SerializedUtxo[]): Record<string, string> {
  const m = new Map<string, bigint>();
  for (const r of rows) {
    for (const a of r.amount) {
      m.set(a.unit, (m.get(a.unit) ?? 0n) + BigInt(a.quantity));
    }
  }
  return Object.fromEntries([...m.entries()].map(([k, v]) => [k, v.toString()]));
}

async function meshOperatorWallet(logger: Logger): Promise<{
  changeAddress: string;
  utxos: SerializedUtxo[];
  balancesByUnit: Record<string, string>;
} | null> {
  const ctx = await ensureCardanoBridgeWallet(logger);
  if (!ctx) return null;
  const change = ctx.wallet.getChangeAddress();
  if (!change?.trim()) return null;
  const utxos = await ctx.wallet.getUtxos();
  const rows: SerializedUtxo[] = utxos.map((u) => ({
    ref: `${u.input.txHash}#${u.input.outputIndex}`,
    txHash: u.input.txHash,
    outputIndex: u.input.outputIndex,
    amount: u.output.amount.map((a) => ({ unit: a.unit, quantity: String(a.quantity) })),
  }));
  return { changeAddress: change, utxos: rows, balancesByUnit: aggregateAmounts(rows) };
}

async function lockScriptUtxosAtAddress(
  logger: Logger,
  scriptAddr: string,
): Promise<{ utxos: SerializedUtxo[]; balancesByUnit: Record<string, string>; provider: string } | null> {
  const mode = cardanoIndexerMode();
  const yaci = resolveYaciBaseUrl();
  const bfId = blockfrostProjectId();
  const bfNet = blockfrostNetwork();
  try {
    if (mode === 'yaci' && yaci) {
      const raw = await yaciAddressUtxos(yaci, scriptAddr);
      const utxos: SerializedUtxo[] = raw.map((u) => ({
        ref: `${u.tx_hash}#${u.output_index}`,
        txHash: u.tx_hash,
        outputIndex: u.output_index,
        amount: u.amount.map((a) => ({ unit: a.unit, quantity: String(a.quantity) })),
      }));
      return { utxos, balancesByUnit: aggregateAmounts(utxos), provider: 'yaci' };
    }
    if (bfId) {
      const raw = await blockfrostAddressUtxos(bfId, bfNet, scriptAddr);
      const utxos: SerializedUtxo[] = raw.map((u) => ({
        ref: `${u.tx_hash}#${u.output_index}`,
        txHash: u.tx_hash,
        outputIndex: u.output_index,
        amount: u.amount.map((a) => ({ unit: a.unit, quantity: String(a.quantity) })),
      }));
      return { utxos, balancesByUnit: aggregateAmounts(utxos), provider: 'blockfrost' };
    }
  } catch (e) {
    logger.warn({ err: e, scriptAddr }, 'bridgeConsoleState: lock script UTxO fetch failed');
    return null;
  }
  return null;
}

function jobEvmLockAnchor(j: RelayerJob): {
  jobId: string;
  txHash: string;
  logIndex: number;
  blockNumber?: string;
  poolLockAddress?: string;
  token?: string;
  nonce?: string;
  asset: string;
  amount: string;
  destinationChain?: string;
  createdAt: string;
  phase: string;
} | null {
  const intent = j.intent as LockIntent;
  if (intent.operation !== 'LOCK' || intent.sourceChain !== 'evm') return null;
  const ev = intent.source?.evm;
  if (!ev?.txHash || ev.logIndex === undefined) return null;
  return {
    jobId: j.id,
    txHash: String(ev.txHash).toLowerCase(),
    logIndex: Number(ev.logIndex),
    ...(ev.blockNumber ? { blockNumber: String(ev.blockNumber) } : {}),
    ...(ev.poolLockAddress ? { poolLockAddress: ev.poolLockAddress } : {}),
    ...(ev.token ? { token: ev.token } : {}),
    ...(ev.nonce ? { nonce: ev.nonce } : {}),
    asset: intent.asset,
    amount: intent.amount,
    destinationChain: intent.destinationChain,
    createdAt: j.createdAt,
    phase: j.phase,
  };
}

function jobCardanoBurnHint(j: RelayerJob): {
  jobId: string;
  asset: string;
  amount: string;
  recipient: string;
  burnCommitmentHex: string;
  cardano: NonNullable<BurnIntent['source']>['cardano'];
  createdAt: string;
  phase: string;
} | null {
  const intent = j.intent as BurnIntent;
  if (intent.operation !== 'BURN' || intent.sourceChain !== 'cardano') return null;
  const c = intent.source?.cardano;
  if (!c?.txHash || c.outputIndex === undefined || !intent.burnCommitmentHex) return null;
  return {
    jobId: j.id,
    asset: intent.asset,
    amount: intent.amount,
    recipient: intent.recipient,
    burnCommitmentHex: intent.burnCommitmentHex.replace(/^0x/i, ''),
    cardano: { ...c },
    createdAt: j.createdAt,
    phase: j.phase,
  };
}

function jobMidnightBurnHint(j: RelayerJob): {
  jobId: string;
  asset: string;
  amount: string;
  recipient: string;
  burnCommitmentHex: string;
  midnight: NonNullable<BurnIntent['source']>['midnight'];
  createdAt: string;
  phase: string;
} | null {
  const intent = j.intent as BurnIntent;
  if (intent.operation !== 'BURN' || intent.sourceChain !== 'midnight') return null;
  const m = intent.source?.midnight;
  if (!m?.txId?.trim() || !m.depositCommitmentHex) return null;
  return {
    jobId: j.id,
    asset: intent.asset,
    amount: intent.amount,
    recipient: intent.recipient,
    burnCommitmentHex: intent.burnCommitmentHex.replace(/^0x/i, ''),
    midnight: { ...m },
    createdAt: j.createdAt,
    phase: j.phase,
  };
}

function jobEvmBurnHint(j: RelayerJob): {
  jobId: string;
  asset: string;
  amount: string;
  recipient: string;
  burnCommitmentHex: string;
  evm: NonNullable<BurnIntent['source']>['evm'];
  createdAt: string;
  phase: string;
} | null {
  const intent = j.intent as BurnIntent;
  if (intent.operation !== 'BURN' || intent.sourceChain !== 'evm') return null;
  const e = intent.source?.evm;
  if (!e?.txHash || e.logIndex === undefined || !intent.burnCommitmentHex) return null;
  return {
    jobId: j.id,
    asset: intent.asset,
    amount: intent.amount,
    recipient: intent.recipient,
    burnCommitmentHex: intent.burnCommitmentHex.replace(/^0x/i, ''),
    evm: { ...e },
    createdAt: j.createdAt,
    phase: j.phase,
  };
}

/** Single payload for bridge-operator-console: selectors only, no free-text chain fields. */
export async function handleBridgeConsoleState(c: Context, logger: Logger) {
  const recipients = relayerBridgeSnapshot();
  const jobs = listJobs().slice(0, 120);

  const evmLockAnchors = jobs.map(jobEvmLockAnchor).filter(Boolean) as NonNullable<ReturnType<typeof jobEvmLockAnchor>>[];
  const cardanoBurnHints = jobs.map(jobCardanoBurnHint).filter(Boolean) as NonNullable<ReturnType<typeof jobCardanoBurnHint>>[];
  const midnightBurnHints = jobs.map(jobMidnightBurnHint).filter(Boolean) as NonNullable<ReturnType<typeof jobMidnightBurnHint>>[];
  const evmBurnHints = jobs.map(jobEvmBurnHint).filter(Boolean) as NonNullable<ReturnType<typeof jobEvmBurnHint>>[];

  let lockScriptAddress: string | undefined;
  let lockScriptUtxos: SerializedUtxo[] = [];
  let lockScriptBalancesByUnit: Record<string, string> = {};
  let lockScriptProvider: string | undefined;
  try {
    const networkId = Number(process.env.RELAYER_CARDANO_NETWORK_ID ?? process.env.CARDANO_NETWORK_ID ?? 0) === 1 ? 1 : 0;
    const bp = loadBlueprint();
    const { address } = getLockPoolScript(bp, networkId);
    lockScriptAddress = address;
    const pack = await lockScriptUtxosAtAddress(logger, address);
    if (pack) {
      lockScriptUtxos = pack.utxos;
      lockScriptBalancesByUnit = pack.balancesByUnit;
      lockScriptProvider = pack.provider;
    }
  } catch (e) {
    logger.debug({ err: e }, 'bridgeConsoleState: lock script metadata skipped');
  }

  const operatorWallet = await meshOperatorWallet(logger);

  return c.json({
    recipients,
    amountPresets: ['0.01', '0.05', '0.1', '1'],
    evmOperatorConsoleTx: isRelayerEvmOperatorConsoleTxEnabled(),
    cardanoOperatorConsoleTx: isRelayerCardanoOperatorConsoleTxEnabled(),
    midnightOperatorConsoleTx: isRelayerMidnightOperatorConsoleTxEnabled(),
    operatorConsoleAll: isRelayerOperatorConsoleAllEnabled(),
    cardano: {
      operatorWallet,
      lockScriptAddress,
      lockScriptUtxos,
      lockScriptBalancesByUnit,
      lockScriptProvider: lockScriptProvider ?? null,
    },
    anchors: {
      evmLockAnchors,
      cardanoBurnHints,
      midnightBurnHints,
      evmBurnHints,
    },
  });
}
