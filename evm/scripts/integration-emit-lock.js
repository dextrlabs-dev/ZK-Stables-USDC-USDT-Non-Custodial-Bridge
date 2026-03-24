/**
 * After deploy-anvil.js, approve USDC and call ZkStablesPoolLock.lock so the relayer EVM lock watcher
 * ingests a real `Locked` event (anchored lockRef: evm:txHash:logIndex).
 *
 * Usage:
 *   DEPLOY_ADDRS_JSON=/tmp/zk-stables-anvil-addrs.json npx hardhat run scripts/integration-emit-lock.js --network localhost
 * Optional: LOCK_TOKEN=usdt (default usdc) to lock mock USDT instead of USDC.
 */
const fs = require("fs");
const { ethers } = require("hardhat");

async function main() {
  const path = process.env.DEPLOY_ADDRS_JSON || "/tmp/zk-stables-anvil-addrs.json";
  const addrs = JSON.parse(fs.readFileSync(path, "utf8"));
  const [signer] = await ethers.getSigners();
  const recipient = process.env.LOCK_RECIPIENT_EVM || signer.address;
  const amount = BigInt(process.env.LOCK_AMOUNT_RAW || "1000000"); // 1 USDC @ 6 decimals

  const tokenKey = (process.env.LOCK_TOKEN || "usdc").toLowerCase() === "usdt" ? "usdt" : "usdc";
  const tokenAddr = tokenKey === "usdt" ? addrs.usdt : addrs.usdc;
  const erc20 = await ethers.getContractAt("MockERC20", tokenAddr);
  const pool = await ethers.getContractAt("ZkStablesPoolLock", addrs.poolLock);

  const nonce = ethers.keccak256(
    ethers.toUtf8Bytes(`zk-stables-integration-${tokenKey}-${Date.now()}`),
  );

  await (await erc20.approve(addrs.poolLock, amount)).wait();
  const tx = await pool.lock(tokenAddr, amount, recipient, nonce);
  const receipt = await tx.wait();

  let logIndex = null;
  const poolLc = String(addrs.poolLock).toLowerCase();
  for (const log of receipt.logs) {
    if (String(log.address).toLowerCase() !== poolLc) continue;
    try {
      const parsed = pool.interface.parseLog({ topics: log.topics, data: log.data });
      if (parsed?.name === "Locked") {
        logIndex = log.index;
        break;
      }
    } catch (_) {
      /* not Locked */
    }
  }
  if (logIndex === null) {
    throw new Error("ZkStablesPoolLock Locked event not found in receipt logs");
  }

  const out = {
    token: tokenKey,
    underlyingToken: tokenAddr,
    txHash: receipt.hash,
    logIndex,
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
