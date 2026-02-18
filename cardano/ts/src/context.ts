import { BlockfrostProvider, MeshTxBuilder, MeshWallet, YaciProvider } from '@meshsdk/core';
import type { IFetcher, IEvaluator, ISubmitter, Network } from '@meshsdk/common';
import type { PlutusBlueprint } from './blueprint.js';
import { loadBlueprint } from './blueprint.js';

export type BridgeContext = {
  blueprint: PlutusBlueprint;
  fetcher: IFetcher;
  submitter: ISubmitter;
  wallet: MeshWallet;
  networkId: 0 | 1;
  meshNetwork: Network;
};

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

function parseMnemonic(): string[] {
  const raw = requireEnv('CARDANO_WALLET_MNEMONIC').trim();
  return raw.split(/\s+/u);
}

export function createDefaultContext(): BridgeContext {
  const networkId = Number(process.env.CARDANO_NETWORK_ID ?? 0) as 0 | 1;
  const meshNetwork = (process.env.CARDANO_MESH_NETWORK ?? 'preprod') as Network;

  const yaciUrl = process.env.YACI_URL ?? '';
  const yaciAdminUrl = process.env.YACI_ADMIN_URL ?? '';

  const fetcher: IFetcher & ISubmitter =
    yaciUrl !== ''
      ? new YaciProvider(yaciUrl, yaciAdminUrl || undefined)
      : new BlockfrostProvider(requireEnv('BLOCKFROST_PROJECT_ID'));

  const wallet = new MeshWallet({
    networkId,
    fetcher,
    submitter: fetcher,
    key: {
      type: 'mnemonic',
      words: parseMnemonic(),
    },
  });

  return {
    blueprint: loadBlueprint(),
    fetcher,
    submitter: fetcher,
    wallet,
    networkId,
    meshNetwork,
  };
}

export function getTxBuilder(ctx: BridgeContext): MeshTxBuilder {
  return new MeshTxBuilder({
    fetcher: ctx.fetcher,
    submitter: ctx.submitter,
    evaluator: ctx.fetcher as unknown as IEvaluator,
  });
}
