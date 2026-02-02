/**
 * Deploy `zk-stables` to Brick Towers [midnight-local-network](https://github.com/bricktowers/midnight-local-network)
 * (undeployed). Requires Docker stack up and a funded mnemonic (`yarn fund` in that repo).
 *
 * Env:
 * - `BIP39_MNEMONIC` – same wallet as `fund` in midnight-local-network (Node ≥ 20).
 * - `MIDNIGHT_LDB_PASSWORD` – optional; ≥16 chars for LevelDB encryption (see `providers.ts`).
 * - `OPERATOR_SK_HEX` / `HOLDER_SK_HEX` – optional 64-char hex each; default deterministic dev values.
 * - `DEPOSIT_COMMITMENT_HEX` – optional 64-char hex constructor arg; default zero bytes.
 *
 * Coin public key for deploy is taken from `walletProvider.getCoinPublicKey()` (midnight-js 4.x).
 */
import { Buffer } from 'buffer';
import WebSocket from 'ws';
import * as bip39 from 'bip39';
import * as Rx from 'rxjs';
import { deployContract } from '@midnight-ntwrk/midnight-js-contracts';
import { zkStablesPrivateStateId, ZkStables, AssetKind } from '@zk-stables/midnight-contract';
import { zkStablesCompiledContract } from './zk-stables-compiled-contract.js';
import { LocalUndeployedConfig } from './config.js';
import { configureZkStablesProviders } from './providers.js';
import { initWalletWithSeed } from './wallet.js';
import { holderLedgerPublicKey } from './holder-key.js';

(globalThis as any).WebSocket = WebSocket;

function hexToBytes32(hex: string): Uint8Array {
  const h = hex.replace(/^0x/, '');
  if (h.length !== 64) throw new Error('expected 32-byte hex string');
  return Uint8Array.from(Buffer.from(h, 'hex'));
}

async function main(): Promise<void> {
  const mnemonic = process.env.BIP39_MNEMONIC;
  if (!mnemonic || !bip39.validateMnemonic(mnemonic)) {
    console.error('Set valid BIP39_MNEMONIC (fund it: cd midnight-local-network && yarn fund "<mnemonic>")');
    process.exit(1);
  }

  const config = new LocalUndeployedConfig();
  const seed = Buffer.from(await bip39.mnemonicToSeed(mnemonic));
  const walletCtx = await initWalletWithSeed(seed);

  console.log('Waiting for wallet sync…');
  await Rx.firstValueFrom(walletCtx.wallet.state().pipe(Rx.filter((s) => s.isSynced)));
  console.log('Synced.');

  const opSk = hexToBytes32(process.env.OPERATOR_SK_HEX ?? '01'.repeat(32));
  const holderSk = hexToBytes32(process.env.HOLDER_SK_HEX ?? '02'.repeat(32));
  const ownerPk = holderLedgerPublicKey(holderSk);

  const depositCommitment = hexToBytes32(process.env.DEPOSIT_COMMITMENT_HEX ?? '00'.repeat(32));

  const providers = await configureZkStablesProviders(walletCtx, config);

  console.log('Deploying zk-stables…');
  const deployed = await deployContract(providers, {
    compiledContract: zkStablesCompiledContract,
    privateStateId: zkStablesPrivateStateId,
    initialPrivateState: {
      operatorSecretKey: new Uint8Array(opSk),
      holderSecretKey: new Uint8Array(holderSk),
    },
    args: [
      depositCommitment,
      AssetKind.USDC,
      1n,
      1_000_000n,
      new Uint8Array(ownerPk),
    ],
  });

  const pub = deployed.deployTxData.public;
  const addr = pub.contractAddress;
  console.log('Deployed zk-stables at:', addr);

  // Prefer constructor output from the deploy tx. `queryContractState` / indexer subscriptions
  // can block or lag behind the node; the merged `public` payload always includes `initialContractState`.
  if (!('initialContractState' in pub) || !pub.initialContractState) {
    throw new Error('deploy result missing initialContractState');
  }
  const ledger = ZkStables.ledger(pub.initialContractState.data);
  console.log(
    'Ledger snapshot (from deploy tx; indexer may still be catching up): amount=',
    ledger.amount.toString(),
    'assetKind=',
    ledger.assetKind,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
