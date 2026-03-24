#!/usr/bin/env node
/**
 * Writes VITE_CARDANO_WUSDC_UNIT / VITE_CARDANO_WUSDT_UNIT into zk-stables-ui/.env.development
 * from the same forging policy the relayer uses: ForgeScript.withOneSignature(operatorChangeAddress).
 *
 * Resolution order for the operator payment address:
 * 1. RELAYER_DEMO_CARDANO_ADDRESS_SRC in zk-stables-relayer/.env (documented as same mnemonic as bridge wallet)
 * 2. MeshWallet.getChangeAddress() after loading RELAYER_CARDANO_WALLET_MNEMONIC + RELAYER_YACI_URL
 *
 * Usage (from repo root): npm run sync-cardano-units -w @zk-stables/ui
 * Optional: RELAYER_ENV=/path/to/.env node scripts/sync-cardano-native-units.mjs
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const uiRoot = join(__dirname, '..');
const defaultRelayerEnv = join(uiRoot, '..', 'zk-stables-relayer', '.env');
const targetEnv = join(uiRoot, '.env.development');

function loadEnvFile(path) {
  if (!existsSync(path)) {
    throw new Error(`Env file not found: ${path}`);
  }
  const text = readFileSync(path, 'utf8');
  /** @type {Record<string, string>} */
  const out = {};
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq <= 0) continue;
    const key = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    out[key] = v;
  }
  return out;
}

function replaceEnvLine(text, key, value) {
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, 'm');
  if (re.test(text)) return text.replace(re, line);
  return `${text.replace(/\s*$/, '')}\n${line}\n`;
}

function tokenAscii(env, asset) {
  const o = env.RELAYER_CARDANO_MINT_TOKEN_NAME?.trim();
  if (o) return o;
  return asset === 'USDT' ? 'WUSDT' : 'WUSDC';
}

async function resolveOperatorAddress(env) {
  const demo = env.RELAYER_DEMO_CARDANO_ADDRESS_SRC?.trim();
  if (demo && (demo.startsWith('addr_test1') || demo.startsWith('addr1'))) {
    return { address: demo, source: 'RELAYER_DEMO_CARDANO_ADDRESS_SRC' };
  }

  const { MeshWallet, YaciProvider } = await import('@meshsdk/core');
  const wordsRaw = (env.RELAYER_CARDANO_WALLET_MNEMONIC ?? env.CARDANO_WALLET_MNEMONIC ?? '').trim();
  const words = wordsRaw.split(/\s+/u).filter(Boolean);
  if (words.length < 12) {
    throw new Error(
      'No RELAYER_DEMO_CARDANO_ADDRESS_SRC and no RELAYER_CARDANO_WALLET_MNEMONIC — cannot derive policy id.',
    );
  }
  const yaci = (env.RELAYER_YACI_URL ?? env.YACI_URL ?? '').trim();
  if (!yaci) {
    throw new Error(
      'Set RELAYER_YACI_URL in zk-stables-relayer/.env (or RELAYER_DEMO_CARDANO_ADDRESS_SRC for offline sync).',
    );
  }
  const admin = (env.RELAYER_YACI_ADMIN_URL ?? env.YACI_ADMIN_URL ?? '').trim();
  const fs = new YaciProvider(yaci, admin || undefined);
  const networkId = Number(env.RELAYER_CARDANO_NETWORK_ID ?? env.CARDANO_NETWORK_ID ?? 0) === 1 ? 1 : 0;
  const wallet = new MeshWallet({
    networkId,
    fetcher: fs,
    submitter: fs,
    key: { type: 'mnemonic', words },
  });
  const change = wallet.getChangeAddress()?.trim();
  if (!change) throw new Error('MeshWallet.getChangeAddress() empty');
  return { address: change, source: 'MeshWallet.getChangeAddress()' };
}

async function main() {
  const relayerPath = process.env.RELAYER_ENV?.trim() || defaultRelayerEnv;
  const relayerEnv = loadEnvFile(relayerPath);

  const { ForgeScript, resolveScriptHash, stringToHex } = await import('@meshsdk/core');
  const { address: change, source } = await resolveOperatorAddress(relayerEnv);
  const forgingScript = ForgeScript.withOneSignature(change);
  const policyId = resolveScriptHash(forgingScript);

  const wusdcName = tokenAscii(relayerEnv, 'USDC');
  const wusdtName = tokenAscii(relayerEnv, 'USDT');
  const wusdcUnit = `${policyId}${stringToHex(wusdcName)}`.toLowerCase();
  const wusdtUnit = `${policyId}${stringToHex(wusdtName)}`.toLowerCase();

  let envText = readFileSync(targetEnv, 'utf8');
  envText = replaceEnvLine(envText, 'VITE_CARDANO_WUSDC_UNIT', wusdcUnit);
  envText = replaceEnvLine(envText, 'VITE_CARDANO_WUSDT_UNIT', wusdtUnit);
  writeFileSync(targetEnv, envText);

  console.log(`Operator address (${source}): ${change.slice(0, 18)}…`);
  console.log(`Policy id: ${policyId}`);
  console.log(`WUSDC ASCII: ${wusdcName} → VITE_CARDANO_WUSDC_UNIT=${wusdcUnit}`);
  console.log(`WUSDT ASCII: ${wusdtName} → VITE_CARDANO_WUSDT_UNIT=${wusdtUnit}`);
  console.log(`Updated ${targetEnv}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
