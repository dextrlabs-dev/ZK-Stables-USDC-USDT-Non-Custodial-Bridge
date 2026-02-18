import type { IFetcher, UTxO } from '@meshsdk/common';

export async function fetchUtxo(fetcher: IFetcher, txHash: string, outputIndex: number): Promise<UTxO> {
  const utxos = await fetcher.fetchUTxOs(txHash, outputIndex);
  const u = utxos.find((x) => x.input.outputIndex === outputIndex) ?? utxos[0];
  if (!u) throw new Error(`No UTxO for ${txHash}#${outputIndex}`);
  return u;
}
