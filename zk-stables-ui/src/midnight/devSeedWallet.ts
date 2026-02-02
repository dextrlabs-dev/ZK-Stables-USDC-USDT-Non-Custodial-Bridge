import * as ledger from '@midnight-ntwrk/ledger-v8';
import { WalletFacade } from '@midnight-ntwrk/wallet-sdk-facade';
import { HDWallet, Roles } from '@midnight-ntwrk/wallet-sdk-hd';
import { DustWallet } from '@midnight-ntwrk/wallet-sdk-dust-wallet';
import { ShieldedWallet } from '@midnight-ntwrk/wallet-sdk-shielded';
import {
  createKeystore,
  InMemoryTransactionHistoryStorage,
  PublicKey as UnshieldedPublicKey,
  UnshieldedWallet,
  type UnshieldedKeystore,
  type DefaultUnshieldedConfiguration,
} from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';
import { hexToUint8Array } from '../utils/hex.js';

export type DevSeedWalletContext = {
  wallet: WalletFacade;
  shieldedSecretKeys: ledger.ZswapSecretKeys;
  dustSecretKey: ledger.DustSecretKey;
  unshieldedKeystore: UnshieldedKeystore;
  unshieldedAddress: string;
  networkId: string;
};

/**
 * Initialize an in-app wallet from a 32-byte seed hash (hex).
 * This bypasses Lace completely and is intended ONLY for local `undeployed` dev networks.
 */
export async function initDevWalletFromSeedHash(params: {
  seedHashHex: string;
  networkId: 'undeployed';
  indexerHttpUrl: string;
  indexerWsUrl: string;
  nodeWsUrl: string;
  provingServerUrl: string;
}): Promise<DevSeedWalletContext> {
  const seedBytes = hexToUint8Array(params.seedHashHex);
  if (seedBytes.length !== 32) throw new Error('seed hash must be 32 bytes (64 hex)');

  const hdWallet = HDWallet.fromSeed(Uint8Array.from(seedBytes));
  if (hdWallet.type !== 'seedOk') throw new Error('Failed to initialize HDWallet');

  const derivationResult = hdWallet.hdWallet
    .selectAccount(0)
    .selectRoles([Roles.Zswap, Roles.NightExternal, Roles.Dust])
    .deriveKeysAt(0);
  if (derivationResult.type !== 'keysDerived') throw new Error('Failed to derive keys');
  hdWallet.hdWallet.clear();

  const shieldedSecretKeys = ledger.ZswapSecretKeys.fromSeed(derivationResult.keys[Roles.Zswap]);
  const dustSecretKey = ledger.DustSecretKey.fromSeed(derivationResult.keys[Roles.Dust]);
  const unshieldedKeystore = createKeystore(derivationResult.keys[Roles.NightExternal], params.networkId);
  const unshieldedAddress = unshieldedKeystore.getBech32Address().toString();

  const baseConfiguration = {
    networkId: params.networkId,
    costParameters: {
      additionalFeeOverhead: 0n,
      feeBlocksMargin: 5,
    },
    indexerClientConnection: {
      indexerHttpUrl: params.indexerHttpUrl,
      indexerWsUrl: params.indexerWsUrl,
    },
  } as const;

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

  const facade = await WalletFacade.init({
    configuration: {
      ...baseConfiguration,
      relayURL: new URL(params.nodeWsUrl),
      provingServerUrl: new URL(params.provingServerUrl),
      txHistoryStorage: new InMemoryTransactionHistoryStorage(),
    },
    shielded: async () => shieldedWallet,
    unshielded: async () => unshieldedWallet,
    dust: async () => dustWallet,
  });
  await facade.start(shieldedSecretKeys, dustSecretKey);

  return {
    wallet: facade,
    shieldedSecretKeys,
    dustSecretKey,
    unshieldedKeystore,
    unshieldedAddress,
    networkId: params.networkId,
  };
}

