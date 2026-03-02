import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Path to `aiken build` output (validators). Override with `RELAYER_CARDANO_PLUTUS_JSON`. */
export function resolvePlutusJsonPath(): string {
  const env = process.env.RELAYER_CARDANO_PLUTUS_JSON?.trim();
  if (env) return env;
  return join(__dirname, '../../../../cardano/aiken/plutus.json');
}

export type PlutusBlueprint = {
  validators: Array<{
    title: string;
    compiledCode: string;
    hash?: string;
    parameters?: unknown[];
  }>;
};

export function loadBlueprint(): PlutusBlueprint {
  const path = resolvePlutusJsonPath();
  const raw = readFileSync(path, 'utf8');
  return JSON.parse(raw) as PlutusBlueprint;
}

export function lockPoolSpendCode(bp: PlutusBlueprint): string {
  const v = bp.validators.find((x) => x.title === 'lock_pool.lock_pool.spend');
  if (!v?.compiledCode) {
    throw new Error(
      'lock_pool.lock_pool.spend not found in plutus.json — run `aiken build` in cardano/aiken (see RELAYER_CARDANO_PLUTUS_JSON)',
    );
  }
  return v.compiledCode;
}
