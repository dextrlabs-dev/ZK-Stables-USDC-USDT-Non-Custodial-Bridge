/**
 * Mint demo zkUSDC / zkUSDT to the first 3 Hardhat signers via BridgeVerifierMock + ZkStablesBridgeMint.
 * Use after deploy when you did not re-run deploy-anvil.js (or balances were burned).
 *
 *   ADDRS_JSON=/tmp/zk-stables-anvil-addrs.json npx hardhat run scripts/seed-wrapped-balances-anvil.js --network anvil
 */
const fs = require("fs");
const { ethers } = require("hardhat");

async function main() {
  const path = process.env.ADDRS_JSON || "/tmp/zk-stables-anvil-addrs.json";
  const raw = fs.readFileSync(path, "utf8");
  const j = JSON.parse(raw);
  if (!j.bridgeMint || !j.wUSDC || !j.wUSDT) {
    throw new Error(`Missing bridgeMint / wUSDC / wUSDT in ${path}`);
  }

  const bridgeMint = await ethers.getContractAt("ZkStablesBridgeMint", j.bridgeMint);
  const signers = await ethers.getSigners();
  const seedAccounts = signers.slice(0, 3);
  const seedAmount = 1_000_000_000n;

  for (let i = 0; i < seedAccounts.length; i++) {
    const to = seedAccounts[i].address;
    const nDc = ethers.id(`zkstables-anvil-seed-wusdc-${i}-${Date.now()}`);
    const nDt = ethers.id(`zkstables-anvil-seed-wusdt-${i}-${Date.now()}`);
    await (await bridgeMint.mintWrapped(j.wUSDC, to, seedAmount, nDc, "0x", ethers.ZeroHash)).wait();
    await (await bridgeMint.mintWrapped(j.wUSDT, to, seedAmount, nDt, "0x", ethers.ZeroHash)).wait();
    console.log("seeded", to, "zkUSDC+zkUSDT", seedAmount.toString());
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
