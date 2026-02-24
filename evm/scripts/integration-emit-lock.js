/**
 * After deploy-anvil.js, approve USDC and call ZkStablesPoolLock.lock so the relayer EVM lock watcher
 * ingests a real `Locked` event (anchored lockRef: evm:txHash:logIndex).
 *
 * Usage:
 *   DEPLOY_ADDRS_JSON=/tmp/zk-stables-anvil-addrs.json npx hardhat run scripts/integration-emit-lock.js --network localhost
 */
const fs = require("fs");
const { ethers } = require("hardhat");

async function main() {
  const path = process.env.DEPLOY_ADDRS_JSON || "/tmp/zk-stables-anvil-addrs.json";
  const addrs = JSON.parse(fs.readFileSync(path, "utf8"));
  const [signer] = await ethers.getSigners();
  const recipient = process.env.LOCK_RECIPIENT_EVM || signer.address;
  const amount = BigInt(process.env.LOCK_AMOUNT_RAW || "1000000"); // 1 USDC @ 6 decimals

  const usdc = await ethers.getContractAt("MockERC20", addrs.usdc);
  const pool = await ethers.getContractAt("ZkStablesPoolLock", addrs.poolLock);

  const nonce = ethers.keccak256(ethers.toUtf8Bytes(`zk-stables-integration-${Date.now()}`));

  await (await usdc.approve(addrs.poolLock, amount)).wait();
  const tx = await pool.lock(addrs.usdc, amount, recipient, nonce);
  const receipt = await tx.wait();

  const out = {
    txHash: receipt.hash,
    blockNumber: receipt.blockNumber.toString(),
    recipient,
    amount: amount.toString(),
    poolLock: addrs.poolLock,
    nonce,
  };
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
