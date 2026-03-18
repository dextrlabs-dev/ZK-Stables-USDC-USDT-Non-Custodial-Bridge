/**
 * Pure ESM port of base32-encoding@1.0.0 (ISC, emilbayes/base32-encoding).
 * A path import of the CJS `index.js` inlines bare `exports` into TLA-wrapped chunks → ReferenceError.
 */
import { Buffer } from 'buffer';

const std = '23456789abcdefghijkmnpqrstuvwxyz';

function fromMapped(buf: number[], map: (x: number) => string): string[] {
  const a: string[] = new Array(buf.length);
  for (let i = 0; i < a.length; i++) a[i] = map(buf[i]!);
  return a;
}

function stringify(buf: Buffer | Uint8Array, alphabet?: string | null): string {
  const alpha = alphabet == null ? std : alphabet;
  return fromMapped([...encode(buf)], (b) => alpha[b]!).join('');
}

function parse(str: string, alphabet?: string | null): Buffer {
  const alpha = alphabet == null ? std : alphabet;
  return decode(str.split('').map((s) => alpha.indexOf(s)));
}

interface EncodeFn {
  (buf: Buffer | Uint8Array, arr?: Buffer, offset?: number): Buffer;
  bytes: number;
}

const encode: EncodeFn = Object.assign(
  function encode(buf: Buffer | Uint8Array, arr?: Buffer, offset?: number): Buffer {
  const encBytes = Math.ceil(buf.length * 8 / 5);
  (encode as EncodeFn).bytes = encBytes;
  const out = arr ?? Buffer.alloc(encBytes);
  const off = offset ?? 0;
  let i = 0;
  let j = off;
  for (; i + 5 <= buf.length; i += 5, j += 8) {
    out[j + 0] = (buf[i + 0]! & 0b11111000) >>> 3;
    out[j + 1] = ((buf[i + 0]! & 0b00000111) << 2) | ((buf[i + 1]! & 0b11000000) >>> 6);
    out[j + 2] = (buf[i + 1]! & 0b00111110) >>> 1;
    out[j + 3] = ((buf[i + 1]! & 0b00000001) << 4) | ((buf[i + 2]! & 0b11110000) >>> 4);
    out[j + 4] = ((buf[i + 2]! & 0b00001111) << 1) | ((buf[i + 3]! & 0b10000000) >>> 7);
    out[j + 5] = (buf[i + 3]! & 0b01111100) >>> 2;
    out[j + 6] = ((buf[i + 3]! & 0b00000011) << 3) | ((buf[i + 4]! & 0b11100000) >>> 5);
    out[j + 7] = buf[i + 4]! & 0b00011111;
  }
  {
    const r = buf.length - i;
    if (r >= 4) {
      out[j + 4] |= (buf[i + 3]! & 0b10000000) >>> 7;
      out[j + 5] |= (buf[i + 3]! & 0b01111100) >>> 2;
      out[j + 6] |= (buf[i + 3]! & 0b00000011) << 3;
    }
    if (r >= 3) {
      out[j + 3] |= (buf[i + 2]! & 0b11110000) >>> 4;
      out[j + 4] |= (buf[i + 2]! & 0b00001111) << 1;
    }
    if (r >= 2) {
      out[j + 1] |= (buf[i + 1]! & 0b11000000) >>> 6;
      out[j + 2] |= (buf[i + 1]! & 0b00111110) >>> 1;
      out[j + 3] |= (buf[i + 1]! & 0b00000001) << 4;
    }
    if (r >= 1) {
      out[j + 0] |= (buf[i + 0]! & 0b11111000) >>> 3;
      out[j + 1] |= (buf[i + 0]! & 0b00000111) << 2;
    }
  }
  return out;
},
  { bytes: 0 },
);

interface DecodeFn {
  (buf: ArrayLike<number>, arr?: Buffer, offset?: number): Buffer;
  bytes: number;
}

const decode: DecodeFn = Object.assign(
  function decode(buf: ArrayLike<number>, arr?: Buffer, offset?: number): Buffer {
  const decBytes = Math.floor(buf.length * 5 / 8);
  (decode as DecodeFn).bytes = decBytes;
  const out = arr ?? Buffer.alloc(decBytes);
  const off = offset ?? 0;
  let i = 0;
  let j = off;
  for (; i + 8 <= buf.length; i += 8, j += 5) {
    out[j + 0] = ((buf[i + 0]! << 3) & 255) | ((buf[i + 1]! >>> 2) & 255);
    out[j + 1] = ((buf[i + 1]! << 6) & 255) | ((buf[i + 2]! << 1) & 255) | ((buf[i + 3]! >>> 4) & 255);
    out[j + 2] = ((buf[i + 3]! << 4) & 255) | ((buf[i + 4]! >>> 1) & 255);
    out[j + 3] = ((buf[i + 4]! << 7) & 255) | ((buf[i + 5]! << 2) & 255) | ((buf[i + 6]! >> 3) & 255);
    out[j + 4] = ((buf[i + 6]! << 5) & 255) | (buf[i + 7]! & 255);
  }
  {
    const r = buf.length - i;
    if (r >= 7) {
      out[j + 3] |= (buf[i + 6]! >> 3) & 255;
      out[j + 4] |= (buf[i + 6]! << 5) & 255;
    }
    if (r >= 6) {
      out[j + 3] |= (buf[i + 5]! << 2) & 255;
    }
    if (r >= 5) {
      out[j + 2] |= (buf[i + 4]! >>> 1) & 255;
      out[j + 3] |= (buf[i + 4]! << 7) & 255;
    }
    if (r >= 4) {
      out[j + 1] |= (buf[i + 3]! >>> 4) & 255;
      out[j + 2] |= (buf[i + 3]! << 4) & 255;
    }
    if (r >= 3) {
      out[j + 1] |= (buf[i + 2]! << 1) & 255;
    }
    if (r >= 2) {
      out[j + 0] |= (buf[i + 1]! >>> 2) & 255;
      out[j + 1] |= (buf[i + 1]! << 6) & 255;
    }
    if (r >= 1) {
      out[j + 0] |= (buf[i + 0]! << 3) & 255;
    }
  }
  return out;
},
  { bytes: 0 },
);

function encodingLength(buf: Buffer | Uint8Array): number {
  return Math.ceil(buf.length * 8 / 5);
}

export default {
  stringify,
  parse,
  encode,
  decode,
  encodingLength,
};
