import type { Network } from '@meshsdk/common';

export type CardanoBridgeMetadata = {
  networkId: 0 | 1;
  meshNetwork: Network;
  lockScriptAddress: string;
  lockScriptCborHex: string;
};

export async function fetchCardanoBridgeMetadata(relayerBaseUrl: string): Promise<CardanoBridgeMetadata> {
  const base = relayerBaseUrl.replace(/\/$/, '');
  const res = await fetch(`${base}/v1/cardano/bridge-metadata`);
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(j.error ?? `bridge-metadata ${res.status}`);
  }
  const j = (await res.json()) as {
    networkId: number;
    meshNetwork: string;
    lockScriptAddress: string;
    lockScriptCborHex: string;
  };
  const networkId = j.networkId === 1 ? 1 : 0;
  return {
    networkId,
    meshNetwork: j.meshNetwork as Network,
    lockScriptAddress: j.lockScriptAddress,
    lockScriptCborHex: j.lockScriptCborHex,
  };
}
