import type { BurnIntent, LockIntent } from '../types.js';

function trimEnv(key: string): string | undefined {
  const v = process.env[key]?.trim();
  return v || undefined;
}

/** Relayer-configured bridge operator wallets (EVM 0x + Cardano bech32 or hex payment cred). */
export function relayerBridgeEvmRecipient(): string | undefined {
  return trimEnv('RELAYER_BRIDGE_EVM_RECIPIENT');
}

export function relayerBridgeCardanoRecipient(): string | undefined {
  return trimEnv('RELAYER_BRIDGE_CARDANO_RECIPIENT');
}

/**
 * Midnight addresses are bech32 (`mn_addr…` + `1` + data). Placeholder strings like
 * `mn_addr_placeholder_…` break Mesh/CSL WASM decoders with Base58Error / UnknownSymbol.
 */
function isLikelyMidnightBech32(addr: string): boolean {
  const t = addr.trim();
  if (!t.startsWith('mn_addr')) return false;
  const sep = t.indexOf('1');
  if (sep < 0) return false;
  const data = t.slice(sep + 1);
  if (data.length < 6) return false;
  if (data.includes('_')) return false;
  return true;
}

/** Midnight destination (shielded/unshielded bech32) when `RELAYER_CARDANO_RECIPIENT_STUB` is unset. */
export function relayerBridgeMidnightRecipient(): string | undefined {
  const raw = trimEnv('RELAYER_BRIDGE_MIDNIGHT_RECIPIENT');
  if (!raw) return undefined;
  if (/placeholder/i.test(raw)) return undefined;
  if (!isLikelyMidnightBech32(raw)) return undefined;
  return raw;
}

export function relayerBridgeSnapshot(): {
  evmRecipient?: string;
  cardanoRecipient?: string;
  midnightRecipient?: string;
  configured: { evm: boolean; cardano: boolean; midnight: boolean };
} {
  const evmRecipient = relayerBridgeEvmRecipient();
  const cardanoRecipient = relayerBridgeCardanoRecipient();
  const midnightRecipient = relayerBridgeMidnightRecipient();
  return {
    ...(evmRecipient ? { evmRecipient } : {}),
    ...(cardanoRecipient ? { cardanoRecipient } : {}),
    ...(midnightRecipient ? { midnightRecipient } : {}),
    configured: {
      evm: Boolean(evmRecipient),
      cardano: Boolean(cardanoRecipient),
      midnight: Boolean(midnightRecipient),
    },
  };
}

/** Attach relayer bridge wallet addresses to `connected` for tracing and UI quick-fill. */
export function mergeRelayerBridgeIntoConnected<T extends LockIntent | BurnIntent>(intent: T): void {
  const evm = relayerBridgeEvmRecipient();
  const ada = relayerBridgeCardanoRecipient();
  const mid = relayerBridgeMidnightRecipient();
  if (!evm && !ada && !mid) return;
  intent.connected = {
    ...intent.connected,
    relayerBridge: {
      ...(evm ? { evmRecipient: evm } : {}),
      ...(ada ? { cardanoRecipient: ada } : {}),
      ...(mid ? { midnightRecipient: mid } : {}),
    },
  };
}

export function effectiveLockRecipient(body: LockIntent): string | undefined {
  const t = body.recipient?.trim();
  if (t) return t;
  const evm = relayerBridgeEvmRecipient();
  const ada = relayerBridgeCardanoRecipient();
  if (body.sourceChain === 'midnight') return evm || ada;
  return undefined;
}

export function effectiveBurnRecipient(body: BurnIntent): string | undefined {
  const t = body.recipient?.trim();
  if (t) return t;
  const evm = relayerBridgeEvmRecipient();
  const ada = relayerBridgeCardanoRecipient();
  if (body.sourceChain === 'evm') return evm;
  if (body.sourceChain === 'cardano') return ada;
  if (body.sourceChain === 'midnight') return evm || ada;
  return undefined;
}
