import React, {
  type PropsWithChildren,
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { CompiledContract } from '@midnight-ntwrk/compact-js';
import type { ContractAddress } from '@midnight-ntwrk/compact-runtime';
import * as ledgerV8 from '@midnight-ntwrk/ledger-v8';
import type { InitialAPI, ConnectedAPI, Configuration } from '@midnight-ntwrk/dapp-connector-api';
import { FetchZkConfigProvider } from '@midnight-ntwrk/midnight-js-fetch-zk-config-provider';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { deployContract, findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import type { Logger } from 'pino';
import { BehaviorSubject, type Subscription, filter, firstValueFrom, interval, map, take, throwError, timeout } from 'rxjs';
import * as ZkStablesRegistry from '@contract/zk-stables-registry';
import { zkStablesRegistryWitnesses, type ZkStablesRegistryPrivateState } from '@contract/witnesses-zk-stables-registry';
import { zkStablesRegistryPrivateStateId, AssetKind } from '../constants/zk-stables.js';
import { REGISTRY_DEPOSIT_STATUS_BURNED } from '../constants/registryDepositStatus.js';
import type { PublicDataProvider } from '@midnight-ntwrk/midnight-js-types';
import { hexToBytes32, uint8ArrayToHex } from '../utils/hex.js';
import { userAddressStructFromInput } from '../utils/userAddress.js';
import { createInMemoryPrivateStateProvider } from '../utils/inMemoryPrivateStateProvider.js';
import { withTimeout } from '../utils/withTimeout.js';
import { toError } from '../utils/toError.js';
import { initDevWalletFromSeedHash, type DevSeedWalletContext } from '../midnight/devSeedWallet.js';
import { formatShieldedAddressForDisplay } from '../utils/shieldedAddressDisplay.js';
import { formatMidnightTxFailureForUser } from '../utils/midnightSubmitErrors.js';

const NETWORK_ID = (import.meta.env.VITE_NETWORK_ID || 'undeployed') as string;

const MIDNIGHT_PROOF_SERVER_PORT = Number(
  import.meta.env.VITE_MIDNIGHT_PROOF_SERVER_PORT ?? 6300,
);

function replacerSafe(_key: string, value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  return value;
}

function serializeThrown(e: unknown): string {
  if (e instanceof Error) {
    return `${e.name}: ${e.message}${e.stack ? `\n${e.stack}` : ''}`;
  }
  try {
    return JSON.stringify(e, replacerSafe);
  } catch {
    return String(e);
  }
}

export type BridgeDeployment =
  | { readonly status: 'idle' }
  | { readonly status: 'in-progress' }
  | { readonly status: 'deployed'; readonly contractAddress: ContractAddress }
  | { readonly status: 'failed'; readonly error: Error };

/** Per-deposit entry from the registry ledger maps. */
export type RegistryDepositEntry = {
  depositCommitmentHex: string;
  status: number;
  statusLabel: string;
  assetKind: number;
  amount: bigint;
  sourceChainId: bigint;
  destChainId: bigint;
  mintedUnshielded: boolean;
  unshieldedReleased: boolean;
  recipientCommitmentHex: string;
};

export type LedgerView = {
  /** Registry bridgeOperator public key hex. */
  bridgeOperatorHex: string;
  /** Per-deposit entries from the registry maps. */
  deposits: RegistryDepositEntry[];
  /** Deposits still in circulation (Burned omitted — finalized burns no longer count as live positions). */
  depositCount: number;
};

function registryStatusLabel(status: number): string {
  switch (status) {
    case 1: return 'Active';
    case 2: return 'ExitPending';
    case REGISTRY_DEPOSIT_STATUS_BURNED: return 'Burned';
    default: return `Unknown(${status})`;
  }
}

export type TxLogEntry = {
  label: string;
  txId: string;
  txHash: string;
  blockHeight?: bigint | number;
  at: string;
};

export type ZkStablesDeployParams = {
  depositCommitmentHex: string;
  assetKind: number;
  sourceChainId: string;
  amount: string;
  operatorSkHex: string;
  holderSkHex: string;
};

type ZkCircuitId =
  | 'registerDeposit'
  | 'proveHolder'
  | 'mintWrappedUnshielded'
  | 'initiateBurn'
  | 'sendWrappedUnshieldedToUser'
  | 'finalizeBurn';

/** Deployed / joined contract handle. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ZkDeployedAny = any;

function zkArtifactsBaseUrl(): string {
  const base = import.meta.env.BASE_URL || '/';
  try {
    return new URL(base, window.location.origin).href.replace(/\/$/, '');
  } catch {
    return window.location.origin;
  }
}

function sameHostUrl(port: number, path = ''): string {
  const proto = window.location.protocol === 'https:' ? 'https:' : 'http:';
  const host = window.location.hostname;
  return `${proto}//${host}:${port}${path}`;
}

function sameHostWsUrl(port: number, path = ''): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.hostname;
  return `${proto}//${host}:${port}${path}`;
}


/** Midnight dApp connector name (e.g. Lace) when connected. */
export type ZkStablesContextValue = {
  deployment$: BehaviorSubject<BridgeDeployment>;
  flowMessage: string | undefined;
  isConnected: boolean;
  isConnecting: boolean;
  /** Wallet extension name from `InitialAPI.name` (zkloan / dapp-connector pattern). */
  connectorDisplayName: string | null;
  walletAddress: string | null;
  /** Dev-seed wallet: deterministic unshielded address derived from seed hash. */
  unshieldedAddress: string | null;
  contractAddress: ContractAddress | null;
  ledger: LedgerView | null;
  txLog: TxLogEntry[];
  deployParams: ZkStablesDeployParams;
  setDeployParams: React.Dispatch<React.SetStateAction<ZkStablesDeployParams>>;
  joinAddress: string;
  setJoinAddress: (v: string) => void;
  burnDestChain: string;
  setBurnDestChain: (v: string) => void;
  recipientCommHex: string;
  setRecipientCommHex: (v: string) => void;
  sendToAddressInput: string;
  setSendToAddressInput: (v: string) => void;
  /** Connect Midnight Lace (or first `window.midnight` wallet); caches providers for deploy/join/circuits. */
  connectLaceWallet: () => Promise<void>;
  disconnectLaceWallet: () => void;
  /** Dev-only: connect without Lace using a 32-byte seed hash (local undeployed network). */
  connectDevSeedWallet: (seedHashHex: string) => Promise<void>;
  connectAndDeploy: () => Promise<void>;
  connectAndJoin: (addressOverride?: string, privateStateOverride?: { operatorSkHex: string; holderSkHex: string }) => Promise<void>;
  refreshLedger: () => Promise<void>;
  /** Registry: proveHolder(dep). */
  proveHolder: (dep?: Uint8Array) => Promise<void>;
  /** Registry: mintWrappedUnshielded(dep). */
  mintWrappedUnshielded: (dep?: Uint8Array) => Promise<void>;
  /** Registry: initiateBurn(dep, destChain, recipientComm). */
  initiateBurn: (override?: { depositCommitment?: Uint8Array; recipientCommHex64?: string; destChain?: string }) => Promise<void>;
  /** Registry: sendWrappedUnshieldedToUser(dep, userAddr). */
  sendWrappedUnshieldedToUser: (dep?: Uint8Array) => Promise<void>;
  /** Registry: finalizeBurn(dep). */
  finalizeBurn: (dep?: Uint8Array) => Promise<void>;
  canProveHolder: boolean;
  canMint: boolean;
  canInitiateBurn: boolean;
  canSendWrapped: boolean;
  canFinalizeBurn: boolean;
  /** Wallet unshielded token balances: Record<RawTokenType, bigint> from WalletFacade.state(). */
  unshieldedBalances: Record<string, bigint>;
  /** After a successful `initiateBurn`, use for relayer `BURN` intent (`burnCommitmentHex` + `source.midnight`). */
  lastMidnightBurnAnchor: {
    txId: string;
    txHash: string;
    recipientCommHex64: string;
    /** Registry ledger row key (same bytes as `initiateBurn` arg1) — distinct from `recipientCommHex64`. */
    depositCommitmentHex64: string;
    destChain: string;
    contractAddress: string | null;
  } | null;
  clearLastMidnightBurnAnchor: () => void;
};

export const ZkStablesReactContext = createContext<ZkStablesContextValue | undefined>(undefined);

export type ZkStablesProviderProps = PropsWithChildren<{ logger: Logger }>;

export const ZkStablesProvider: React.FC<ZkStablesProviderProps> = ({ logger, children }) => {
  const privateStateProvider = useMemo(
    () => createInMemoryPrivateStateProvider<typeof zkStablesRegistryPrivateStateId, ZkStablesRegistryPrivateState>(),
    [],
  );

  const [deploymentSubject] = useState(() => new BehaviorSubject<BridgeDeployment>({ status: 'idle' }));
  const [flowMessage, setFlowMessage] = useState<string | undefined>();
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectorDisplayName, setConnectorDisplayName] = useState<string | null>(null);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [unshieldedAddress, setUnshieldedAddress] = useState<string | null>(null);
  const [contractAddress, setContractAddress] = useState<ContractAddress | null>(null);
  const [ledger, setLedger] = useState<LedgerView | null>(null);
  const [txLog, setTxLog] = useState<TxLogEntry[]>([]);
  const [lastMidnightBurnAnchor, setLastMidnightBurnAnchor] = useState<ZkStablesContextValue['lastMidnightBurnAnchor']>(
    null,
  );
  const [unshieldedBalances, setUnshieldedBalances] = useState<Record<string, bigint>>({});
  const walletStateSub = useRef<Subscription | null>(null);

  const clearLastMidnightBurnAnchor = useCallback(() => setLastMidnightBurnAnchor(null), []);

  const [deployParams, setDeployParams] = useState<ZkStablesDeployParams>({
    depositCommitmentHex: '00'.repeat(32),
    assetKind: AssetKind.USDC as number,
    sourceChainId: '1',
    amount: '1000000',
    operatorSkHex: '01'.repeat(32),
    holderSkHex: '02'.repeat(32),
  });
  const [joinAddress, setJoinAddress] = useState(
    () => String(import.meta.env.VITE_DEFAULT_MIDNIGHT_JOIN_ADDRESS ?? '').trim(),
  );
  const [burnDestChain, setBurnDestChain] = useState('2');
  const [recipientCommHex, setRecipientCommHex] = useState('aa'.repeat(32));
  const [sendToAddressInput, setSendToAddressInput] = useState('');

  const publicDataProviderRef = useRef<PublicDataProvider | null>(null);
  const deployedRef = useRef<ZkDeployedAny | null>(null);
  const walletRef = useRef<ConnectedAPI | null>(null);
  const devWalletRef = useRef<DevSeedWalletContext | null>(null);
  const providersCacheRef = useRef<{
    privateStateProvider: typeof privateStateProvider;
    zkConfigProvider: FetchZkConfigProvider<ZkCircuitId>;
    proofProvider: ReturnType<typeof httpClientProofProvider>;
    publicDataProvider: PublicDataProvider;
    walletProvider: ReturnType<typeof Object> extends never ? never : unknown;
    midnightProvider: { submitTx: (tx: ledgerV8.FinalizedTransaction) => Promise<string> };
  } | null>(null);

  const compiledContract = useMemo(
    () =>
      CompiledContract.make('zk-stables-registry', ZkStablesRegistry.Contract as never).pipe(
        CompiledContract.withWitnesses(zkStablesRegistryWitnesses as never),
        CompiledContract.withCompiledFileAssets(zkArtifactsBaseUrl()),
      ) as any,
    [],
  );

  const appendTxLog = useCallback((label: string, pub: { txId: unknown; txHash: unknown; blockHeight?: number | bigint }) => {
    setTxLog((prev) => [
      {
        label,
        txId: String(pub.txId),
        txHash: String(pub.txHash),
        blockHeight: pub.blockHeight,
        at: new Date().toISOString(),
      },
      ...prev,
    ]);
  }, []);

  const buildPrivateState = useCallback((): ZkStablesRegistryPrivateState => {
    return {
      operatorSecretKey: hexToBytes32(deployParams.operatorSkHex),
      holderSecretKey: hexToBytes32(deployParams.holderSkHex),
    };
  }, [deployParams.operatorSkHex, deployParams.holderSkHex]);

  const connectToWallet = useCallback(async (): Promise<{
    wallet: ConnectedAPI;
    config: Configuration;
    connectorDisplayName: string;
  }> => {
    const initialAPI = await firstValueFrom(
      interval(100).pipe(
        map(() => {
          const midnight = (window as unknown as { midnight?: Record<string, InitialAPI> }).midnight;
          if (!midnight) return undefined;
          return midnight.mnLace ?? Object.values(midnight)[0];
        }),
        filter((api): api is InitialAPI => !!api),
        take(1),
        timeout({
          first: 15_000,
          with: () =>
            throwError(
              () =>
                new Error(
                  'No Midnight wallet (Lace) detected within 15s. Install Lace, allow this site, unlock the wallet, then refresh.',
                ),
            ),
        }),
      ),
    );

    const connectorDisplayName =
      typeof (initialAPI as { name?: string }).name === 'string' && (initialAPI as { name?: string }).name!.length > 0
        ? (initialAPI as { name: string }).name
        : 'Midnight wallet';

    let connectedAPI: ConnectedAPI;
    try {
      connectedAPI = await withTimeout(
        initialAPI.connect(NETWORK_ID),
        120_000,
        `Lace did not finish connecting for network "${NETWORK_ID}" within 2 minutes. Approve this site in the extension, check for a blocked popup, and ensure the wallet network matches VITE_NETWORK_ID.`,
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes('Network ID mismatch') || msg.toLowerCase().includes('network mismatch')) {
        throw new Error(
          [
            `Network mismatch: the dApp calls connect("${NETWORK_ID}") (from VITE_NETWORK_ID), but Lace is using a different Midnight network.`,
            '',
            'Fix one of:',
            `• In Lace, switch the Midnight wallet to the network whose id is "${NETWORK_ID}" (typical for local docker: undeployed).`,
            `• Or set VITE_NETWORK_ID in zk-stables-ui/.env.development to the exact network id Lace shows, save, and restart npm run dev.`,
            '',
            'Vite bakes this value in at dev-server start; changing .env requires a restart.',
          ].join('\n'),
        );
      }
      throw error;
    }

    const config = await withTimeout(
      connectedAPI.getConfiguration(),
      60_000,
      'Wallet did not return indexer/prover configuration in time.',
    );

    const status = await withTimeout(
      connectedAPI.getConnectionStatus(),
      30_000,
      'Wallet did not return connection status in time.',
    );
    if (status.status === 'connected') {
      setNetworkId(status.networkId);
    }

    return { wallet: connectedAPI, config, connectorDisplayName };
  }, []);

  const initializeProviders = useCallback(async () => {
    const cached = providersCacheRef.current;
    if (cached !== null && walletRef.current !== null) {
      return cached;
    }
    if (cached !== null && devWalletRef.current !== null) {
      return cached;
    }

    setIsConnecting(true);
    try {
      // Dev seed wallet path (no Lace)
      if (devWalletRef.current) {
        const ctx = devWalletRef.current;
        // Derive deterministically from genesis seed hash (no indexer sync required).
        setUnshieldedAddress(ctx.unshieldedAddress);
        const state = await firstValueFrom(ctx.wallet.state().pipe(filter((s: any) => s.isSynced)));
        setIsConnected(true);
        setConnectorDisplayName('Dev seed wallet');
        setWalletAddress(
          formatShieldedAddressForDisplay(NETWORK_ID, state.shielded?.address) ?? null,
        );
        setNetworkId('undeployed');

        walletStateSub.current?.unsubscribe();
        walletStateSub.current = ctx.wallet.state().subscribe((s: any) => {
          try {
            const bals: Record<string, bigint> = s?.unshielded?.balances ?? {};
            setUnshieldedBalances(bals);
          } catch { /* ignore */ }
        });

        const zkConfigProvider = new FetchZkConfigProvider<ZkCircuitId>(zkArtifactsBaseUrl(), fetch.bind(window));
        const proofProvider = httpClientProofProvider(sameHostUrl(MIDNIGHT_PROOF_SERVER_PORT), zkConfigProvider);
        const publicDataProvider = indexerPublicDataProvider(
          sameHostUrl(8088, '/api/v4/graphql'),
          sameHostWsUrl(8088, '/api/v4/graphql/ws'),
        );
        publicDataProviderRef.current = publicDataProvider;

        const signTransactionIntents = (
          tx: { intents?: Map<number, any> },
          signFn: (payload: Uint8Array) => ledgerV8.Signature,
          proofMarker: 'proof' | 'pre-proof',
        ): void => {
          if (!tx.intents || tx.intents.size === 0) return;
          for (const segment of tx.intents.keys()) {
            const intent = tx.intents.get(segment);
            if (!intent) continue;
            const cloned = ledgerV8.Intent.deserialize<ledgerV8.SignatureEnabled, ledgerV8.Proofish, ledgerV8.PreBinding>(
              'signature',
              proofMarker,
              'pre-binding',
              intent.serialize(),
            );
            const sigData = cloned.signatureData(segment);
            const signature = signFn(sigData);
            if (cloned.fallibleUnshieldedOffer) {
              const sigs = cloned.fallibleUnshieldedOffer.inputs.map(
                (_: ledgerV8.UtxoSpend, i: number) => cloned.fallibleUnshieldedOffer!.signatures.at(i) ?? signature,
              );
              cloned.fallibleUnshieldedOffer = cloned.fallibleUnshieldedOffer.addSignatures(sigs);
            }
            if (cloned.guaranteedUnshieldedOffer) {
              const sigs = cloned.guaranteedUnshieldedOffer.inputs.map(
                (_: ledgerV8.UtxoSpend, i: number) =>
                  cloned.guaranteedUnshieldedOffer!.signatures.at(i) ?? signature,
              );
              cloned.guaranteedUnshieldedOffer = cloned.guaranteedUnshieldedOffer.addSignatures(sigs);
            }
            tx.intents.set(segment, cloned);
          }
        };

        const walletProvider = {
          getCoinPublicKey(): ledgerV8.CoinPublicKey {
            return state.shielded.coinPublicKey.toHexString() as unknown as ledgerV8.CoinPublicKey;
          },
          getEncryptionPublicKey(): ledgerV8.EncPublicKey {
            return state.shielded.encryptionPublicKey.toHexString() as unknown as ledgerV8.EncPublicKey;
          },
          async balanceTx(tx: any, ttl?: Date): Promise<ledgerV8.FinalizedTransaction> {
            const recipe = await ctx.wallet.balanceUnboundTransaction(
              tx,
              { shieldedSecretKeys: ctx.shieldedSecretKeys, dustSecretKey: ctx.dustSecretKey } as any,
              { ttl: ttl ?? new Date(Date.now() + 30 * 60 * 1000) } as any,
            );
            const signFn = (payload: Uint8Array) =>
              ctx.unshieldedKeystore.signData(payload) as unknown as ledgerV8.Signature;
            signTransactionIntents(recipe.baseTransaction as any, signFn, 'proof');
            if (recipe.balancingTransaction) {
              signTransactionIntents(recipe.balancingTransaction as any, signFn, 'pre-proof');
            }
            return ctx.wallet.finalizeRecipe(recipe) as any;
          },
        };

        const midnightProvider = {
          /** Match Lace: return identifiers()[0] so indexer `watchForTxData` resolves (multi-segment txs: last id can differ). */
          async submitTx(tx: ledgerV8.FinalizedTransaction): Promise<string> {
            await ctx.wallet.submitTransaction(tx);
            const ids = tx.identifiers();
            const head = ids[0];
            if (head === undefined) {
              throw new Error('Submitted transaction has no identifiers');
            }
            return head;
          },
        };

        const bundle = {
          privateStateProvider,
          zkConfigProvider,
          proofProvider,
          publicDataProvider,
          walletProvider,
          midnightProvider,
        };
        providersCacheRef.current = bundle;
        return bundle;
      }

      const { wallet, config, connectorDisplayName: connectorName } = await connectToWallet();
      walletRef.current = wallet;
      setConnectorDisplayName(connectorName);

      const addresses = await withTimeout(
        wallet.getShieldedAddresses(),
        60_000,
        'Wallet did not return shielded addresses in time. Unlock Lace and try again.',
      );
      setIsConnected(true);
      setWalletAddress(formatShieldedAddressForDisplay(NETWORK_ID, addresses.shieldedAddress) ?? null);

      if (!config.proverServerUri) {
        throw new Error('Wallet did not return proverServerUri');
      }
      if (!addresses.shieldedCoinPublicKey || !addresses.shieldedEncryptionPublicKey) {
        throw new Error('Wallet did not return shielded coin/encryption public keys');
      }

      const zkConfigProvider = new FetchZkConfigProvider<ZkCircuitId>(zkArtifactsBaseUrl(), fetch.bind(window));
      const proofProvider = httpClientProofProvider(config.proverServerUri, zkConfigProvider);
      const publicDataProvider = indexerPublicDataProvider(config.indexerUri, config.indexerWsUri);
      publicDataProviderRef.current = publicDataProvider;

      const walletProvider = {
        getCoinPublicKey(): ledgerV8.CoinPublicKey {
          return addresses.shieldedCoinPublicKey as ledgerV8.CoinPublicKey;
        },
        getEncryptionPublicKey(): ledgerV8.EncPublicKey {
          return addresses.shieldedEncryptionPublicKey as ledgerV8.EncPublicKey;
        },
        async balanceTx(tx: any, _ttl?: Date): Promise<ledgerV8.FinalizedTransaction> {
          setFlowMessage('Sign the transaction in your Midnight wallet…');
          const serialized = tx.serialize();
          const serializedStr = uint8ArrayToHex(serialized);
          const result = await (wallet as unknown as { balanceUnsealedTransaction: (s: string, o: object) => Promise<{ tx: string }> }).balanceUnsealedTransaction(serializedStr, {});
          const resultBytes = new Uint8Array(
            result.tx.match(/.{1,2}/g)!.map((byte: string) => parseInt(byte, 16)),
          );
          const finalizedTx = ledgerV8.Transaction.deserialize(
            'signature',
            'proof',
            'binding',
            resultBytes,
          ) as ledgerV8.FinalizedTransaction;
          setFlowMessage(undefined);
          return finalizedTx;
        },
      };

      const midnightProvider = {
        async submitTx(tx: ledgerV8.FinalizedTransaction): Promise<string> {
          setFlowMessage('Submitting transaction…');
          const serializedStr = uint8ArrayToHex(tx.serialize());
          await wallet.submitTransaction(serializedStr);
          const txId = tx.identifiers()[0];
          setFlowMessage(undefined);
          return txId;
        },
      };

      const bundle = {
        privateStateProvider,
        zkConfigProvider,
        proofProvider,
        publicDataProvider,
        walletProvider,
        midnightProvider,
      };
      providersCacheRef.current = bundle;
      return bundle;
    } catch (e) {
      walletRef.current = null;
      devWalletRef.current = null;
      providersCacheRef.current = null;
      setIsConnected(false);
      setWalletAddress(null);
      setUnshieldedAddress(null);
      setConnectorDisplayName(null);
      throw e;
    } finally {
      setIsConnecting(false);
    }
  }, [connectToWallet, privateStateProvider]);

  const connectLaceWallet = useCallback(async () => {
    setFlowMessage('Connecting to Midnight Lace…');
    try {
      await initializeProviders();
      setFlowMessage(undefined);
    } catch (error) {
      setFlowMessage(undefined);
      const err = error instanceof Error ? error : new Error(String(error));
      logger.warn({ msg: err.message }, 'connectLaceWallet failed');
      throw err;
    }
  }, [initializeProviders, logger]);

  const disconnectLaceWallet = useCallback(() => {
    walletStateSub.current?.unsubscribe();
    walletStateSub.current = null;
    providersCacheRef.current = null;
    walletRef.current = null;
    devWalletRef.current = null;
    publicDataProviderRef.current = null;
    deployedRef.current = null;
    setIsConnected(false);
    setConnectorDisplayName(null);
    setWalletAddress(null);
    setUnshieldedAddress(null);
    setContractAddress(null);
    setLedger(null);
    setUnshieldedBalances({});
    setLastMidnightBurnAnchor(null);
    setFlowMessage(undefined);
    deploymentSubject.next({ status: 'idle' });
  }, [deploymentSubject]);

  const connectDevSeedWallet = useCallback(
    async (seedHashHex: string) => {
      setFlowMessage('Connecting dev seed wallet (no Lace)…');
      setLastMidnightBurnAnchor(null);
      providersCacheRef.current = null;
      walletRef.current = null;
      devWalletRef.current = await initDevWalletFromSeedHash({
        seedHashHex,
        networkId: 'undeployed',
        indexerHttpUrl: sameHostUrl(8088, '/api/v4/graphql'),
        indexerWsUrl: sameHostWsUrl(8088, '/api/v4/graphql/ws'),
        nodeWsUrl: sameHostWsUrl(9944),
        provingServerUrl: sameHostUrl(MIDNIGHT_PROOF_SERVER_PORT),
      });
      await initializeProviders();
      setFlowMessage(undefined);
    },
    [initializeProviders],
  );

  const refreshLedger = useCallback(async (addressOverride?: ContractAddress) => {
    const addr = addressOverride ?? contractAddress;
    const pdp = publicDataProviderRef.current;
    if (!addr || !pdp) return;
    try {
      const cs = await pdp.queryContractState(addr);
      if (!cs?.data) {
        setLedger(null);
        return;
      }
      const L = ZkStablesRegistry.ledger(cs.data);
      const deposits: RegistryDepositEntry[] = [];
      for (const [depKey, status] of L.depositStatus) {
        const depHex = uint8ArrayToHex(depKey);
        const assetKind = L.depositAssetKind.member(depKey) ? L.depositAssetKind.lookup(depKey) : 0;
        const amount = L.depositAmount.member(depKey) ? L.depositAmount.lookup(depKey) : 0n;
        const sourceChainId = L.depositSourceChain.member(depKey) ? L.depositSourceChain.lookup(depKey) : 0n;
        const destChainId = L.depositDestChain.member(depKey) ? L.depositDestChain.lookup(depKey) : 0n;
        const mintedUnshielded = L.depositMintedUnshielded.member(depKey) ? Number(L.depositMintedUnshielded.lookup(depKey)) === 1 : false;
        const unshieldedReleased = L.depositUnshieldedReleased.member(depKey) ? Number(L.depositUnshieldedReleased.lookup(depKey)) === 1 : false;
        const recipientCommitmentHex = L.depositRecipientComm.member(depKey) ? uint8ArrayToHex(L.depositRecipientComm.lookup(depKey)) : '00'.repeat(32);
        deposits.push({
          depositCommitmentHex: depHex,
          status: Number(status),
          statusLabel: registryStatusLabel(Number(status)),
          assetKind,
          amount,
          sourceChainId,
          destChainId,
          mintedUnshielded,
          unshieldedReleased,
          recipientCommitmentHex,
        });
      }
      setLedger({
        bridgeOperatorHex: uint8ArrayToHex(L.bridgeOperator),
        deposits,
        depositCount: deposits.filter((d) => d.status !== REGISTRY_DEPOSIT_STATUS_BURNED).length,
      });
    } catch (e) {
      logger.warn({ e }, 'refreshLedger failed');
    }
  }, [contractAddress, logger]);

  const connectAndDeploy = useCallback(async () => {
    try {
      deploymentSubject.next({ status: 'in-progress' });
      const alreadyLinked = providersCacheRef.current !== null && walletRef.current !== null;
      if (!alreadyLinked) {
        setFlowMessage('Connecting wallet…');
      }
      const providers = await initializeProviders();
      const ps = buildPrivateState();

      setFlowMessage('Deploying zk-stables-registry (proving may take several minutes)…');
      logger.info('deployContract (registry) starting');

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const deployed = await deployContract(providers as any, {
        compiledContract,
        privateStateId: zkStablesRegistryPrivateStateId,
        initialPrivateState: ps,
        args: [],
      } as any);

      const addr = deployed.deployTxData.public.contractAddress;
      deployedRef.current = deployed;
      setContractAddress(addr);
      appendTxLog('deploy', deployed.deployTxData.public);
      setFlowMessage(undefined);
      deploymentSubject.next({ status: 'deployed', contractAddress: addr });
      await refreshLedger(addr);
    } catch (error) {
      setFlowMessage(undefined);
      const err = toError(error);
      logger.error(err, 'deploy failed');
      logger.error(
        {
          message: err.message,
          name: err.name,
          stack: err.stack ?? undefined,
          thrown: serializeThrown(error),
        },
        'deploy failed (detail)',
      );
      deploymentSubject.next({ status: 'failed', error: err });
    }
  }, [
    appendTxLog,
    buildPrivateState,
    compiledContract,
    deploymentSubject,
    initializeProviders,
    logger,
    refreshLedger,
  ]);

  const connectAndJoin = useCallback(async (addressOverride?: string, privateStateOverride?: { operatorSkHex: string; holderSkHex: string }) => {
    const addr = (addressOverride?.trim() || joinAddress.trim()) as ContractAddress;
    if (!addr) {
      deploymentSubject.next({
        status: 'failed',
        error: new Error('Enter a contract address to join'),
      });
      return;
    }
    try {
      deploymentSubject.next({ status: 'in-progress' });
      const alreadyLinked = providersCacheRef.current !== null && walletRef.current !== null;
      if (!alreadyLinked) {
        setFlowMessage('Connecting wallet…');
      }
      const providers = await initializeProviders();
      const ps = privateStateOverride
        ? { operatorSecretKey: hexToBytes32(privateStateOverride.operatorSkHex), holderSecretKey: hexToBytes32(privateStateOverride.holderSkHex) }
        : buildPrivateState();
      setFlowMessage('Joining contract…');

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const joined = await findDeployedContract(providers as any, {
        contractAddress: addr,
        compiledContract,
        privateStateId: zkStablesRegistryPrivateStateId,
        initialPrivateState: ps,
      });

      const resolved = joined.deployTxData.public.contractAddress ?? addr;
      deployedRef.current = joined;
      setContractAddress(resolved);
      setFlowMessage(undefined);
      deploymentSubject.next({ status: 'deployed', contractAddress: resolved });
      await refreshLedger(resolved);
    } catch (error) {
      setFlowMessage(undefined);
      const err = toError(error);
      logger.error(err, 'join failed');
      logger.error(
        {
          message: err.message,
          name: err.name,
          stack: err.stack ?? undefined,
          thrown: serializeThrown(error),
        },
        'join failed (detail)',
      );
      deploymentSubject.next({ status: 'failed', error: err });
    }
  }, [
    buildPrivateState,
    compiledContract,
    deploymentSubject,
    initializeProviders,
    joinAddress,
    logger,
    refreshLedger,
  ]);

  const requireDeployed = useCallback(() => {
    const d = deployedRef.current;
    if (!d) throw new Error('Deploy or join a contract first');
    return d;
  }, []);

  const proveHolder = useCallback(async (dep?: Uint8Array) => {
    const d = requireDeployed();
    if (!dep) throw new Error('proveHolder requires a deposit commitment');
    setFlowMessage(
      'proveHolder: prove → balance → submit → waiting for indexer (multi-step; do not refresh)…',
    );
    try {
      const r = await d.callTx.proveHolder(dep);
      appendTxLog('proveHolder', r.public);
      await refreshLedger();
    } finally {
      setFlowMessage(undefined);
    }
  }, [appendTxLog, refreshLedger, requireDeployed]);

  const mintWrappedUnshielded = useCallback(async (dep?: Uint8Array) => {
    const d = requireDeployed();
    if (!dep) throw new Error('mintWrappedUnshielded requires a deposit commitment');
    setFlowMessage('mintWrappedUnshielded: prove → submit → waiting for indexer…');
    try {
      const r = await d.callTx.mintWrappedUnshielded(dep);
      appendTxLog('mintWrappedUnshielded', r.public);
      await refreshLedger();
    } finally {
      setFlowMessage(undefined);
    }
  }, [appendTxLog, refreshLedger, requireDeployed]);

  const initiateBurn = useCallback(
    async (override?: { depositCommitment?: Uint8Array; recipientCommHex64?: string; destChain?: string }) => {
      const d = requireDeployed();
      const dep = override?.depositCommitment;
      if (!dep) throw new Error('initiateBurn requires a deposit commitment');
      const destStr = (override?.destChain ?? burnDestChain) || '0';
      const commBare = (override?.recipientCommHex64 ?? recipientCommHex).replace(/^0x/i, '').trim().toLowerCase();
      if (commBare.length !== 64 || !/^[0-9a-f]+$/u.test(commBare)) {
        throw new Error('recipient commitment must be 64 hex chars (32 bytes)');
      }
      const dest = BigInt(destStr);
      const comm = hexToBytes32(commBare);
      setFlowMessage('initiateBurn: prove → submit → waiting for indexer…');
      try {
        const r = await d.callTx.initiateBurn(dep, dest, comm);
        appendTxLog('initiateBurn', r.public);
        setLastMidnightBurnAnchor({
          txId: String(r.public.txId),
          txHash: String(r.public.txHash),
          recipientCommHex64: uint8ArrayToHex(comm).toLowerCase(),
          depositCommitmentHex64: uint8ArrayToHex(dep).toLowerCase(),
          destChain: destStr,
          contractAddress: contractAddress ? String(contractAddress) : null,
        });
        await refreshLedger();
      } catch (e) {
        const detail = formatMidnightTxFailureForUser(serializeThrown(e), 'initiateBurn');
        throw new Error(detail);
      } finally {
        setFlowMessage(undefined);
      }
    },
    [appendTxLog, burnDestChain, contractAddress, recipientCommHex, refreshLedger, requireDeployed],
  );

  const sendWrappedUnshieldedToUser = useCallback(async (dep?: Uint8Array) => {
    const d = requireDeployed();
    if (!dep) throw new Error('sendWrappedUnshieldedToUser requires a deposit commitment');
    let nid: string = NETWORK_ID;
    try {
      const w = walletRef.current;
      if (w && typeof (w as { getConnectionStatus?: () => Promise<{ networkId: string }> }).getConnectionStatus === 'function') {
        const st = await (w as { getConnectionStatus: () => Promise<{ networkId: string }> }).getConnectionStatus();
        nid = st.networkId;
      }
    } catch {
      /* use NETWORK_ID */
    }
    const userAddr = userAddressStructFromInput(sendToAddressInput, nid);
    setFlowMessage('sendWrappedUnshieldedToUser: prove → submit → waiting for indexer…');
    try {
      const r = await d.callTx.sendWrappedUnshieldedToUser(dep, userAddr);
      appendTxLog('sendWrappedUnshieldedToUser', r.public);
      await refreshLedger();
    } finally {
      setFlowMessage(undefined);
    }
  }, [appendTxLog, refreshLedger, requireDeployed, sendToAddressInput]);

  const finalizeBurn = useCallback(async (dep?: Uint8Array) => {
    const d = requireDeployed();
    if (!dep) throw new Error('finalizeBurn requires a deposit commitment');
    setFlowMessage('finalizeBurn: prove → submit → waiting for indexer…');
    try {
      const r = await d.callTx.finalizeBurn(dep);
      appendTxLog('finalizeBurn', r.public);
      await refreshLedger();
    } finally {
      setFlowMessage(undefined);
    }
  }, [appendTxLog, refreshLedger, requireDeployed]);

  useEffect(() => () => { walletStateSub.current?.unsubscribe(); }, []);

  const canProveHolder = ledger !== null && ledger.deposits.some((d) => d.status === 1);
  const canMint = ledger !== null && ledger.deposits.some((d) => d.status === 1 && !d.mintedUnshielded);
  const canInitiateBurn = ledger !== null && ledger.deposits.some((d) => d.status === 1);
  const canSendWrapped = ledger !== null && ledger.deposits.some((d) => d.status === 2 && d.mintedUnshielded && !d.unshieldedReleased);
  const canFinalizeBurn = ledger !== null && ledger.deposits.some((d) => d.status === 2 && d.unshieldedReleased);

  const value = useMemo<ZkStablesContextValue>(
    () => ({
      deployment$: deploymentSubject,
      flowMessage,
      isConnected,
      isConnecting,
      connectorDisplayName,
      walletAddress,
      unshieldedAddress,
      contractAddress,
      ledger,
      txLog,
      deployParams,
      setDeployParams,
      joinAddress,
      setJoinAddress,
      burnDestChain,
      setBurnDestChain,
      recipientCommHex,
      setRecipientCommHex,
      sendToAddressInput,
      setSendToAddressInput,
      connectLaceWallet,
      disconnectLaceWallet,
      connectDevSeedWallet,
      connectAndDeploy,
      connectAndJoin,
      refreshLedger,
      proveHolder,
      mintWrappedUnshielded,
      initiateBurn,
      sendWrappedUnshieldedToUser,
      finalizeBurn,
      canProveHolder,
      canMint,
      canInitiateBurn,
      canSendWrapped,
      canFinalizeBurn,
      unshieldedBalances,
      lastMidnightBurnAnchor,
      clearLastMidnightBurnAnchor,
    }),
    [
      burnDestChain,
      canFinalizeBurn,
      clearLastMidnightBurnAnchor,
      canInitiateBurn,
      canMint,
      canProveHolder,
      canSendWrapped,
      connectAndDeploy,
      connectAndJoin,
      connectLaceWallet,
      connectDevSeedWallet,
      connectorDisplayName,
      contractAddress,
      deployParams,
      deploymentSubject,
      disconnectLaceWallet,
      finalizeBurn,
      flowMessage,
      initiateBurn,
      isConnected,
      isConnecting,
      joinAddress,
      lastMidnightBurnAnchor,
      ledger,
      mintWrappedUnshielded,
      proveHolder,
      recipientCommHex,
      refreshLedger,
      sendToAddressInput,
      sendWrappedUnshieldedToUser,
      txLog,
      unshieldedBalances,
      walletAddress,
      unshieldedAddress,
    ],
  );

  return <ZkStablesReactContext.Provider value={value}>{children}</ZkStablesReactContext.Provider>;
};
