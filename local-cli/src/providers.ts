import * as ledger from '@midnight-ntwrk/ledger-v8';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { DEFAULT_CONFIG, levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import type { MidnightProvider, WalletProvider } from '@midnight-ntwrk/midnight-js-types';
import * as Rx from 'rxjs';
import type { WalletContext } from './wallet.js';
import type { LocalUndeployedConfig } from './config.js';
import type { ZkStablesPrivateState } from '@zk-stables/midnight-contract';
import { zkStablesPrivateStateId, ZkStables } from '@zk-stables/midnight-contract';

type ZkStablesCircuitId = keyof ZkStables.ProvableCircuits<any>;

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
): Promise<WalletProvider & MidnightProvider> => {
  const state = await Rx.firstValueFrom(ctx.wallet.state().pipe(Rx.filter((s) => s.isSynced)));
  return {
    getCoinPublicKey() {
      return state.shielded.coinPublicKey.toHexString();
    },
    getEncryptionPublicKey() {
      return state.shielded.encryptionPublicKey.toHexString();
    },
    async balanceTx(tx, ttl?) {
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
    },
    submitTx(tx) {
      return ctx.wallet.submitTransaction(tx) as any;
    },
  };
};

function ldbPassword(): string {
  const p = process.env.MIDNIGHT_LDB_PASSWORD;
  if (p && p.length >= 16) return p;
  // LevelDB encryption: ≥16 chars and ≥3 character classes (see midnight-js-level-private-state-provider).
  return 'ZkStables-local-dev-1';
}

export async function configureZkStablesProviders(ctx: WalletContext, config: LocalUndeployedConfig) {
  const walletAndMidnightProvider = await createWalletAndMidnightProvider(ctx);
  const zkConfigProvider = new NodeZkConfigProvider<ZkStablesCircuitId>(config.zkStablesArtifactsDir);
  return {
    privateStateProvider: levelPrivateStateProvider<typeof zkStablesPrivateStateId>({
      ...DEFAULT_CONFIG,
      privateStateStoreName: config.privateStateStoreName,
      privateStoragePasswordProvider: async () => ldbPassword(),
      accountId: walletAndMidnightProvider.getCoinPublicKey(),
    }),
    publicDataProvider: indexerPublicDataProvider(config.indexer, config.indexerWS),
    zkConfigProvider,
    proofProvider: httpClientProofProvider(config.proofServer, zkConfigProvider),
    walletProvider: walletAndMidnightProvider,
    midnightProvider: walletAndMidnightProvider,
  };
}

export type { ZkStablesPrivateState };
