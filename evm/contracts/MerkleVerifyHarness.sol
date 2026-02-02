// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { MerkleProof } from "./MerkleProof.sol";

contract MerkleVerifyHarness {
  function verify(bytes32[] calldata proof, bytes32 root, bytes32 leaf) external pure returns (bool) {
    return MerkleProof.verify(proof, root, leaf);
  }
}
