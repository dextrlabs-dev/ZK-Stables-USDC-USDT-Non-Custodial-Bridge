import React, {
  type PropsWithChildren,
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';
import { connectCip30Wallet, listCardanoWalletKeys, shortenHexAddr } from '../cardano/cip30Wallet.js';
import { DEMO_CARDANO_BECH32_PREVIEW, DEMO_CARDANO_USED_HEX } from '../demo/constants.js';

export type SourceChainKind = 'evm' | 'cardano' | 'midnight';

export type CrossChainWalletContextValue = {
  cardanoWalletKey: string | null;
  cardanoUsedAddressesHex: string[];
  cardanoNetworkId: number | null;
  cardanoDisplay: string | null;
  /** UI-only demo when no CIP-30 wallet is used. */
  isDemoCardano: boolean;
  cardanoBech32Preview: string | null;
  listCardanoWallets: () => string[];
  connectCardano: (key: string) => Promise<void>;
  disconnectCardano: () => void;
  applyDemoCardano: () => void;
};

const CrossChainWalletReactContext = createContext<CrossChainWalletContextValue | undefined>(undefined);

export function useCrossChainWallets(): CrossChainWalletContextValue {
  const ctx = useContext(CrossChainWalletReactContext);
  if (!ctx) throw new Error('useCrossChainWallets must be used within CrossChainWalletProvider');
  return ctx;
}

export const CrossChainWalletProvider: React.FC<PropsWithChildren> = ({ children }) => {
  const [cardanoWalletKey, setCardanoWalletKey] = useState<string | null>(null);
  const [cardanoUsedAddressesHex, setCardanoUsedAddressesHex] = useState<string[]>([]);
  const [cardanoNetworkId, setCardanoNetworkId] = useState<number | null>(null);

  const listCardanoWallets = useCallback(() => listCardanoWalletKeys(), []);

  const connectCardano = useCallback(async (key: string) => {
    const { usedAddressesHex, networkId } = await connectCip30Wallet(key);
    setCardanoWalletKey(key);
    setCardanoUsedAddressesHex(usedAddressesHex);
    setCardanoNetworkId(networkId);
  }, []);

  const applyDemoCardano = useCallback(() => {
    setCardanoWalletKey('demo');
    setCardanoUsedAddressesHex([DEMO_CARDANO_USED_HEX]);
    setCardanoNetworkId(1);
  }, []);

  const disconnectCardano = useCallback(() => {
    setCardanoWalletKey(null);
    setCardanoUsedAddressesHex([]);
    setCardanoNetworkId(null);
  }, []);

  const isDemoCardano = cardanoWalletKey === 'demo';

  const cardanoBech32Preview = isDemoCardano ? DEMO_CARDANO_BECH32_PREVIEW : null;

  const cardanoDisplay = useMemo(() => {
    const first = cardanoUsedAddressesHex[0];
    if (!first) return null;
    return shortenHexAddr(first);
  }, [cardanoUsedAddressesHex]);

  const value = useMemo<CrossChainWalletContextValue>(
    () => ({
      cardanoWalletKey,
      cardanoUsedAddressesHex,
      cardanoNetworkId,
      cardanoDisplay,
      isDemoCardano,
      cardanoBech32Preview,
      listCardanoWallets,
      connectCardano,
      disconnectCardano,
      applyDemoCardano,
    }),
    [
      cardanoBech32Preview,
      cardanoDisplay,
      isDemoCardano,
      cardanoNetworkId,
      cardanoUsedAddressesHex,
      cardanoWalletKey,
      applyDemoCardano,
      connectCardano,
      disconnectCardano,
      listCardanoWallets,
    ],
  );

  return <CrossChainWalletReactContext.Provider value={value}>{children}</CrossChainWalletReactContext.Provider>;
};
