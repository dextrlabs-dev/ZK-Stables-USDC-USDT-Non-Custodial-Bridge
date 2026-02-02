// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { MerkleProof } from "./MerkleProof.sol";
import { LogLeaf } from "./LogLeaf.sol";

interface IERC20Like {
  function transferFrom(address from, address to, uint256 amount) external returns (bool);
  function transfer(address to, uint256 amount) external returns (bool);
}

/**
 * Non-custodial pool lock contract: holds underlying tokens and emits Lock events.
 * FR-3.1.1 lock; FR-3.1.5 unlock after verified burn (FR-3.1.4) via Merkle inclusion proof (FR-3.1.2).
 */
contract ZkStablesPoolLock {
  event Locked(
    address indexed token,
    address indexed sender,
    address indexed recipient,
    uint256 amount,
    bytes32 nonce
  );

  mapping(bytes32 => bool) public nonceUsed;
  mapping(bytes32 => bool) public burnNonceUsed;

  event Unlocked(address indexed token, address indexed recipient, uint256 amount, bytes32 burnNonce);

  bool public paused;
  address public owner;

  modifier onlyOwner() {
    require(msg.sender == owner, "owner");
    _;
  }

  modifier notPaused() {
    require(!paused, "paused");
    _;
  }

  constructor() {
    owner = msg.sender;
  }

  function setPaused(bool v) external onlyOwner {
    paused = v;
  }

  function setOwner(address next) external onlyOwner {
    owner = next;
  }

  function lock(address token, uint256 amount, address recipient, bytes32 nonce) external notPaused {
    require(!nonceUsed[nonce], "nonce used");
    nonceUsed[nonce] = true;
    require(IERC20Like(token).transferFrom(msg.sender, address(this), amount), "transferFrom failed");
    emit Locked(token, msg.sender, recipient, amount, nonce);
  }

  /**
   * Operator-only unlock without proof (dev / emergency). Production should disable via governance.
   */
  function unlock(address token, uint256 amount, address recipient, bytes32 burnNonce) external onlyOwner notPaused {
    require(!burnNonceUsed[burnNonce], "burn nonce used");
    burnNonceUsed[burnNonce] = true;
    require(IERC20Like(token).transfer(recipient, amount), "transfer failed");
    emit Unlocked(token, recipient, amount, burnNonce);
  }

  /**
   * FR-3.1.5: unlock after burn is proven with Merkle inclusion of the Burned log (FR-3.1.2).
   * Finality: `blockhash(logBlockNumber)` must match (EVM: only reliable for last 256 blocks).
   */
  function unlockWithInclusionProof(
    address token,
    uint256 amount,
    address recipient,
    address wrappedEmitter,
    uint256 logBlockNumber,
    bytes32 blockHash,
    bytes32 merkleRoot,
    bytes32[] calldata merkleProof,
    bytes32 leaf,
    uint256 logIndex,
    bytes32 topic0,
    bytes32 topic1,
    bytes32 topic2,
    bytes32 topic3,
    bytes calldata logData
  ) external notPaused {
    require(blockhash(logBlockNumber) == blockHash, "blockhash");
    bytes32 computedLeaf = LogLeaf.hashLogLeaf(logIndex, wrappedEmitter, topic0, topic1, topic2, topic3, logData);
    require(computedLeaf == leaf, "leaf");
    require(MerkleProof.verify(merkleProof, merkleRoot, leaf), "merkle");

    (uint256 amountInLog, bytes32 burnNonce) = abi.decode(logData, (uint256, bytes32));
    require(amountInLog == amount, "amount");
    require(!burnNonceUsed[burnNonce], "burn nonce used");
    burnNonceUsed[burnNonce] = true;

    address recipientOnSource = address(uint160(uint256(topic2)));
    require(recipientOnSource == recipient, "recipient");

    require(IERC20Like(token).transfer(recipient, amount), "transfer");
    emit Unlocked(token, recipient, amount, burnNonce);
  }
}
