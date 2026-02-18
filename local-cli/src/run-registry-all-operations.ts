/**
 * Deploy `zk-stables-registry` and run each provable circuit for one deposit key (same env as `run-all-operations.ts`).
 *
 * Uses a **separate** ZK artifact directory and LevelDB store from single-ticket `zk-stables` — circuit names overlap
 * (`proveHolder`, etc.) but prover keys differ per contract (see `configureMidnightContractProviders` in `providers.ts`).
 *
 * Template: [midnightntwrk/example-counter](https://github.com/midnightntwrk/example-counter) CLI flow (wallet sync →
 * deploy → contract calls).
 */
import { Buffer } from 'buffer';
import WebSocket from 'ws';
import * as bip39 from 'bip39';
import * as ledger from '@midnight-ntwrk/ledger-v8';
import * as Rx from 'rxjs';
import { deployContract } from '@midnight-ntwrk/midnight-js-contracts';
import { zkStablesRegistryPrivateStateId, AssetKind } from '@zk-stables/midnight-contract';
import { zkStablesRegistryCompiledContract } from './zk-stables-registry-compiled-contract.js';
import { LocalUndeployedConfig } from './config.js';
import { configureZkStablesRegistryProviders } from './providers.js';
import { initWalletWithSeed } from './wallet.js';
import { registryHolderLedgerPublicKey } from './holder-key.js';

(globalThis as any).WebSocket = WebSocket;

function hexToBytes32(hex: string): Uint8Array {
  const h = hex.replace(/^0x/, '');
  if (h.length !== 64) throw new Error('expected 32-byte hex string');
  return Uint8Array.from(Buffer.from(h, 'hex'));
}

function logTx(label: string, pub: { txId: unknown; txHash: unknown; blockHeight?: unknown }): void {
  const bh = pub.blockHeight !== undefined ? ` blockHeight=${pub.blockHeight}` : '';
  console.log(`${label}: txId=${String(pub.txId)} txHash=${String(pub.txHash)}${bh}`);
}

async function main(): Promise<void> {
  const mnemonic = process.env.BIP39_MNEMONIC;
  if (!mnemonic || !bip39.validateMnemonic(mnemonic)) {
    console.error('Set valid BIP39_MNEMONIC (fund it: cd midnight-local-network && yarn fund-and-register-dust "<mnemonic>")');
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
  const ownerPk = registryHolderLedgerPublicKey(holderSk);
  const depositCommitment = hexToBytes32(process.env.DEPOSIT_COMMITMENT_HEX ?? '00'.repeat(32));

  const providers = await configureZkStablesRegistryProviders(walletCtx, config);

  console.log('Deploying zk-stables-registry…');
  const deployed = await deployContract(providers, {
    compiledContract: zkStablesRegistryCompiledContract,
    privateStateId: zkStablesRegistryPrivateStateId,
    initialPrivateState: {
      operatorSecretKey: new Uint8Array(opSk),
      holderSecretKey: new Uint8Array(holderSk),
    },
  });

  const deployPub = deployed.deployTxData.public;
  logTx('deploy', deployPub);
  console.log('Contract address:', deployPub.contractAddress);

  const { callTx } = deployed;
  const recipientUserAddr = {
    bytes: ledger.encodeUserAddress(walletCtx.unshieldedKeystore.getAddress()),
  };

  logTx(
    'registerDeposit',
    (
      await callTx.registerDeposit(
        depositCommitment,
        AssetKind.USDC,
        1n,
        1_000_000n,
        new Uint8Array(ownerPk),
      )
    ).public,
  );
  logTx('proveHolder', (await callTx.proveHolder(depositCommitment)).public);
  logTx('mintWrappedUnshielded', (await callTx.mintWrappedUnshielded(depositCommitment)).public);
  logTx(
    'initiateBurn',
    (await callTx.initiateBurn(depositCommitment, 2n, hexToBytes32('aa'.repeat(32)))).public,
  );
  logTx(
    'sendWrappedUnshieldedToUser',
    (await callTx.sendWrappedUnshieldedToUser(depositCommitment, recipientUserAddr)).public,
  );
  logTx('finalizeBurn', (await callTx.finalizeBurn(depositCommitment)).public);

  console.log('Done. Registry circuits submitted.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
