import * as ledger from '@midnight-ntwrk/ledger-v8';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { DEFAULT_CONFIG, levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import type { MidnightProvider, ProofProvider, WalletProvider } from '@midnight-ntwrk/midnight-js-types';
import * as Rx from 'rxjs';
import type { WalletContext } from './wallet.js';
import type { LocalUndeployedConfig } from './config.js';
import type { ZkStablesPrivateState } from '@zk-stables/midnight-contract';
import {
  ZkStables,
  ZkStablesRegistry,
  zkStablesPrivateStateId,
  zkStablesRegistryPrivateStateId,
} from '@zk-stables/midnight-contract';

type ZkStablesCircuitId = keyof ZkStables.ProvableCircuits<any>;
type ZkStablesRegistryCircuitId = keyof ZkStablesRegistry.ProvableCircuits<any>;

const debug = (msg: string, extra?: Record<string, unknown>) => {
  if (process.env.MIDNIGHT_LOCAL_CLI_DEBUG === '1' || process.env.MIDNIGHT_LOCAL_CLI_DEBUG === 'true') {
    // eslint-disable-next-line no-console
    console.error(`[zk-stables-local-cli] ${new Date().toISOString()} ${msg}`, extra ?? '');
  }
};

/** Filled on each `submitTx` so `watchForTxData` can try every segment id (indexer offset may match any). */
export type LastSubmittedTxIdentifiers = { ids: string[] };

const signTransactionIntents = (
  tx: { intents?: Map<number, any> },
  signFn: (payload: Uint8Array) => ledger.Signature,
  proofMarker: 'proof' | 'pre-proof',
): void => {
  if (!tx.intents || tx.intents.size === 0) return;

  for (const segment of tx.intents.keys()) {
    const intent = tx.intents.get(segment);
    if (!intent) continue;

    const cloned = ledger.Intent.deserialize<ledger.SignatureEnabled, ledger.Proofish, ledger.PreBinding>(
      'signature',
      proofMarker,
      'pre-binding',
      intent.serialize(),
    );

    const sigData = cloned.signatureData(segment);
    const signature = signFn(sigData);

    if (cloned.fallibleUnshieldedOffer) {
      const sigs = cloned.fallibleUnshieldedOffer.inputs.map(
        (_: ledger.UtxoSpend, i: number) => cloned.fallibleUnshieldedOffer!.signatures.at(i) ?? signature,
      );
      cloned.fallibleUnshieldedOffer = cloned.fallibleUnshieldedOffer.addSignatures(sigs);
    }

    if (cloned.guaranteedUnshieldedOffer) {
      const sigs = cloned.guaranteedUnshieldedOffer.inputs.map(
        (_: ledger.UtxoSpend, i: number) => cloned.guaranteedUnshieldedOffer!.signatures.at(i) ?? signature,
      );
      cloned.guaranteedUnshieldedOffer = cloned.guaranteedUnshieldedOffer.addSignatures(sigs);
    }

    tx.intents.set(segment, cloned);
  }
};

export const createWalletAndMidnightProvider = async (
  ctx: WalletContext,
  lastSubmitted: LastSubmittedTxIdentifiers,
): Promise<WalletProvider & MidnightProvider> => {
  let latestSynced = await Rx.firstValueFrom(ctx.wallet.state().pipe(Rx.filter((s) => s.isSynced)));
  ctx.wallet.state().pipe(Rx.filter((s) => s.isSynced)).subscribe((s) => {
    latestSynced = s;
  });
  return {
    getCoinPublicKey() {
      return latestSynced.shielded.coinPublicKey.toHexString();
    },
    getEncryptionPublicKey() {
      return latestSynced.shielded.encryptionPublicKey.toHexString();
    },
    async balanceTx(tx, ttl?) {
      const balanceMs = Number.parseInt(process.env.MIDNIGHT_BALANCE_TX_MS ?? '900000', 10);
      debug('balanceTx: start (wallet.balanceUnboundTransaction + finalizeRecipe)', {
        timeoutMs: balanceMs,
      });
      const run = async () => {
        const recipe = await ctx.wallet.balanceUnboundTransaction(
          tx,
          { shieldedSecretKeys: ctx.shieldedSecretKeys, dustSecretKey: ctx.dustSecretKey },
          { ttl: ttl ?? new Date(Date.now() + 30 * 60 * 1000) },
        );

        const signFn = (payload: Uint8Array) => ctx.unshieldedKeystore.signData(payload);
        signTransactionIntents(recipe.baseTransaction, signFn, 'proof');
        if (recipe.balancingTransaction) {
          signTransactionIntents(recipe.balancingTransaction, signFn, 'pre-proof');
        }

        return ctx.wallet.finalizeRecipe(recipe);
      };
      try {
        const out = await Promise.race([
          run(),
          new Promise<never>((_, rej) => {
            setTimeout(() => {
              rej(
                new Error(
                  `balanceTx: timed out after ${balanceMs}ms (dust/shielded fee balancing). Try more DUST, or set MIDNIGHT_LOCAL_CLI_DEBUG=1 to see prior phases.`,
                ),
              );
            }, balanceMs);
          }),
        ]);
        debug('balanceTx: done');
        return out;
      } catch (e) {
        debug('balanceTx: error', { err: String(e) });
        throw e;
      }
    },
    /**
     * midnight-js `submitTx` passes the return value to `watchForTxData(txId)`. The indexer keys
     * `transactions(offset: { identifier })` by segment id; multi-intent txs expose several ids and the
     * correct one is not always `identifiers()[0]` vs `at(-1)`. We return the first id for API compatibility
     * and store all ids on `lastSubmitted` so {@link wrapIndexerWatchForTxData} can try each.
     */
    async submitTx(tx) {
      debug('submitTx: calling wallet.submitTransaction');
      await ctx.wallet.submitTransaction(tx);
      const ids = tx.identifiers().map((id) => id.toLowerCase());
      lastSubmitted.ids = [...ids];
      const head = ids[0];
      if (head === undefined) {
        throw new Error('Submitted transaction has no identifiers');
      }
      debug('submitTx: done', { segmentCount: ids.length, firstIdPrefix: head.slice(0, 24) });
      return head;
    },
  };
};

/** Per-id timeout so a wrong offset cannot hang `watchForTxData` forever (see midnight-js `submitTx` docs). */
function wrapIndexerWatchForTxData(
  base: ReturnType<typeof indexerPublicDataProvider>,
  lastSubmitted: LastSubmittedTxIdentifiers,
): ReturnType<typeof indexerPublicDataProvider> {
  const perIdMs = Number.parseInt(process.env.MIDNIGHT_WATCH_TX_PER_ID_MS ?? '180000', 10);
  return {
    ...base,
    async watchForTxData(txId: string) {
      const normalized = txId.toLowerCase();
      const ordered = lastSubmitted.ids.length > 0 ? lastSubmitted.ids : [normalized];
      const candidates = [...new Set([ordered[0], ordered[ordered.length - 1], ...ordered])];
      debug('watchForTxData: trying segment ids', { count: candidates.length, perIdMs });
      let lastErr: unknown;
      for (const id of candidates) {
        try {
          debug('watchForTxData: attempt', { idPrefix: id.slice(0, 24) });
          return await Promise.race([
            base.watchForTxData(id),
            new Promise<never>((_, rej) => {
              setTimeout(() => {
                rej(new Error(`watchForTxData: no indexer match within ${perIdMs}ms for identifier ${id}`));
              }, perIdMs);
            }),
          ]);
        } catch (e) {
          lastErr = e;
          debug('watchForTxData: attempt failed', { err: String(e) });
        }
      }
      throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
    },
  };
}

function wrapProofProvider(base: ProofProvider): ProofProvider {
  return {
    async proveTx(unprovenTx, partialProveTxConfig) {
      debug('proveTx: start (may take minutes on large circuits)');
      try {
        const out = await base.proveTx(unprovenTx, partialProveTxConfig);
        debug('proveTx: done');
        return out;
      } catch (e) {
        debug('proveTx: error', { err: String(e) });
        throw e;
      }
    },
  };
}

function ldbPassword(): string {
  const p = process.env.MIDNIGHT_LDB_PASSWORD;
  if (p && p.length >= 16) return p;
  // LevelDB encryption: ≥16 chars and ≥3 character classes (see midnight-js-level-private-state-provider).
  return 'ZkStables-local-dev-1';
}

/**
 * Midnight-js provider bundle for one Compact contract: correct ZK artifact dir + private-state store.
 * Circuit names can overlap across contracts (e.g. `proveHolder` on zk-stables vs registry); each deployment
 * must use the `NodeZkConfigProvider` for **its** managed folder — do not merge dirs.
 *
 * Pattern matches [example-counter `api.ts`](https://github.com/midnightntwrk/example-counter) (indexer + proof +
 * `NodeZkConfigProvider` + `levelPrivateStateProvider` + wallet `balanceTx` / `submitTx`).
 */
export async function configureMidnightContractProviders<
  PrivateStateId extends string,
  CircuitId extends string,
>(
  ctx: WalletContext,
  config: Pick<LocalUndeployedConfig, 'indexer' | 'indexerWS' | 'proofServer'>,
  options: {
    artifactsDir: string;
    privateStateStoreName: string;
    privateStateId: PrivateStateId;
  },
) {
  const lastSubmitted: LastSubmittedTxIdentifiers = { ids: [] };
  const walletAndMidnightProvider = await createWalletAndMidnightProvider(ctx, lastSubmitted);
  const zkConfigProvider = new NodeZkConfigProvider<CircuitId>(options.artifactsDir);
  const basePublicDataProvider = indexerPublicDataProvider(config.indexer, config.indexerWS);
  return {
    privateStateProvider: levelPrivateStateProvider<PrivateStateId>({
      ...DEFAULT_CONFIG,
      privateStateStoreName: options.privateStateStoreName,
      privateStoragePasswordProvider: async () => ldbPassword(),
      accountId: walletAndMidnightProvider.getCoinPublicKey(),
    }),
    publicDataProvider: wrapIndexerWatchForTxData(basePublicDataProvider, lastSubmitted),
    zkConfigProvider,
    proofProvider: wrapProofProvider(httpClientProofProvider(config.proofServer, zkConfigProvider)),
    walletProvider: walletAndMidnightProvider,
    midnightProvider: walletAndMidnightProvider,
  };
}

export async function configureZkStablesProviders(ctx: WalletContext, config: LocalUndeployedConfig) {
  return configureMidnightContractProviders<typeof zkStablesPrivateStateId, ZkStablesCircuitId>(ctx, config, {
    artifactsDir: config.zkStablesArtifactsDir,
    privateStateStoreName: config.privateStateStoreName,
    privateStateId: zkStablesPrivateStateId,
  });
}

export async function configureZkStablesRegistryProviders(ctx: WalletContext, config: LocalUndeployedConfig) {
  return configureMidnightContractProviders<typeof zkStablesRegistryPrivateStateId, ZkStablesRegistryCircuitId>(
    ctx,
    config,
    {
      artifactsDir: config.zkStablesRegistryArtifactsDir,
      privateStateStoreName: config.registryPrivateStateStoreName,
      privateStateId: zkStablesRegistryPrivateStateId,
    },
  );
}

export type { ZkStablesPrivateState };
