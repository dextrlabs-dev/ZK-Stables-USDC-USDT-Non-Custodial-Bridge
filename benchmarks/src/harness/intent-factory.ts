import { randomBytes } from 'node:crypto';
import { loadAddresses, getAnvilAccounts, getPublicClient, erc20Abi, poolAbi } from './evm-setup.js';

export type PreparedLockIntent = {
  operation: 'LOCK';
  sourceChain: 'evm';
  destinationChain: string;
  asset: 'USDC' | 'USDT';
  assetKind: number;
  amount: string;
  recipient: string;
  source: {
    evm: {
      txHash: `0x${string}`;
      logIndex: number;
      blockNumber: string;
      token: `0x${string}`;
      nonce: `0x${string}`;
    };
  };
  _lockTxHash: `0x${string}`;
};

export type PreparedBurnIntent = {
  operation: 'BURN';
  sourceChain: 'midnight';
  destinationChain: string;
  asset: 'USDC' | 'USDT';
  assetKind: number;
  amount: string;
  recipient: string;
  burnCommitmentHex: string;
  source: {
    midnight: {
      txId: string;
      destChainId: number;
    };
  };
};

export async function prepareLockIntents(
  count: number,
  opts: { destinationChain?: string; amount?: string } = {},
): Promise<PreparedLockIntent[]> {
  const addrs = await loadAddresses();
  const accounts = getAnvilAccounts();
  const pub = getPublicClient();
  const dest = opts.destinationChain || 'midnight';
  const amountRaw = BigInt(Number(opts.amount || '1') * 1_000_000);
  const intents: PreparedLockIntent[] = [];

  for (let i = 0; i < count; i++) {
    const acct = accounts[i % accounts.length];
    const nonce = ('0x' + randomBytes(32).toString('hex')) as `0x${string}`;
    const recipient = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';

    const approveTx = await acct.wallet.writeContract({
      address: addrs.USDC,
      abi: erc20Abi,
      functionName: 'approve',
      args: [addrs.poolLock, amountRaw],
    });
    await pub.waitForTransactionReceipt({ hash: approveTx });

    const lockTx = await acct.wallet.writeContract({
      address: addrs.poolLock,
      abi: poolAbi,
      functionName: 'lock',
      args: [addrs.USDC, amountRaw, recipient, nonce],
    });
    const receipt = await pub.waitForTransactionReceipt({ hash: lockTx });

    intents.push({
      operation: 'LOCK',
      sourceChain: 'evm',
      destinationChain: dest,
      asset: 'USDC',
      assetKind: 0,
      amount: opts.amount || '1',
      recipient,
      source: {
        evm: {
          txHash: lockTx,
          logIndex: 0,
          blockNumber: String(receipt.blockNumber),
          token: addrs.USDC,
          nonce,
        },
      },
      _lockTxHash: lockTx,
    });
  }

  return intents;
}

export function prepareBurnIntents(
  count: number,
  opts: { burnCommitments?: string[]; amount?: string; destinationChain?: string } = {},
): PreparedBurnIntent[] {
  const intents: PreparedBurnIntent[] = [];
  const dest = opts.destinationChain || 'evm';

  for (let i = 0; i < count; i++) {
    const bc = opts.burnCommitments?.[i] || randomBytes(32).toString('hex');
    intents.push({
      operation: 'BURN',
      sourceChain: 'midnight',
      destinationChain: dest,
      asset: 'USDC',
      assetKind: 0,
      amount: opts.amount || '1',
      recipient: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
      burnCommitmentHex: bc.replace(/^0x/, ''),
      source: {
        midnight: {
          txId: randomBytes(32).toString('hex'),
          destChainId: 2,
        },
      },
    });
  }

  return intents;
}
