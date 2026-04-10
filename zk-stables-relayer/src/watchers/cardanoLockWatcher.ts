import type { Logger } from 'pino';
import {
  blockfrostAddressUtxos,
  blockfrostTx,
  primaryFungibleUnit,
  splitBlockfrostUnit,
} from '../adapters/cardanoBlockfrost.js';
import {
  mergeRelayerBridgeIntoConnected,
  relayerBridgeEvmRecipient,
  relayerBridgeCardanoRecipient,
  relayerBridgeMidnightRecipient,
} from '../config/bridgeRecipients.js';
import { enqueueLockIntent } from '../pipeline/runJob.js';
import type { LockIntent } from '../types.js';
import { cardanoUtxoDedupeKey, isCardanoUtxoInflightOrDone } from '../store.js';
import { cardanoIndexerMode, blockfrostNetwork, blockfrostProjectId, resolveYaciBaseUrl } from '../adapters/cardanoIndexer.js';
import { yaciAddressUtxos, yaciTx } from '../adapters/cardanoYaci.js';
import { tryParseLockDatumFromInlineHex } from './inlineLockDatumParse.js';

/**
 * Poll UTxOs at `RELAYER_CARDANO_LOCK_ADDRESS` via Yaci Store or Blockfrost (Yaci wins when
 * `RELAYER_YACI_URL` / `YACI_URL` is set) and enqueue LOCK intents with `source.cardano`.
 */
export async function runCardanoLockWatcher(logger: Logger): Promise<void> {
  const enabled = String(process.env.RELAYER_CARDANO_WATCHER_ENABLED ?? '').toLowerCase() === 'true';
  if (!enabled) {
    logger.info('cardanoLockWatcher skipped (RELAYER_CARDANO_WATCHER_ENABLED not true)');
    return;
  }

  const address = process.env.RELAYER_CARDANO_LOCK_ADDRESS;
  const mode = cardanoIndexerMode();
  const yaciBase = resolveYaciBaseUrl();
  const bfId = blockfrostProjectId();
  const bfNet = blockfrostNetwork();

  if (!address || mode === 'none') {
    logger.warn(
      { hasAddress: Boolean(address), mode, hasYaci: Boolean(yaciBase), hasBlockfrost: Boolean(bfId) },
      'cardanoLockWatcher: set RELAYER_CARDANO_LOCK_ADDRESS and RELAYER_YACI_URL (or RELAYER_BLOCKFROST_PROJECT_ID)',
    );
    return;
  }

  if (mode === 'yaci' && bfId) {
    logger.info('cardanoLockWatcher: using Yaci Store only for UTxOs (Blockfrost project id ignored for Cardano)');
  }

  const pollMs = Number(process.env.RELAYER_CARDANO_POLL_MS ?? 8000);
  const destChain = process.env.RELAYER_CARDANO_DEST_CHAIN ?? 'midnight';
  const asset = (process.env.RELAYER_CARDANO_DEFAULT_ASSET ?? 'USDC') as 'USDC' | 'USDT';
  const assetKind = Number(process.env.RELAYER_CARDANO_ASSET_KIND ?? 0);
  const recipient = (() => {
    const stub = process.env.RELAYER_CARDANO_RECIPIENT_STUB?.trim();
    if (stub) return stub;
    const dest = destChain.toLowerCase();
    if (dest.includes('evm')) return relayerBridgeEvmRecipient() ?? '';
    if (dest.includes('cardano')) return relayerBridgeCardanoRecipient() ?? '';
    return relayerBridgeMidnightRecipient() ?? '';
  })();

  const preExistingUtxos = new Set<string>();
  let firstTick = true;

  const tick = async () => {
    try {
      const utxos =
        mode === 'yaci'
          ? await yaciAddressUtxos(yaciBase!, address)
          : await blockfrostAddressUtxos(bfId!, bfNet, address);

      if (firstTick) {
        for (const u of utxos) {
          preExistingUtxos.add(cardanoUtxoDedupeKey(u.tx_hash, u.output_index));
        }
        firstTick = false;
        logger.info({ preExisting: preExistingUtxos.size }, 'cardanoLockWatcher: skipping pre-existing UTxOs from before this session');
        return;
      }

      for (const u of utxos) {
        const key = cardanoUtxoDedupeKey(u.tx_hash, u.output_index);
        if (preExistingUtxos.has(key)) continue;
        if (isCardanoUtxoInflightOrDone(key)) continue;

        const tx = mode === 'yaci' ? await yaciTx(yaciBase!, u.tx_hash) : await blockfrostTx(bfId!, bfNet, u.tx_hash);
        const bh = tx.block_height;
        if (bh === undefined) continue;

        const primary = primaryFungibleUnit(u.amount);
        const ada = u.amount.find((a) => a.unit === 'lovelace');
        const split = primary
          ? splitBlockfrostUnit(primary.unit)
          : { policyIdHex: '', assetNameHex: '' };
        const amountFromUtxo = primary?.quantity ?? ada?.quantity ?? '0';
        const parsedDatum = tryParseLockDatumFromInlineHex(u.inline_datum);
        const amountStr = parsedDatum?.amountStr ?? amountFromUtxo;

        const cardanoSource: NonNullable<LockIntent['source']>['cardano'] = {
          txHash: u.tx_hash,
          outputIndex: u.output_index,
          blockHeight: String(bh),
          scriptHash: process.env.RELAYER_CARDANO_LOCK_SCRIPT_HASH,
          policyIdHex: split.policyIdHex || undefined,
          assetNameHex: split.assetNameHex || undefined,
          ...(parsedDatum ? { lockNonce: parsedDatum.lockNonce } : {}),
        };

        const intent = {
          operation: 'LOCK' as const,
          sourceChain: 'cardano' as const,
          destinationChain: destChain,
          asset,
          assetKind,
          amount: amountStr,
          recipient,
          source: {
            cardano: cardanoSource,
          },
          note: JSON.stringify({
            data_hash: u.data_hash ?? null,
            inline_datum_hex_prefix: u.inline_datum?.slice(0, 64) ?? null,
          }),
        };
        mergeRelayerBridgeIntoConnected(intent);
        const job = await enqueueLockIntent(logger, intent);
        if (job) {
          logger.info({ tx_hash: u.tx_hash, output_index: u.output_index, jobId: job.id }, 'cardano lock enqueued');
        }
      }
    } catch (e) {
      logger.error({ err: e }, 'cardanoLockWatcher tick failed');
    }
  };

  await tick();
  setInterval(tick, pollMs);
  logger.info({ pollMs, mode, addressPreview: `${address.slice(0, 24)}…` }, 'cardanoLockWatcher started');
}
