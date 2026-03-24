const { ethers } = require("hardhat");
async function main() {
  const addrs = require("/tmp/zk-stables-anvil-addrs.json");
  const usdc = await ethers.getContractAt("IERC20", addrs.usdc);
  const usdt = await ethers.getContractAt("IERC20", addrs.usdt);
  const poolUSDC = await usdc.balanceOf(addrs.poolLock);
  const poolUSDT = await usdt.balanceOf(addrs.poolLock);
  const bn = await ethers.provider.getBlockNumber();
  console.log(JSON.stringify({
    blockNumber: bn,
    poolLock: addrs.poolLock,
    poolUSDC_raw: poolUSDC.toString(),
    poolUSDT_raw: poolUSDT.toString()
  }));
}
main();
