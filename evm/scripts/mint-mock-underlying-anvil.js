/**
 * Mint MockERC20 mUSDC / mUSDT to standard Anvil accounts + optional pool lock (for unlock demos).
 *
 * Token addresses (first match wins):
 * - zk-stables-relayer/.env: RELAYER_EVM_UNDERLYING_TOKEN, RELAYER_EVM_UNDERLYING_TOKEN_USDT, RELAYER_EVM_POOL_LOCK
 * - Or ADDRS_JSON (override with USE_RELAYER_ENV=0 to skip relayer file)
 * - Or zk-stables-ui/.env.development (VITE_DEMO_USDC_ADDRESS / USDT / VITE_EVM_POOL_LOCK)
 *
 *   cd evm && npx hardhat run scripts/mint-mock-underlying-anvil.js --network anvil
 *
 * Env:
 *   MOCK_MINT_PER_ACCOUNT — raw units per recipient (default: 50_000_000n * 1_000_000n = 50M tokens @ 6 decimals)
 *   MOCK_MINT_POOL_EXTRA  — extra raw units minted to pool only (default: same as per-account)
 *   MOCK_MINT_POOL_ONLY=1 — skip account mints; only mint MOCK_MINT_POOL_EXTRA to RELAYER_EVM_POOL_LOCK (fast pool top-up)
 */
const fs = require("fs");
const path = require("path");
const { ethers } = require("hardhat");

const DEFAULT_PER_ACCOUNT = 50_000_000n * 1_000_000n; // 50M * 10^6

function loadRelayerDotEnv() {
  if (process.env.USE_RELAYER_ENV === "0") return;
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

function addrsFromRelayerEnv() {
  const usdc = process.env.RELAYER_EVM_UNDERLYING_TOKEN?.trim();
  const usdt = (
    process.env.RELAYER_EVM_UNDERLYING_TOKEN_USDT ?? process.env.RELAYER_EVM_UNDERLYING_TOKEN
  )?.trim();
  const poolLock = process.env.RELAYER_EVM_POOL_LOCK?.trim();
  if (
    usdc?.startsWith("0x") &&
    usdt?.startsWith("0x") &&
    usdc.length === 42 &&
    usdt.length === 42
  ) {
    return {
      usdc,
      usdt,
      poolLock: poolLock?.startsWith("0x") && poolLock.length === 42 ? poolLock : undefined,
    };
  }
  return null;
}

function loadAddrsJson() {
  const p = process.env.ADDRS_JSON || "/tmp/zk-stables-anvil-addrs.json";
  if (!fs.existsSync(p)) return null;
  const j = JSON.parse(fs.readFileSync(p, "utf8"));
  if (j.usdc && j.usdt) return j;
  return null;
}

function parseUiEnv() {
  const envPath = path.join(__dirname, "../../zk-stables-ui/.env.development");
  if (!fs.existsSync(envPath)) return null;
  const text = fs.readFileSync(envPath, "utf8");
  const get = (key) => {
    const m = text.match(new RegExp(`^${key}=(.+)$`, "m"));
    if (!m) return null;
    let v = m[1].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    return v;
  };
  const usdc = get("VITE_DEMO_USDC_ADDRESS");
  const usdt = get("VITE_DEMO_USDT_ADDRESS");
  const poolLock = get("VITE_EVM_POOL_LOCK");
  if (!usdc || !usdt) return null;
  return { usdc, usdt, poolLock: poolLock || undefined };
}

async function main() {
  loadRelayerDotEnv();
  const addrs =
    addrsFromRelayerEnv() || loadAddrsJson() || parseUiEnv();
  if (!addrs) {
    throw new Error(
      "Set RELAYER_EVM_UNDERLYING_TOKEN in zk-stables-relayer/.env, or ADDRS_JSON, or VITE_DEMO_USDC_ADDRESS in zk-stables-ui/.env.development",
    );
  }

  const per = process.env.MOCK_MINT_PER_ACCOUNT
    ? BigInt(process.env.MOCK_MINT_PER_ACCOUNT)
    : DEFAULT_PER_ACCOUNT;
  const poolExtra = process.env.MOCK_MINT_POOL_EXTRA
    ? BigInt(process.env.MOCK_MINT_POOL_EXTRA)
    : DEFAULT_PER_ACCOUNT;

  const usdc = await ethers.getContractAt("MockERC20", addrs.usdc);
  const usdt = await ethers.getContractAt("MockERC20", addrs.usdt);
  const signers = await ethers.getSigners();
  const recipients = signers.slice(0, 10).map((s) => s.address);
  const pool = (addrs.poolLock || "").trim() || null;
  const poolOnly = process.env.MOCK_MINT_POOL_ONLY === "1" || process.env.MOCK_MINT_POOL_ONLY === "true";

  console.log("mUSDC", addrs.usdc, "mUSDT", addrs.usdt, "per account", per.toString(), poolOnly ? "(pool-only mode)" : "");

  if (!poolOnly) {
    for (const to of recipients) {
      await (await usdc.mint(to, per)).wait();
      await (await usdt.mint(to, per)).wait();
      console.log("minted mUSDC+mUSDT ->", to);
    }
  }

  if (pool && poolExtra > 0n) {
    await (await usdc.mint(pool, poolExtra)).wait();
    await (await usdt.mint(pool, poolExtra)).wait();
    console.log("pool lock top-up mUSDC+mUSDT ->", pool, poolExtra.toString());
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
