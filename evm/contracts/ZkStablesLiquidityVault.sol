// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * FR-3.2.1 scaffold: per-asset reserve accounting + LP shares (1:1 for simplicity).
 * Production would add fee distribution, oracle checks, and audited upgrade path.
 */
interface IERC20 {
  function transferFrom(address from, address to, uint256 amount) external returns (bool);
  function transfer(address to, uint256 amount) external returns (bool);
  function balanceOf(address a) external view returns (uint256);
}

contract ZkStablesLiquidityVault {
  event Deposited(address indexed token, address indexed user, uint256 amount, uint256 shares);
  event Withdrawn(address indexed token, address indexed user, uint256 amount, uint256 shares);

  mapping(address => uint256) public totalShares;
  mapping(address => mapping(address => uint256)) public shares;

  function deposit(address token, uint256 amount) external {
    require(amount > 0, "amount");
    require(IERC20(token).transferFrom(msg.sender, address(this), amount), "transferFrom");
    shares[token][msg.sender] += amount;
    totalShares[token] += amount;
    emit Deposited(token, msg.sender, amount, amount);
  }

  function withdraw(address token, uint256 amount) external {
    require(shares[token][msg.sender] >= amount, "shares");
    shares[token][msg.sender] -= amount;
    totalShares[token] -= amount;
    require(IERC20(token).transfer(msg.sender, amount), "transfer");
    emit Withdrawn(token, msg.sender, amount, amount);
  }

  function reserveOf(address token) external view returns (uint256) {
    return IERC20(token).balanceOf(address(this));
  }
}
