declare module '@midnight-ntwrk/wallet-sdk-address-format' {
  export class MidnightBech32m {
    static encode(symbol: string, bytes: Uint8Array): { toString(): string };
  }
}
