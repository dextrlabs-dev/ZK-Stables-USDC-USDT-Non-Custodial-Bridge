import { BrowserWallet, MeshTxBuilder, deserializeAddress } from '@meshsdk/core';
import type { Asset, Data, IEvaluator } from '@meshsdk/common';
import { parseUnits } from 'viem';
import { fetchCardanoBridgeMetadata } from './bridgeMetadata.js';
import { buildLockDatumMesh } from './plutusLockDatum.js';
import { createBrowserCardanoIndexer, type CardanoIndexer } from './meshCardanoIndexer.js';

/** Policy id (56 hex) + asset name hex = Mesh `unit`. */
export function splitCardanoNativeUnit(fullUnit: string): { policyIdHex: string; assetNameHex: string } {
  const u = fullUnit.replace(/^0x/i, '').trim().toLowerCase();
  if (u.length < 56) {
    throw new Error('Cardano native unit must include at least 56 hex chars (policy id)');
  }
  return {
    policyIdHex: u.slice(0, 56),
    assetNameHex: u.slice(56),
  };
}

function envBigInt(name: string, fallback: string): bigint {
  const raw = String((import.meta.env as Record<string, string | undefined>)[name] ?? '').trim();
  const v = raw === '' ? fallback : raw;
  try {
    return BigInt(v);
  } catch {
    return BigInt(fallback);
  }
}

function randomUint64(): bigint {
  const b = new Uint8Array(8);
  crypto.getRandomValues(b);
  let n = 0n;
  for (let i = 0; i < 8; i++) n = (n << 8n) | BigInt(b[i]);
  return n;
}

/**
 * Lock zk native (USDC/USDT) at the bridge `lock_pool` script with **inline** `LockDatum`
 * so `cardanoLockWatcher` can read `lockNonce` for stub proofs.
 */
export async function browserLockZkAtBridgeScript(opts: {
  cip30WalletKey: string;
  relayerBaseUrl: string;
  asset: 'USDC' | 'USDT';
  /** Human amount (e.g. "10.5") — scaled by `VITE_CARDANO_NATIVE_DECIMALS` (default 6). */
  amountHuman: string;
  /** Optional decimal string; if empty, a random uint64 is used. */
  lockNonceDecimal?: string;
  /**
   * 64 hex chars (no 0x) for `LockDatum.recipient_commitment`. Required for redeem→EVM flow so
   * `burnCommitmentHex` matches on-chain; if omitted, uses env or zeros (legacy mint/watcher path).
   */
  recipientCommitmentHex64?: string;
}): Promise<{ txHash: string; outputIndex: number; lockNonce: string }> {
  const wusdc = String(import.meta.env.VITE_CARDANO_WUSDC_UNIT ?? '').trim().toLowerCase();
  const wusdt = String(import.meta.env.VITE_CARDANO_WUSDT_UNIT ?? '').trim().toLowerCase();
  const unit = opts.asset === 'USDC' ? wusdc : wusdt;
  if (!unit) {
    throw new Error(
      `Set VITE_CARDANO_${opts.asset === 'USDC' ? 'WUSDC' : 'WUSDT'}_UNIT for the selected asset.`,
    );
  }

  const dec = Math.min(
    18,
    Math.max(0, Number.parseInt(String(import.meta.env.VITE_CARDANO_NATIVE_DECIMALS ?? '6'), 10) || 6),
  );
  let amountAtomic: bigint;
  try {
    amountAtomic = parseUnits(opts.amountHuman.trim() || '0', dec);
  } catch {
    throw new Error('Invalid amount — use a decimal number.');
  }
  if (amountAtomic <= 0n) throw new Error('Amount must be greater than zero.');

  const { policyIdHex, assetNameHex } = splitCardanoNativeUnit(unit);

  let fetcher: CardanoIndexer;
  try {
    fetcher = createBrowserCardanoIndexer();
  } catch (e) {
    throw new Error(
      `${e instanceof Error ? e.message : String(e)} Set VITE_YACI_URL or VITE_BLOCKFROST_PROJECT_ID.`,
    );
  }

  const meta = await fetchCardanoBridgeMetadata(opts.relayerBaseUrl);
  const wallet = await BrowserWallet.enable(opts.cip30WalletKey);

  const used = await wallet.getUsedAddresses();
  const addr0 = used[0]?.trim();
  if (!addr0) throw new Error('Wallet has no used address — send a small tx first or pick another account.');

  const { pubKeyHash: vkh } = deserializeAddress(addr0);
  const vkh56 = vkh.replace(/^0x/i, '').trim().toLowerCase();
  if (vkh56.length !== 56) {
    throw new Error(`Unexpected payment key hash length (${vkh56.length}), expected 56 hex chars.`);
  }

  const lockNonce =
    opts.lockNonceDecimal?.trim() !== ''
      ? BigInt(opts.lockNonceDecimal!.trim())
      : randomUint64();

  const optComm = opts.recipientCommitmentHex64?.replace(/^0x/i, '').trim().toLowerCase();
  let recipientCommitmentHex: string;
  if (optComm !== undefined && optComm !== '') {
    if (optComm.length !== 64 || !/^[0-9a-f]+$/u.test(optComm)) {
      throw new Error('recipientCommitmentHex64 must be exactly 64 hexadecimal characters.');
    }
    recipientCommitmentHex = optComm;
  } else {
    const envComm = String(import.meta.env.VITE_CARDANO_LOCK_RECIPIENT_COMMITMENT_HEX ?? '').trim();
    if (envComm === '') {
      recipientCommitmentHex = '0'.repeat(64);
    } else {
      const h = envComm.replace(/^0x/i, '').trim().toLowerCase();
      if (h.length !== 64 || !/^[0-9a-f]+$/u.test(h)) {
        throw new Error('VITE_CARDANO_LOCK_RECIPIENT_COMMITMENT_HEX must be exactly 64 hex chars when set.');
      }
      recipientCommitmentHex = h;
    }
  }

  const sourceChainId = envBigInt('VITE_ZK_SOURCE_CHAIN_ID', '0');
  const destinationChainId = envBigInt('VITE_ZK_DEST_CHAIN_ID', '0');

  const datum: Data = buildLockDatumMesh({
    depositorVkeyHashHex56: vkh56,
    recipientVkeyHashHex56: vkh56,
    policyIdHex,
    assetNameHex,
    amount: amountAtomic,
    lockNonce,
    recipientCommitmentHex,
    sourceChainId,
    destinationChainId,
    bridgeOperatorVkeyHashHex56: null,
  });

  const minLovelace = 2_500_000n;
  const assets: Asset[] = [
    { unit: 'lovelace', quantity: minLovelace.toString() },
    { unit, quantity: amountAtomic.toString() },
  ];

  const utxos = await wallet.getUtxos();
  const change = (await wallet.getChangeAddress()).trim();
  if (!change) throw new Error('Wallet has no change address');

  const txB = new MeshTxBuilder({
    fetcher,
    submitter: fetcher,
    evaluator: fetcher as unknown as IEvaluator,
  });

  await txB
    .txOut(meta.lockScriptAddress, assets)
    .txOutInlineDatumValue(datum)
    .changeAddress(change)
    .selectUtxosFrom(utxos)
    .setNetwork(meta.meshNetwork)
    .complete();

  const signed = await wallet.signTx(txB.txHex, true);
  const txHash = await wallet.submitTx(signed);
  if (!txHash) throw new Error('submitTx returned empty');

  const submitted = txHash.replace(/^0x/i, '').trim().toLowerCase();
  const utxosAt = await fetcher.fetchUTxOs(submitted);
  const atScript = utxosAt.find((u) => u.output.address === meta.lockScriptAddress);
  const outputIndex = atScript?.input.outputIndex ?? 0;

  return {
    txHash: submitted,
    outputIndex,
    lockNonce: lockNonce.toString(),
  };
}
