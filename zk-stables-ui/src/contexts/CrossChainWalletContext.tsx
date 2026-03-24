import React, {
  type PropsWithChildren,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { shortenHexAddr } from '../cardano/cip30Wallet.js';
import {
  createDemoMnemonicMeshWallet,
  isDemoCardanoMnemonicConfigured,
} from '../cardano/demoMnemonicMeshWallet.js';
import { DEMO_CARDANO_BECH32_PREVIEW, DEMO_CARDANO_USED_HEX } from '../demo/constants.js';

function initialCardanoNetworkFromEnv(): number {
  return Number(import.meta.env.VITE_CARDANO_NETWORK_ID ?? '0') === 1 ? 1 : 0;
}

export type SourceChainKind = 'evm' | 'cardano' | 'midnight';

export type CrossChainWalletContextValue = {
  cardanoWalletKey: string | null;
  cardanoUsedAddressesHex: string[];
  cardanoNetworkId: number | null;
  cardanoDisplay: string | null;
  /** In-app mnemonic mode (`cardanoWalletKey === 'demo'`). */
  isDemoCardano: boolean;
  cardanoBech32Preview: string | null;
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
  /** After explicit Disconnect, do not auto-restore mnemonic demo until Connect / Apply demo / full reload. */
  const skipMnemonicAutofillRef = useRef(false);

  const [cardanoWalletKey, setCardanoWalletKey] = useState<string | null>(() =>
    isDemoCardanoMnemonicConfigured() ? 'demo' : null,
  );
  const [cardanoUsedAddressesHex, setCardanoUsedAddressesHex] = useState<string[]>(() =>
    isDemoCardanoMnemonicConfigured() ? [DEMO_CARDANO_USED_HEX] : [],
  );
  const [cardanoNetworkId, setCardanoNetworkId] = useState<number | null>(() =>
    isDemoCardanoMnemonicConfigured() ? initialCardanoNetworkFromEnv() : null,
  );

  const applyDemoCardano = useCallback(() => {
    skipMnemonicAutofillRef.current = false;
    setCardanoWalletKey('demo');
    setCardanoUsedAddressesHex([DEMO_CARDANO_USED_HEX]);
    setCardanoNetworkId(initialCardanoNetworkFromEnv());
  }, []);

  const disconnectCardano = useCallback(() => {
    skipMnemonicAutofillRef.current = true;
    setCardanoWalletKey(null);
    setCardanoUsedAddressesHex([]);
    setCardanoNetworkId(null);
  }, []);

  useEffect(() => {
    if (!isDemoCardanoMnemonicConfigured() || cardanoWalletKey !== 'demo') return;
    const first = cardanoUsedAddressesHex[0];
    if (first && first !== DEMO_CARDANO_USED_HEX) return;
    let cancelled = false;
    void (async () => {
      try {
        const w = await createDemoMnemonicMeshWallet();
        const used = await w.getUsedAddresses();
        const nid = await w.getNetworkId();
        if (cancelled || used.length === 0) return;
        setCardanoUsedAddressesHex(used);
        setCardanoNetworkId(nid);
      } catch {
        /* Keep placeholder until Yaci / env is fixed */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cardanoWalletKey, cardanoUsedAddressesHex]);

  const isDemoCardano = cardanoWalletKey === 'demo';

  const cardanoBech32Preview =
    isDemoCardano && !isDemoCardanoMnemonicConfigured() ? DEMO_CARDANO_BECH32_PREVIEW : null;

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
      disconnectCardano,
    ],
  );

  return <CrossChainWalletReactContext.Provider value={value}>{children}</CrossChainWalletReactContext.Provider>;
};
