import type { Logger } from 'pino';

/**
 * Phase 3 scaffold: Cardano lock watcher.
 *
 * A real implementation should consume Kupo/Ogmios (preferred) or Blockfrost,
 * parse UTxOs at a known script address, and translate them into canonical
 * BridgeIntentCommitment entries.
 */
export async function runCardanoLockWatcher(logger: Logger): Promise<void> {
  const enabled = String(process.env.RELAYER_CARDANO_WATCHER_ENABLED ?? '').toLowerCase() === 'true';
  if (!enabled) {
    logger.info('cardanoLockWatcher skipped (RELAYER_CARDANO_WATCHER_ENABLED not true)');
    return;
  }

  // Placeholder: we do not yet have a canonical Plutus script address or datum format in this repo.
  const mode = process.env.RELAYER_CARDANO_WATCHER_MODE ?? 'blockfrost';
  logger.warn(
    {
      mode,
      note: 'Cardano watcher is scaffolding only; implement with Kupo/Ogmios or Blockfrost once scripts are finalized.',
    },
    'cardanoLockWatcher not implemented',
  );
}

