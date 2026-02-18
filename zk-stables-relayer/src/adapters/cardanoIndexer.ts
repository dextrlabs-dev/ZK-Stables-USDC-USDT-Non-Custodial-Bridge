export type CardanoIndexerMode = 'yaci' | 'blockfrost' | 'none';

function envTrim(name: string): string {
  return String(process.env[name] ?? '').trim();
}

export function resolveYaciBaseUrl(): string | undefined {
  const url = envTrim('RELAYER_YACI_URL') || envTrim('YACI_URL');
  return url !== '' ? url : undefined;
}

export function cardanoIndexerMode(): CardanoIndexerMode {
  const yaci = resolveYaciBaseUrl();
  if (yaci) return 'yaci';
  const bfId = envTrim('RELAYER_BLOCKFROST_PROJECT_ID') || envTrim('BLOCKFROST_PROJECT_ID');
  if (bfId) return 'blockfrost';
  return 'none';
}

export function blockfrostProjectId(): string | undefined {
  const bfId = envTrim('RELAYER_BLOCKFROST_PROJECT_ID') || envTrim('BLOCKFROST_PROJECT_ID');
  return bfId !== '' ? bfId : undefined;
}

export function blockfrostNetwork(): 'preprod' | 'mainnet' {
  const net = (envTrim('RELAYER_BLOCKFROST_NETWORK') || 'preprod').toLowerCase();
  return net === 'mainnet' ? 'mainnet' : 'preprod';
}

