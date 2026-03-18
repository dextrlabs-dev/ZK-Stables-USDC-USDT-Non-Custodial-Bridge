const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("deployer", deployer.address);

  const Verifier = await ethers.getContractFactory("BridgeVerifierMock");
  const verifier = await Verifier.deploy();
  await verifier.waitForDeployment();

  const BridgeMint = await ethers.getContractFactory("ZkStablesBridgeMint");
  const bridgeMint = await BridgeMint.deploy(await verifier.getAddress());
  await bridgeMint.waitForDeployment();

  const Mock = await ethers.getContractFactory("MockERC20");
  const usdc = await Mock.deploy("Mock USDC", "mUSDC", 6);
  await usdc.waitForDeployment();
  const usdt = await Mock.deploy("Mock USDT", "mUSDT", 6);
  await usdt.waitForDeployment();

  const PoolLock = await ethers.getContractFactory("ZkStablesPoolLock");
  const pool = await PoolLock.deploy();
  await pool.waitForDeployment();

  const Wrapped = await ethers.getContractFactory("ZkStablesWrappedToken");
  // Symbols zkUSDC / zkUSDT: proof-verified bridge mint on destination, not same-chain “wrap”.
  const wUSDC = await Wrapped.deploy("ZK USDC", "zkUSDC", 6, await bridgeMint.getAddress());
  await wUSDC.waitForDeployment();
  const wUSDT = await Wrapped.deploy("ZK USDT", "zkUSDT", 6, await bridgeMint.getAddress());
  await wUSDT.waitForDeployment();

  await (await usdc.mint(deployer.address, 1_000_000_000)).wait();
  await (await usdt.mint(deployer.address, 1_000_000_000)).wait();

  // Seed zkUSDC / zkUSDT for the first Hardhat accounts (UI mock wallets) so REDEEM → burn works without a prior LOCK→mint.
  const signers = await ethers.getSigners();
  const seedAccounts = signers.slice(0, 3);
  const seedAmount = 1_000_000_000n; // 1000 units @ 6 decimals each
  for (let i = 0; i < seedAccounts.length; i++) {
    const to = seedAccounts[i].address;
    const nDc = ethers.id(`zkstables-anvil-seed-wusdc-${i}`);
    const nDt = ethers.id(`zkstables-anvil-seed-wusdt-${i}`);
    await (
      await bridgeMint.mintWrapped(await wUSDC.getAddress(), to, seedAmount, nDc, "0x", ethers.ZeroHash)
    ).wait();
    await (
      await bridgeMint.mintWrapped(await wUSDT.getAddress(), to, seedAmount, nDt, "0x", ethers.ZeroHash)
    ).wait();
  }

  // Optional: seed an additional recipient to demo end-to-end flows without relying on an unowned address.
  const demoRecipient = process.env.DEMO_RECIPIENT;
  if (demoRecipient) {
    await (await usdc.mint(demoRecipient, 100_000_000)).wait();
    await (await usdt.mint(demoRecipient, 100_000_000)).wait();
  }

  const addrs = {
    verifier: await verifier.getAddress(),
    bridgeMint: await bridgeMint.getAddress(),
    poolLock: await pool.getAddress(),
    usdc: await usdc.getAddress(),
    usdt: await usdt.getAddress(),
    wUSDC: await wUSDC.getAddress(),
    wUSDT: await wUSDT.getAddress(),
  };

  console.log(JSON.stringify(addrs, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

