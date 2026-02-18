import { blockfrostLatestBlock } from './cardanoBlockfrost.js';
import { yaciLatestBlock } from './cardanoYaci.js';

export type WaitCardanoConfirmationsParams = {
  projectId: string;
  network: 'preprod' | 'mainnet';
  minedBlockHeight: number;
  confirmations: number;
  pollMs?: number;
};

export type WaitCardanoConfirmationsYaciParams = {
  baseUrl: string;
  minedBlockHeight: number;
  confirmations: number;
  pollMs?: number;
};

/**
 * Wait until Blockfrost tip is at least `minedBlockHeight + confirmations - 1`
 * (inclusive depth of `confirmations` after the block that included the tx).
 */
export async function waitCardanoConfirmations(p: WaitCardanoConfirmationsParams): Promise<void> {
  const needTip = p.minedBlockHeight + Math.max(0, p.confirmations - 1);
  const poll = p.pollMs ?? 3000;
  for (;;) {
    const st = await blockfrostLatestBlock(p.projectId, p.network);
    if (st.ok && st.latestBlockHeight !== undefined && st.latestBlockHeight >= needTip) {
      return;
    }
    await new Promise((r) => setTimeout(r, poll));
  }
}

/**
 * Same depth semantics as `waitCardanoConfirmations`, using Yaci Store `blocks/latest`.
 */
export async function waitCardanoConfirmationsYaci(p: WaitCardanoConfirmationsYaciParams): Promise<void> {
  const needTip = p.minedBlockHeight + Math.max(0, p.confirmations - 1);
  const poll = p.pollMs ?? 3000;
  for (;;) {
    const st = await yaciLatestBlock(p.baseUrl);
    if (st.ok && st.latestBlockHeight !== undefined && st.latestBlockHeight >= needTip) {
      return;
    }
    await new Promise((r) => setTimeout(r, poll));
  }
}
