import type { ContractAddress, SigningKey } from '@midnight-ntwrk/compact-runtime';
import type {
  ExportPrivateStatesOptions,
  ImportPrivateStatesOptions,
  ImportPrivateStatesResult,
  PrivateStateExport,
  PrivateStateProvider,
  ExportSigningKeysOptions,
  ImportSigningKeysOptions,
  ImportSigningKeysResult,
  SigningKeyExport,
} from '@midnight-ntwrk/midnight-js-types';

export function createInMemoryPrivateStateProvider<PSI extends string, PS>(): PrivateStateProvider<PSI, PS> {
  const states = new Map<string, PS>();
  const signingKeys = new Map<string, SigningKey>();
  let contractAddress: string | null = null;

  const scopedKey = (key: PSI): string => (contractAddress ? `${contractAddress}:${key}` : key);

  const unsupported = (name: string) => async () => {
    throw new Error(`${name} is not supported in the browser demo store`);
  };

  return {
    setContractAddress(address: ContractAddress): void {
      contractAddress = address;
    },
    async get(key: PSI): Promise<PS | null> {
      return states.get(scopedKey(key)) ?? null;
    },
    async set(key: PSI, value: PS): Promise<void> {
      states.set(scopedKey(key), value);
    },
    async remove(key: PSI): Promise<void> {
      states.delete(scopedKey(key));
    },
    async clear(): Promise<void> {
      states.clear();
    },
    async setSigningKey(address: ContractAddress, signingKey: SigningKey): Promise<void> {
      signingKeys.set(address, signingKey);
    },
    async getSigningKey(address: ContractAddress): Promise<SigningKey | null> {
      return signingKeys.get(address) ?? null;
    },
    async removeSigningKey(address: ContractAddress): Promise<void> {
      signingKeys.delete(address);
    },
    async clearSigningKeys(): Promise<void> {
      signingKeys.clear();
    },
    exportPrivateStates: unsupported('exportPrivateStates') as (
      options?: ExportPrivateStatesOptions,
    ) => Promise<PrivateStateExport>,
    importPrivateStates: unsupported('importPrivateStates') as (
      exportData: PrivateStateExport,
      options?: ImportPrivateStatesOptions,
    ) => Promise<ImportPrivateStatesResult>,
    exportSigningKeys: unsupported('exportSigningKeys') as (
      options?: ExportSigningKeysOptions,
    ) => Promise<SigningKeyExport>,
    importSigningKeys: unsupported('importSigningKeys') as (
      exportData: SigningKeyExport,
      options?: ImportSigningKeysOptions,
    ) => Promise<ImportSigningKeysResult>,
  };
}
