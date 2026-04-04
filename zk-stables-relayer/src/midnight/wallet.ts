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

function provingServerUrl(): URL {
  const fromRelayer = process.env.RELAYER_MIDNIGHT_PROOF_SERVER?.replace(/\/$/, '');
  if (fromRelayer) return new URL(fromRelayer);
  const port = Number.parseInt(process.env.PROOF_SERVER_PORT ?? '6300', 10);
  return new URL(`http://127.0.0.1:${port}`);
}

/**
 * Must match `RelayerMidnightConfig` / `RELAYER_MIDNIGHT_INDEXER_URL` used by indexer health checks,
 * otherwise the relayer pings one indexer while the wallet SDK syncs another (never `isSynced`).
 */
function midnightIndexerClientConnection(): { indexerHttpUrl: string; indexerWsUrl: string } {
  const httpExplicit = process.env.RELAYER_MIDNIGHT_INDEXER_HTTP?.trim();
  const wsExplicit = process.env.RELAYER_MIDNIGHT_INDEXER_WS?.trim();
  if (httpExplicit && wsExplicit) {
    return { indexerHttpUrl: httpExplicit, indexerWsUrl: wsExplicit };
  }
  const fromUrl = process.env.RELAYER_MIDNIGHT_INDEXER_URL?.trim().replace(/\/$/, '');
  if (fromUrl) {
    const wsBase = fromUrl.replace(/^https:/i, 'wss:').replace(/^http:/i, 'ws:');
    const wsUrl = /\/graphql\/ws$/iu.test(wsBase) ? wsBase : `${wsBase}/ws`;
    return { indexerHttpUrl: fromUrl, indexerWsUrl: wsUrl };
  }
  const http = `http://127.0.0.1:${INDEXER_PORT}/api/v4/graphql`;
  return { indexerHttpUrl: http, indexerWsUrl: `ws://127.0.0.1:${INDEXER_PORT}/api/v4/graphql/ws` };
}

function midnightNodeRelayUrl(): URL {
  const ws = process.env.RELAYER_MIDNIGHT_NODE_WS?.trim();
  if (ws) return new URL(ws);
  const http = process.env.RELAYER_MIDNIGHT_NODE_HTTP?.trim();
  if (http) {
    try {
      const u = new URL(http);
      const proto = u.protocol === 'https:' ? 'wss:' : 'ws:';
      return new URL(`${proto}//${u.host}`);
    } catch {
      /* use default below */
    }
  }
  return new URL(`ws://127.0.0.1:${NODE_PORT}`);
}

export type WalletContext = {
  wallet: WalletFacade;
  shieldedSecretKeys: ledger.ZswapSecretKeys;
  dustSecretKey: ledger.DustSecretKey;
  unshieldedKeystore: UnshieldedKeystore;
};

export async function initWalletWithSeed(seed: Buffer): Promise<WalletContext> {
  const indexerClientConnection = midnightIndexerClientConnection();
  const baseConfiguration: ShieldedConfiguration & DustConfiguration = {
    networkId: 'undeployed',
    costParameters: {
      additionalFeeOverhead: 300_000_000_000_000_000n,
      feeBlocksMargin: 5,
    },
    indexerClientConnection,
  };

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
      relayURL: midnightNodeRelayUrl(),
      provingServerUrl: provingServerUrl(),
      txHistoryStorage: new InMemoryTransactionHistoryStorage(),
    },
    shielded: async () => shieldedWallet,
    unshielded: async () => unshieldedWallet,
    dust: async () => dustWallet,
  });
  try {
    await facade.start(shieldedSecretKeys, dustSecretKey);
  } catch (e) {
    try {
      await facade.stop();
    } catch {
      /* ignore — best-effort release LevelDB / WS so a retry can open cleanly */
    }
    throw e;
  }
  return { wallet: facade, shieldedSecretKeys, dustSecretKey, unshieldedKeystore };
}
