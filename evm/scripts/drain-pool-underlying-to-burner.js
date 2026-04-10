/**
 * Move all Mock USDC / USDT held by ZkStablesPoolLock to a burner address via owner `unlock`
 * (same path the relayer uses for operator unlocks; consumes fresh burnNonces).
 *
 * Requires `RELAYER_EVM_PRIVATE_KEY` to be the pool deployer / owner (typical Anvil account #0).
 *
 *   cd evm && npx hardhat run scripts/drain-pool-underlying-to-burner.js --network anvil
 *
 * Env (from zk-stables-relayer/.env via auto-load):
 *   RELAYER_EVM_POOL_LOCK or RELAYER_EVM_LOCK_ADDRESS — pool contract
 *   RELAYER_EVM_UNDERLYING_TOKEN, RELAYER_EVM_UNDERLYING_TOKEN_USDT
 *   RELAYER_EVM_PRIVATE_KEY — must own the pool
 * Optional:
 *   RELAYER_EVM_BURNER_ADDRESS — default 0x000000000000000000000000000000000000dEaD
 */
const fs = require("fs");
const path = require("path");
const { ethers } = require("hardhat");

const DEFAULT_BURNER = "0x000000000000000000000000000000000000dEaD";

const erc20Abi = [
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
];

const poolAbi = [
  "function owner() view returns (address)",
  "function unlock(address token,uint256 amount,address recipient,bytes32 burnNonce)",
];

function loadRelayerDotEnv() {
  const p = process.env.RELAYER_RELAYER_ENV
    ? path.resolve(process.env.RELAYER_RELAYER_ENV)
    : path.join(__dirname, "../../zk-stables-relayer/.env");
  if (!fs.existsSync(p)) return;
  const text = fs.readFileSync(p, "utf8");
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq <= 0) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined || process.env[key] === "") {
      process.env[key] = val;
    }
  }
}

async function ownerSigner() {
  const pk = process.env.RELAYER_EVM_PRIVATE_KEY?.trim();
  if (pk && /^0x[0-9a-fA-F]{64}$/u.test(pk)) {
    return new ethers.Wallet(pk, ethers.provider);
  }
  const [s0] = await ethers.getSigners();
  return s0;
}

async function main() {
  loadRelayerDotEnv();

  const poolAddr = (process.env.RELAYER_EVM_POOL_LOCK || process.env.RELAYER_EVM_LOCK_ADDRESS || "").trim();
  const usdcAddr = (process.env.RELAYER_EVM_UNDERLYING_TOKEN || "").trim();
  const usdtAddr = (
    process.env.RELAYER_EVM_UNDERLYING_TOKEN_USDT || process.env.RELAYER_EVM_UNDERLYING_TOKEN || ""
  ).trim();
  const burner = (process.env.RELAYER_EVM_BURNER_ADDRESS || DEFAULT_BURNER).trim();

  if (!poolAddr.startsWith("0x") || poolAddr.length !== 42) {
    throw new Error("Set RELAYER_EVM_POOL_LOCK or RELAYER_EVM_LOCK_ADDRESS (42-char 0x address)");
  }
  if (!usdcAddr.startsWith("0x") || usdcAddr.length !== 42) {
    throw new Error("Set RELAYER_EVM_UNDERLYING_TOKEN");
  }
  if (!usdtAddr.startsWith("0x") || usdtAddr.length !== 42) {
    throw new Error("Set RELAYER_EVM_UNDERLYING_TOKEN_USDT (or share USDC token if single mock)");
  }
  if (!burner.startsWith("0x") || burner.length !== 42) {
    throw new Error("RELAYER_EVM_BURNER_ADDRESS must be 42-char 0x address");
  }

  const signer = await ownerSigner();
  const pool = new ethers.Contract(poolAddr, poolAbi, signer);
  const onChainOwner = await pool.owner();
  if (onChainOwner.toLowerCase() !== signer.address.toLowerCase()) {
    throw new Error(
      `Signer ${signer.address} is not pool owner ${onChainOwner}. Use deployer / pool owner private key.`,
    );
  }

  const usdc = new ethers.Contract(usdcAddr, erc20Abi, ethers.provider);
  const usdt = new ethers.Contract(usdtAddr, erc20Abi, ethers.provider);

  const rows = [
    { label: "USDC", token: usdcAddr, c: usdc },
    { label: "USDT", token: usdtAddr, c: usdt },
  ];

  for (const { label, token, c } of rows) {
    const bal = await c.balanceOf(poolAddr);
    if (bal === 0n) {
      console.log(`${label}: pool balance 0, skip`);
      continue;
    }
    const dec = await c.decimals().catch(() => 6);
    console.log(`${label}: draining`, bal.toString(), "raw units (decimals", dec, ") ->", burner);
    const burnNonce = ethers.keccak256(ethers.toUtf8Bytes(`zkstables-drain-pool-${label}-${Date.now()}`));
    const tx = await pool.unlock(token, bal, burner, burnNonce);
    await tx.wait();
    console.log(`${label}: tx`, tx.hash);
  }

  console.log("done");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
