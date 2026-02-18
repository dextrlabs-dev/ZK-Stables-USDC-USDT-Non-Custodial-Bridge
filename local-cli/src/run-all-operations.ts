/**
 * Deploy zk-stables and invoke every exported circuit in a valid order, printing txId + txHash.
 *
 * Env: same as `deploy-local.ts` (`BIP39_MNEMONIC`, optional `OPERATOR_SK_HEX` / `HOLDER_SK_HEX` / `DEPOSIT_COMMITMENT_HEX`).
 */
import { Buffer } from 'buffer';
import WebSocket from 'ws';
import * as bip39 from 'bip39';
import * as ledger from '@midnight-ntwrk/ledger-v8';
import * as Rx from 'rxjs';
import { deployContract } from '@midnight-ntwrk/midnight-js-contracts';
import { zkStablesPrivateStateId, AssetKind } from '@zk-stables/midnight-contract';
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

  const deployPub = deployed.deployTxData.public;
  logTx('deploy', deployPub);
  console.log('Contract address:', deployPub.contractAddress);

  const { callTx } = deployed;
  const recipientUserAddr = {
    bytes: ledger.encodeUserAddress(walletCtx.unshieldedKeystore.getAddress()),
  };

  logTx('proveHolder', (await callTx.proveHolder()).public);
  logTx('mintWrappedUnshielded', (await callTx.mintWrappedUnshielded()).public);
  logTx('initiateBurn', (await callTx.initiateBurn(2n, hexToBytes32('aa'.repeat(32)))).public);
  logTx('sendWrappedUnshieldedToUser', (await callTx.sendWrappedUnshieldedToUser(recipientUserAddr)).public);
  logTx('finalizeBurn', (await callTx.finalizeBurn()).public);

  console.log('Done. All circuits submitted and finalized.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
