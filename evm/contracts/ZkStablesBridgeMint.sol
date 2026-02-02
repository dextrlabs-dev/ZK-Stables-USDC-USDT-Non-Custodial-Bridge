// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IVerifier {
  function verify(bytes calldata proof, bytes32 publicInputsHash) external returns (bool);
}

interface IWrapped {
  function mint(address to, uint256 amount) external;
}

/**
 * Destination mint contract for Phase 2.
 * - Consumes a proof (mocked for now) and a public input hash.
 * - Prevents replay by nonce.
 * - Mints wrapped tokens to the recipient.
 */
contract ZkStablesBridgeMint {
  event Minted(address indexed wrappedToken, address indexed recipient, uint256 amount, bytes32 nonce, bytes32 publicInputsHash);

  IVerifier public immutable verifier;
  mapping(bytes32 => bool) public nonceUsed;

  constructor(address _verifier) {
    verifier = IVerifier(_verifier);
  }

  function mintWrapped(address wrappedToken, address recipient, uint256 amount, bytes32 nonce, bytes calldata proof, bytes32 publicInputsHash) external {
    require(!nonceUsed[nonce], "nonce used");
    require(verifier.verify(proof, publicInputsHash), "invalid proof");
    nonceUsed[nonce] = true;
    IWrapped(wrappedToken).mint(recipient, amount);
    emit Minted(wrappedToken, recipient, amount, nonce, publicInputsHash);
  }
}

