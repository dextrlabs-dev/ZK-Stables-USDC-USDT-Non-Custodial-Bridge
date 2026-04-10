import { Buffer } from 'node:buffer';
import type { Context } from 'hono';
import type { Logger } from 'pino';
import { createPublicClient, http, type Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { foundry } from 'viem/chains';
import { ContractState as MidnightOnchainContractState } from '@midnight-ntwrk/compact-runtime';
import { getPublicStates } from '@midnight-ntwrk/midnight-js-contracts';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import type { ContractState as LedgerWasmContractState } from '@midnight-ntwrk/ledger-v8';
import { ZkStablesRegistry } from '@zk-stables/midnight-contract';
import { ForgeScript, resolveScriptHash, stringToHex } from '@meshsdk/core';
import { resolveUnderlyingTokenForAsset } from '../adapters/evmUnderlying.js';
import { cardanoBridgeTokenName } from '../adapters/cardanoMintPayout.js';
import { ensureCardanoBridgeWallet } from '../adapters/cardanoPayout.js';
import { getMidnightContractAddress } from '../midnight/service.js';
import { RelayerMidnightConfig } from '../midnight/config.js';

const erc20Abi = [
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'decimals', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] },
] as const;

function formatUnits(raw: bigint, decimals: number): string {
  const s = raw.toString().padStart(decimals + 1, '0');
  const intPart = s.slice(0, s.length - decimals);
  const fracPart = s.slice(s.length - decimals);
  const trimmed = fracPart.replace(/0+$/, '');
  return trimmed ? `${intPart}.${trimmed}` : intPart;
}

async function readEvmBalance(pub: ReturnType<typeof createPublicClient>, token: Address, owner: Address): Promise<{ raw: string; display: string } | null> {
  try {
    const [bal, dec] = await Promise.all([
      pub.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [owner] }),
      pub.readContract({ address: token, abi: erc20Abi, functionName: 'decimals' }).catch(() => 6),
    ]);
    return { raw: bal.toString(), display: formatUnits(bal, Number(dec)) };
  } catch {
    return null;
  }
}

export async function handleGetBalances(c: Context, logger: Logger) {
  const rpc = process.env.RELAYER_EVM_RPC_URL ?? 'http://127.0.0.1:8545';
  const pub = createPublicClient({ chain: foundry, transport: http(rpc) });
  const pk = process.env.RELAYER_EVM_PRIVATE_KEY?.trim() as `0x${string}` | undefined;
  let evmOperator: string | undefined;
  if (pk && /^0x[0-9a-fA-F]{64}$/u.test(pk)) {
    try {
      evmOperator = privateKeyToAccount(pk).address;
    } catch { /* fallback below */ }
  }
  if (!evmOperator) {
    evmOperator = process.env.RELAYER_BRIDGE_EVM_RECIPIENT?.trim();
  }

  const pool = process.env.RELAYER_EVM_LOCK_ADDRESS?.trim() as Address | undefined;

  const usdcUnderlying = resolveUnderlyingTokenForAsset('USDC');
  const usdtUnderlying = resolveUnderlyingTokenForAsset('USDT');
  const usdcWrapped = (process.env.RELAYER_EVM_WRAPPED_TOKEN_USDC?.trim() || process.env.RELAYER_EVM_WRAPPED_TOKEN?.trim()) as Address | undefined;
  const usdtWrapped = (process.env.RELAYER_EVM_WRAPPED_TOKEN_USDT?.trim()) as Address | undefined;

  type BalRow = { raw: string; display: string } | null;
  const evm: Record<string, unknown> = {};

  const evmOwner = evmOperator as Address | undefined;
  if (evmOwner && usdcUnderlying) evm.usdc = await readEvmBalance(pub, usdcUnderlying, evmOwner);
  if (evmOwner && usdtUnderlying) evm.usdt = await readEvmBalance(pub, usdtUnderlying, evmOwner);
  if (evmOwner && usdcWrapped) evm.zkUsdc = await readEvmBalance(pub, usdcWrapped, evmOwner);
  if (evmOwner && usdtWrapped) evm.zkUsdt = await readEvmBalance(pub, usdtWrapped, evmOwner);

  const poolBalances: Record<string, unknown> = {};
  if (pool && usdcUnderlying) poolBalances.usdc = await readEvmBalance(pub, usdcUnderlying, pool);
  if (pool && usdtUnderlying) poolBalances.usdt = await readEvmBalance(pub, usdtUnderlying, pool);

  let cardano: Record<string, unknown> | null = null;
  try {
    const ctx = await ensureCardanoBridgeWallet(logger);
    if (ctx) {
      const walletAddr = ctx.wallet.getChangeAddress();
      const recipientAddr = (process.env.RELAYER_BRIDGE_CARDANO_RECIPIENT ?? '').trim();
      const addrs = [walletAddr];
      if (recipientAddr && recipientAddr.startsWith('addr') && recipientAddr !== walletAddr) {
        addrs.push(recipientAddr);
      }

      const m = new Map<string, bigint>();
      for (const addr of addrs) {
        try {
          const utxos = addr === walletAddr
            ? await ctx.wallet.getUtxos()
            : await ctx.fetcher.fetchAddressUTxOs(addr);
          for (const u of utxos) {
            for (const a of u.output.amount) {
              m.set(a.unit, (m.get(a.unit) ?? 0n) + BigInt(a.quantity));
            }
          }
        } catch { /* skip address */ }
      }

      const decimals = Number(process.env.RELAYER_CARDANO_ASSET_DECIMALS ?? 6);
      const bridgeUnitToLabel = new Map<string, string>();
      try {
        const forgingScript = ForgeScript.withOneSignature(walletAddr);
        const policyId = resolveScriptHash(forgingScript);
        bridgeUnitToLabel.set(`${policyId}${stringToHex(cardanoBridgeTokenName('USDC'))}`, 'zkUSDC');
        bridgeUnitToLabel.set(`${policyId}${stringToHex(cardanoBridgeTokenName('USDT'))}`, 'zkUSDT');
      } catch {
        /* policy derivation failed — rows still have unit + display */
      }

      const bals: Record<string, { raw: string; display: string; unit: string; label?: string }> = {};
      for (const [unit, raw] of m) {
        const label = bridgeUnitToLabel.get(unit);
        bals[unit] = {
          raw: raw.toString(),
          display: formatUnits(raw, unit === 'lovelace' ? 6 : decimals),
          unit,
          ...(label ? { label } : {}),
        };
      }
      cardano = {
        address: walletAddr,
        ...(recipientAddr && recipientAddr !== walletAddr ? { recipientAddress: recipientAddr } : {}),
        balances: bals,
      };
    }
  } catch (e) {
    logger.debug({ err: e }, 'balances: cardano wallet fetch failed');
  }

  const midnightContract = await getMidnightContractAddress();
  const midnightBals = await readMidnightRegistryBalances(logger, midnightContract);

  return c.json({
    evm: {
      owner: evmOwner ?? null,
      pool: pool ?? null,
      balances: evm,
      poolBalances,
    },
    cardano,
    midnight: {
      contractAddress: midnightContract ?? null,
      balances: midnightBals.balances,
      ...(midnightBals.error ? { error: midnightBals.error } : {}),
    },
  });
}

type MidnightBalResult = {
  balances: { zkUsdc: { raw: string; display: string }; zkUsdt: { raw: string; display: string } };
  error?: string;
};

async function readMidnightRegistryBalances(logger: Logger, contractAddress: string | null): Promise<MidnightBalResult> {
  const zero = { raw: '0', display: '0' };
  const empty: MidnightBalResult = { balances: { zkUsdc: { ...zero }, zkUsdt: { ...zero } } };

  if (!contractAddress) {
    return { ...empty, error: 'RELAYER_MIDNIGHT_CONTRACT_ADDRESS not set' };
  }

  const cfg = new RelayerMidnightConfig();
  const indexerHttp = (process.env.RELAYER_MIDNIGHT_INDEXER_URL ?? cfg.indexer).trim();
  const indexerWs = cfg.indexerWS.trim();
  const pdp = indexerPublicDataProvider(indexerHttp, indexerWs);

  let contractState: unknown;
  try {
    ({ contractState } = await getPublicStates(pdp, contractAddress));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.debug({ err: e }, 'midnight balances: getPublicStates failed');
    return { ...empty, error: `Indexer getPublicStates failed: ${msg}` };
  }

  const wasmState = contractState as LedgerWasmContractState;
  let onchainFull: MidnightOnchainContractState;
  try {
    onchainFull = MidnightOnchainContractState.deserialize(new Uint8Array(wasmState.serialize()));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ...empty, error: `Deserialize failed: ${msg}` };
  }

  let L: ReturnType<typeof ZkStablesRegistry.ledger>;
  try {
    L = ZkStablesRegistry.ledger(onchainFull.data);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ...empty, error: `Ledger open failed: ${msg}` };
  }

  const BURNED = 3;
  let usdcTotal = 0n;
  let usdtTotal = 0n;

  for (const [depKey, status] of L.depositStatus) {
    const st = Number(status);
    if (st === BURNED) continue;

    if (!L.depositAmount.member(depKey)) continue;
    const amt = L.depositAmount.lookup(depKey);

    const minted = L.depositMintedUnshielded.member(depKey) && Number(L.depositMintedUnshielded.lookup(depKey)) === 1;
    if (!minted) continue;

    const ak = L.depositAssetKind.member(depKey) ? Number(L.depositAssetKind.lookup(depKey)) : 0;
    if (ak === 1) {
      usdtTotal += amt;
    } else {
      usdcTotal += amt;
    }
  }

  const decimals = Number(process.env.RELAYER_MIDNIGHT_ASSET_DECIMALS ?? process.env.RELAYER_CARDANO_ASSET_DECIMALS ?? 6);

  return {
    balances: {
      zkUsdc: { raw: usdcTotal.toString(), display: formatUnits(usdcTotal, decimals) },
      zkUsdt: { raw: usdtTotal.toString(), display: formatUnits(usdtTotal, decimals) },
    },
  };
}
