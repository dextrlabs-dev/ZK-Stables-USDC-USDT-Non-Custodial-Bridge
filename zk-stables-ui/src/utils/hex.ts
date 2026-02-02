import { Buffer } from 'buffer';

export function uint8ArrayToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function hexToUint8Array(hex: string): Uint8Array {
  const cleaned = hex.replace(/^0x/, '');
  if (cleaned.length % 2 !== 0) throw new Error('invalid hex length');
  const matches = cleaned.match(/.{1,2}/g);
  if (!matches) return new Uint8Array();
  return new Uint8Array(matches.map((byte) => parseInt(byte, 16)));
}

export function hexToBytes32(hex: string): Uint8Array {
  const b = hexToUint8Array(hex);
  if (b.length !== 32) throw new Error('expected 32 bytes (64 hex chars)');
  return b;
}

export function hexStringToBuffer(hex: string): Buffer {
  return Buffer.from(hex.replace(/^0x/, ''), 'hex');
}
