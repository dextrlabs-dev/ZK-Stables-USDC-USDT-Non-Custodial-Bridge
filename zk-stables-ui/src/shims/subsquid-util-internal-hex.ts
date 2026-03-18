/**
 * @subsquid/util-internal-hex ships CJS with bare `exports`; in the merged vendor chunk
 * Rollup can leave `exports` unreplaced → ReferenceError in the browser.
 */
import { Buffer } from 'buffer';

export function toHex(data: Buffer | ArrayBufferView): string {
  if (Buffer.isBuffer(data)) {
    return '0x' + data.toString('hex');
  }
  const v = data as ArrayBufferView;
  return '0x' + Buffer.from(v.buffer, v.byteOffset, v.byteLength).toString('hex');
}

export function isHex(value: unknown): value is string {
  return typeof value === 'string' && value.length % 2 === 0 && /^0x[a-f\d]*$/i.test(value);
}

export function decodeHex(value: string): Buffer {
  if (!isHex(value)) {
    throw new Error('Expected hex value');
  }
  return Buffer.from(value.slice(2), 'hex');
}
