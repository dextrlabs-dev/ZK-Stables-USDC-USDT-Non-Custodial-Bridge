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
  const wUSDC = await Wrapped.deploy("Wrapped USDC", "wUSDC", 6, await bridgeMint.getAddress());
  await wUSDC.waitForDeployment();
  const wUSDT = await Wrapped.deploy("Wrapped USDT", "wUSDT", 6, await bridgeMint.getAddress());
  await wUSDT.waitForDeployment();

  await (await usdc.mint(deployer.address, 1_000_000_000)).wait();
  await (await usdt.mint(deployer.address, 1_000_000_000)).wait();

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

