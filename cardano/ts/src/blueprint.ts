import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Relative to compiled file location: dist/ or src/ → ../aiken/plutus.json */
export function loadBlueprintPath(): string {
  return join(__dirname, '..', '..', 'aiken', 'plutus.json');
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
  const path = loadBlueprintPath();
  const raw = readFileSync(path, 'utf8');
  return JSON.parse(raw) as PlutusBlueprint;
}

/** Spend validator entry titles from `aiken build` output. */
export function lockPoolSpendCode(bp: PlutusBlueprint): string {
  const v = bp.validators.find((x) => x.title === 'lock_pool.lock_pool.spend');
  if (!v?.compiledCode) throw new Error('lock_pool.lock_pool.spend not found in plutus.json — run `aiken build` in cardano/aiken');
  return v.compiledCode;
}

export function unlockPoolSpendCode(bp: PlutusBlueprint): string {
  const v = bp.validators.find((x) => x.title === 'unlock_pool.unlock_pool.spend');
  if (!v?.compiledCode) throw new Error('unlock_pool.unlock_pool.spend not found in plutus.json');
  return v.compiledCode;
}
