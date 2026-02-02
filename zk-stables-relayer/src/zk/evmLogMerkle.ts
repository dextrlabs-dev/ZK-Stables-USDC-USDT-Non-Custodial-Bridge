import { encodePacked, keccak256, type Address, type Hex } from 'viem';

export const LEAF_VERSION = 1;

const ZERO_TOPIC = ('0x' + '00'.repeat(32)) as Hex;

/** Must match `LogLeaf.hashLogLeaf` in `evm/contracts/LogLeaf.sol`. */
export function hashLogLeafV1(params: {
  logIndex: bigint;
  emitter: Address;
  topic0: Hex;
  topic1?: Hex;
  topic2?: Hex;
  topic3?: Hex;
  data: Hex;
}): Hex {
  const t1 = params.topic1 ?? ZERO_TOPIC;
  const t2 = params.topic2 ?? ZERO_TOPIC;
  const t3 = params.topic3 ?? ZERO_TOPIC;
  return keccak256(
    encodePacked(
      ['uint8', 'uint256', 'address', 'bytes32', 'bytes32', 'bytes32', 'bytes32', 'bytes'],
      [LEAF_VERSION, params.logIndex, params.emitter, params.topic0, t1, t2, t3, params.data],
    ),
  );
}
