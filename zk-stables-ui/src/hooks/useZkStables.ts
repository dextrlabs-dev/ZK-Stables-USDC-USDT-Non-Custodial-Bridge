import { useContext } from 'react';
import { ZkStablesReactContext, type ZkStablesContextValue } from '../contexts/ZkStablesContext.js';

export function useZkStables(): ZkStablesContextValue {
  const ctx = useContext(ZkStablesReactContext);
  if (!ctx) {
    throw new Error('useZkStables must be used within ZkStablesProvider');
  }
  return ctx;
}
