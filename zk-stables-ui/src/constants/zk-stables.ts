/** Must match [@zk-stables/midnight-contract](contract) `zkStablesPrivateStateId`. */
export const zkStablesPrivateStateId = 'zkStablesPrivateState' as const;

/** Compact `AssetKind` enum indices. */
export const AssetKind = {
  USDC: 0,
  USDT: 1,
} as const;
