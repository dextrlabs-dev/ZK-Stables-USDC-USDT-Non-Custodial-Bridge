// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * Canonical leaf hash for one log in a tx (must match relayer `evmLogMerkle.ts`).
 */
library LogLeaf {
  uint8 internal constant LEAF_VERSION = 1;

  function hashLogLeaf(
    uint256 logIndex,
    address emitter,
    bytes32 topic0,
    bytes32 topic1,
    bytes32 topic2,
    bytes32 topic3,
    bytes calldata data
  ) internal pure returns (bytes32) {
    return
      keccak256(abi.encodePacked(LEAF_VERSION, logIndex, emitter, topic0, topic1, topic2, topic3, data));
  }
}
