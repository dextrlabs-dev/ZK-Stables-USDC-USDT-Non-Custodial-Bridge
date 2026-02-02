// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * Placeholder verifier for Phase 2.
 * Phase 7 replaces this with a real SNARK verifier (and public input hashing rules).
 */
contract BridgeVerifierMock {
  function verify(bytes calldata /*proof*/, bytes32 /*publicInputsHash*/) external pure returns (bool) {
    return true;
  }
}

