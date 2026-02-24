/**
 * Wallet bootstrap (same as local-cli) for relayer-side Midnight operations.
 */
import * as ledger from '@midnight-ntwrk/ledger-v8';
import type { DefaultDustConfiguration as DustConfiguration } from '@midnight-ntwrk/wallet-sdk-dust-wallet';
import { DustWallet } from '@midnight-ntwrk/wallet-sdk-dust-wallet';
import { WalletFacade } from '@midnight-ntwrk/wallet-sdk-facade';
import { HDWallet, Roles } from '@midnight-ntwrk/wallet-sdk-hd';
import { ShieldedWallet } from '@midnight-ntwrk/wallet-sdk-shielded';
import type { DefaultShieldedConfiguration as ShieldedConfiguration } from '@midnight-ntwrk/wallet-sdk-shielded';
import {
  createKeystore,
  InMemoryTransactionHistoryStorage,
  PublicKey as UnshieldedPublicKey,
  type UnshieldedKeystore,
  UnshieldedWallet,
  type DefaultUnshieldedConfiguration,
} from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';
import { Buffer } from 'buffer';

const INDEXER_PORT = Number.parseInt(process.env.INDEXER_PORT ?? '8088', 10);
const NODE_PORT = Number.parseInt(process.env.NODE_PORT ?? '9944', 10);
const PROOF_SERVER_PORT = Number.parseInt(process.env.PROOF_SERVER_PORT ?? '6300', 10);

const INDEXER_HTTP_URL = `http://127.0.0.1:${INDEXER_PORT}/api/v4/graphql`;
const INDEXER_WS_URL = `ws://127.0.0.1:${INDEXER_PORT}/api/v4/graphql/ws`;

const baseConfiguration: ShieldedConfiguration & DustConfiguration = {
  networkId: 'undeployed',
  costParameters: {
    additionalFeeOverhead: 300_000_000_000_000_000n,
    feeBlocksMargin: 5,
  },
  indexerClientConnection: {
    indexerHttpUrl: INDEXER_HTTP_URL,
    indexerWsUrl: INDEXER_WS_URL,
  },
};

export type WalletContext = {
  wallet: WalletFacade;
  shieldedSecretKeys: ledger.ZswapSecretKeys;
  dustSecretKey: ledger.DustSecretKey;
  unshieldedKeystore: UnshieldedKeystore;
};

export async function initWalletWithSeed(seed: Buffer): Promise<WalletContext> {
  const hdWallet = HDWallet.fromSeed(Uint8Array.from(seed));

  if (hdWallet.type !== 'seedOk') {
    throw new Error('Failed to initialize HDWallet');
  }

  const derivationResult = hdWallet.hdWallet
    .selectAccount(0)
    .selectRoles([Roles.Zswap, Roles.NightExternal, Roles.Dust])
    .deriveKeysAt(0);

  if (derivationResult.type !== 'keysDerived') {
    throw new Error('Failed to derive keys');
  }

  hdWallet.hdWallet.clear();

  const shieldedSecretKeys = ledger.ZswapSecretKeys.fromSeed(derivationResult.keys[Roles.Zswap]);
  const dustSecretKey = ledger.DustSecretKey.fromSeed(derivationResult.keys[Roles.Dust]);
  const unshieldedKeystore = createKeystore(derivationResult.keys[Roles.NightExternal], baseConfiguration.networkId);

  const shieldedWallet = ShieldedWallet(baseConfiguration).startWithSecretKeys(shieldedSecretKeys);
  const dustWallet = DustWallet(baseConfiguration).startWithSecretKey(
    dustSecretKey,
    ledger.LedgerParameters.initialParameters().dust,
  );
  const unshieldedConfiguration: DefaultUnshieldedConfiguration = {
    ...baseConfiguration,
    txHistoryStorage: new InMemoryTransactionHistoryStorage(),
  };
  const unshieldedWallet = UnshieldedWallet(unshieldedConfiguration).startWithPublicKey(
    UnshieldedPublicKey.fromKeyStore(unshieldedKeystore),
  );

  const facade: WalletFacade = await WalletFacade.init({
    configuration: {
      ...baseConfiguration,
      relayURL: new URL(`ws://127.0.0.1:${NODE_PORT}`),
      provingServerUrl: new URL(`http://127.0.0.1:${PROOF_SERVER_PORT}`),
      txHistoryStorage: new InMemoryTransactionHistoryStorage(),
    },
    shielded: async () => shieldedWallet,
    unshielded: async () => unshieldedWallet,
    dust: async () => dustWallet,
  });
  await facade.start(shieldedSecretKeys, dustSecretKey);
  return { wallet: facade, shieldedSecretKeys, dustSecretKey, unshieldedKeystore };
}
