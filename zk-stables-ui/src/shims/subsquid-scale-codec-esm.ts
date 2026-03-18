/**
 * Browser ESM replacement for @subsquid/scale-codec (CJS + bare `exports` breaks in TLA-wrapped vendor).
 * Covers what @midnight-ntwrk/wallet-sdk-address-format needs: ByteSink, Src (+ Sink base).
 * Logic matches @subsquid/scale-codec@4.0.1 lib/{util,sink,src}.js (GPL-3.0-or-later).
 */
import { Buffer } from 'buffer';
import { decodeHex } from './subsquid-util-internal-hex';

function assertLite(condition: unknown, msg?: string): asserts condition {
  if (!condition) throw new Error(msg ?? 'Assertion failed');
}

function throwUnexpectedCase(val: unknown): never {
  throw new Error(val ? `Unexpected case: ${val}` : `Unexpected case`);
}

function checkInt(val: number, sign: string, bitSize: number, min: number, max: number) {
  const ok = Number.isInteger(val) && min <= val && max >= val;
  if (!ok) throw new Error(`Invalid ${sign}${bitSize}: ${val}`);
}

function checkBigInt(val: bigint, sign: string, bitSize: number, min: bigint, max: bigint) {
  const ok = typeof val === 'bigint' && min <= val && max >= val;
  if (!ok) throw new Error(`Invalid ${sign}${bitSize}: ${val}`);
}

export function checkSignedInt(val: number, bitSize: 8 | 16 | 32) {
  let min: number;
  let max: number;
  switch (bitSize) {
    case 8:
      min = -0x80;
      max = 0x7f;
      break;
    case 16:
      min = -0x8000;
      max = 0x7fff;
      break;
    case 32:
      min = -0x80000000;
      max = 0x7fffffff;
      break;
    default:
      throwUnexpectedCase(bitSize);
  }
  checkInt(val, 'I', bitSize, min, max);
}

export function checkSignedBigInt(val: bigint, bitSize: 64 | 128 | 256) {
  let min: bigint;
  let max: bigint;
  switch (bitSize) {
    case 64:
      min = -(2n ** 63n);
      max = 2n ** 63n - 1n;
      break;
    case 128:
      min = -(2n ** 127n);
      max = 2n ** 127n - 1n;
      break;
    case 256:
      min = -(2n ** 255n);
      max = 2n ** 255n - 1n;
      break;
    default:
      throwUnexpectedCase(bitSize);
  }
  checkBigInt(val, 'I', bitSize, min, max);
}

export function checkUnsignedInt(val: number, bitSize: 8 | 16 | 32) {
  let max: number;
  switch (bitSize) {
    case 8:
      max = 0xff;
      break;
    case 16:
      max = 0xffff;
      break;
    case 32:
      max = 0xffffffff;
      break;
    default:
      throwUnexpectedCase(bitSize);
  }
  checkInt(val, 'U', bitSize, 0, max);
}

export function checkUnsignedBigInt(val: bigint, bitSize: 64 | 128 | 256) {
  let max: bigint;
  switch (bitSize) {
    case 64:
      max = 0xffffffffffffffffn;
      break;
    case 128:
      max = 2n ** 128n - 1n;
      break;
    case 256:
      max = 2n ** 256n - 1n;
      break;
    default:
      throwUnexpectedCase(bitSize);
  }
  checkBigInt(val, 'U', bitSize, 0n, max);
}

export function unsignedIntByteLength(val: bigint): number {
  let len = 0;
  let v = val;
  while (v > 0n) {
    v >>= 8n;
    len += 1;
  }
  return len;
}

export const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false });
export const UTF8_ENCODER = new TextEncoder();

export abstract class Sink {
  abstract write(byte: number): void;
  abstract bytes(b: Buffer | Uint8Array): void;

  uncheckedU16(val: number) {
    this.write(val & 0xff);
    this.write(val >>> 8);
  }
  uncheckedU32(val: number) {
    this.write(val & 0xff);
    this.write((val >>> 8) & 0xff);
    this.write((val >>> 16) & 0xff);
    this.write(val >>> 24);
  }
  uncheckedU64(val: bigint) {
    this.uncheckedU32(Number(val & 0xffffffffn));
    this.uncheckedU32(Number(val >> 32n));
  }
  uncheckedU128(val: bigint) {
    this.uncheckedU64(val & 0xffffffffffffffffn);
    this.uncheckedU64(val >> 64n);
  }
  uncheckedU256(val: bigint) {
    this.uncheckedU128(val & (2n ** 128n - 1n));
    this.uncheckedU128(val >> 128n);
  }
  u8(val: number) {
    checkUnsignedInt(val, 8);
    this.write(val);
  }
  u16(val: number) {
    checkUnsignedInt(val, 16);
    this.uncheckedU16(val);
  }
  u32(val: number) {
    checkUnsignedInt(val, 32);
    this.uncheckedU32(val);
  }
  u64(val: bigint) {
    checkUnsignedBigInt(val, 64);
    this.uncheckedU64(val);
  }
  u128(val: bigint) {
    checkUnsignedBigInt(val, 128);
    this.uncheckedU128(val);
  }
  u256(val: bigint) {
    checkUnsignedBigInt(val, 256);
    this.uncheckedU256(val);
  }
  i8(val: number) {
    checkSignedInt(val, 8);
    this.write((val + 256) % 256);
  }
  i16(val: number) {
    checkSignedInt(val, 16);
    const base = 2 ** 16;
    const v = (val + base) % base;
    this.uncheckedU16(v);
  }
  i32(val: number) {
    checkSignedInt(val, 32);
    const base = 2 ** 32;
    const v = (val + base) % base;
    this.uncheckedU32(v);
  }
  i64(val: bigint) {
    checkSignedBigInt(val, 64);
    const base = 2n ** 64n;
    const v = (val + base) % base;
    this.uncheckedU64(v);
  }
  i128(val: bigint) {
    checkSignedBigInt(val, 128);
    const base = 2n ** 128n;
    const v = (val + base) % base;
    this.uncheckedU128(v);
  }
  i256(val: bigint) {
    checkSignedBigInt(val, 256);
    const base = 2n ** 256n;
    const v = (val + base) % base;
    this.uncheckedU256(v);
  }
  str(val: string) {
    assertLite(typeof val === 'string');
    const bytes = UTF8_ENCODER.encode(val);
    this.compact(bytes.length);
    this.bytes(bytes);
  }
  bool(val: boolean) {
    assertLite(typeof val === 'boolean');
    this.write(Number(val));
  }
  compact(val: number | bigint) {
    assertLite((typeof val === 'number' || typeof val === 'bigint') && val >= 0, 'invalid compact');
    if (val < 64) {
      this.write(Number(val) * 4);
    } else if (val < 2 ** 14) {
      const n = Number(val);
      this.write((n & 63) * 4 + 1);
      this.write(n >>> 6);
    } else if (val < 2 ** 30) {
      const n = Number(val);
      this.write((n & 63) * 4 + 2);
      this.write((n >>> 6) & 0xff);
      this.uncheckedU16(n >>> 14);
    } else if (val < 2n ** 536n) {
      let b = BigInt(val);
      this.write(unsignedIntByteLength(b) * 4 - 13);
      while (b > 0n) {
        this.write(Number(b & 0xffn));
        b >>= 8n;
      }
    } else {
      throw new Error(`${(val as bigint).toString(16)} is too large for a compact`);
    }
  }
}

export class HexSink extends Sink {
  out = '0x';
  write(byte: number) {
    this.out += (byte >>> 4).toString(16);
    this.out += (byte & 15).toString(16);
  }
  bytes(b: Buffer | Uint8Array) {
    if (Buffer.isBuffer(b)) {
      this.out += b.toString('hex');
    } else {
      this.out += Buffer.from(b.buffer, b.byteOffset, b.byteLength).toString('hex');
    }
  }
  toHex() {
    return this.out;
  }
}

export class ByteSink extends Sink {
  buf: Buffer;
  pos = 0;
  constructor() {
    super();
    this.buf = Buffer.allocUnsafe(128);
  }
  alloc(size: number) {
    if (this.buf.length - this.pos < size) {
      const next = Buffer.allocUnsafe(Math.max(size, this.buf.length) * 2);
      next.set(this.buf);
      this.buf = next;
    }
  }
  write(byte: number) {
    this.alloc(1);
    this.buf[this.pos] = byte;
    this.pos += 1;
  }
  bytes(b: Buffer | Uint8Array) {
    this.alloc(b.length);
    this.buf.set(b, this.pos);
    this.pos += b.length;
  }
  toBytes() {
    return this.buf.subarray(0, this.pos);
  }
}

function eof() {
  return new Error('Unexpected EOF');
}

export class Src {
  buf: Buffer;
  idx = 0;
  constructor(buf: string | Buffer | Uint8Array) {
    if (typeof buf === 'string') {
      this.buf = decodeHex(buf);
    } else {
      this.buf = Buffer.isBuffer(buf) ? buf : Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
    }
  }
  byte() {
    const b = this.buf[this.idx];
    if (b === undefined) throw eof();
    this.idx += 1;
    return b;
  }
  i8() {
    const b = this.byte();
    return b | ((b & 2 ** 7) * 0x1fffffe);
  }
  u8() {
    return this.byte();
  }
  i16() {
    const val = this.u16();
    return val | ((val & 2 ** 15) * 0x1fffe);
  }
  u16() {
    const first = this.byte();
    const last = this.byte();
    return first + last * 2 ** 8;
  }
  i32() {
    return this.byte() + this.byte() * 2 ** 8 + this.byte() * 2 ** 16 + (this.byte() << 24);
  }
  u32() {
    return this.byte() + this.byte() * 2 ** 8 + this.byte() * 2 ** 16 + this.byte() * 2 ** 24;
  }
  i64() {
    const lo = this.u32();
    const hi = this.i32();
    return BigInt(lo) + (BigInt(hi) << 32n);
  }
  u64() {
    const lo = this.u32();
    const hi = this.u32();
    return BigInt(lo) + (BigInt(hi) << 32n);
  }
  i128() {
    const lo = this.u64();
    const hi = this.i64();
    return lo + (hi << 64n);
  }
  u128() {
    const lo = this.u64();
    const hi = this.u64();
    return lo + (hi << 64n);
  }
  i256() {
    const lo = this.u128();
    const hi = this.i128();
    return lo + (hi << 128n);
  }
  u256() {
    const lo = this.u128();
    const hi = this.u128();
    return lo + (hi << 128n);
  }
  compact(): number | bigint {
    const b = this.byte();
    const mode = b & 3;
    switch (mode) {
      case 0:
        return b >> 2;
      case 1:
        return (b >> 2) + this.byte() * 2 ** 6;
      case 2:
        return (b >> 2) + this.byte() * 2 ** 6 + this.byte() * 2 ** 14 + this.byte() * 2 ** 22;
      case 3:
        return this.bigCompact(b >> 2);
      default:
        throw new Error('Reached unreachable statement');
    }
  }
  bigCompact(len: number): bigint {
    const i = this.u32();
    switch (len) {
      case 0:
        return BigInt(i);
      case 1:
        return BigInt(i) + BigInt(this.byte()) * 2n ** 32n;
      case 2:
        return BigInt(i) + BigInt(this.byte()) * 2n ** 32n + BigInt(this.byte()) * 2n ** 40n;
    }
    let n = BigInt(i);
    let base = 32n;
    let l = len;
    while (l--) {
      n += BigInt(this.byte()) << base;
      base += 8n;
    }
    return n;
  }
  compactLength() {
    const len = this.compact();
    assertLite(typeof len === 'number');
    return len;
  }
  str() {
    const len = this.compactLength();
    const buf = this.bytes(len);
    return UTF8_DECODER.decode(buf);
  }
  bytes(len: number) {
    const beg = this.idx;
    const end = (this.idx += len);
    if (this.buf.length < end) throw eof();
    return this.buf.subarray(beg, end);
  }
  skip(len: number) {
    this.idx += len;
  }
  bool() {
    return !!this.byte();
  }
  hasBytes() {
    return this.buf.length > this.idx;
  }
  assertEOF() {
    if (this.hasBytes()) throw new Error('Unprocessed data left');
  }
}
