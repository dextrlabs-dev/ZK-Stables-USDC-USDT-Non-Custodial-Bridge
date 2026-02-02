// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract ZkStablesWrappedToken {
  string public name;
  string public symbol;
  uint8 public immutable decimals;

  uint256 public totalSupply;
  mapping(address => uint256) public balanceOf;
  mapping(address => mapping(address => uint256)) public allowance;

  address public immutable bridgeMinter;

  event Transfer(address indexed from, address indexed to, uint256 value);
  event Approval(address indexed owner, address indexed spender, uint256 value);
  event Burned(address indexed from, address indexed recipientOnSource, uint256 amount, bytes32 nonce);

  constructor(string memory _name, string memory _symbol, uint8 _decimals, address _bridgeMinter) {
    name = _name;
    symbol = _symbol;
    decimals = _decimals;
    bridgeMinter = _bridgeMinter;
  }

  function approve(address spender, uint256 amount) external returns (bool) {
    allowance[msg.sender][spender] = amount;
    emit Approval(msg.sender, spender, amount);
    return true;
  }

  function transfer(address to, uint256 amount) external returns (bool) {
    _transfer(msg.sender, to, amount);
    return true;
  }

  function transferFrom(address from, address to, uint256 amount) external returns (bool) {
    uint256 a = allowance[from][msg.sender];
    require(a >= amount, "allowance");
    unchecked {
      allowance[from][msg.sender] = a - amount;
    }
    _transfer(from, to, amount);
    return true;
  }

  function mint(address to, uint256 amount) external {
    require(msg.sender == bridgeMinter, "not minter");
    totalSupply += amount;
    balanceOf[to] += amount;
    emit Transfer(address(0), to, amount);
  }

  function burn(uint256 amount, address recipientOnSource, bytes32 nonce) external {
    require(balanceOf[msg.sender] >= amount, "balance");
    unchecked {
      balanceOf[msg.sender] -= amount;
      totalSupply -= amount;
    }
    emit Transfer(msg.sender, address(0), amount);
    emit Burned(msg.sender, recipientOnSource, amount, nonce);
  }

  function _transfer(address from, address to, uint256 amount) internal {
    require(balanceOf[from] >= amount, "balance");
    unchecked {
      balanceOf[from] -= amount;
      balanceOf[to] += amount;
    }
    emit Transfer(from, to, amount);
  }
}

