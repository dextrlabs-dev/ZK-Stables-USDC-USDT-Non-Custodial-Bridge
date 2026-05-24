# Burn Anchor Specification

This document defines how a `BurnIntent` ties a **redeem (BURN)** request to **on-chain evidence** on each source chain. The relayer uses `burnCommitmentHex` (64 hex chars, 32 bytes) plus optional `source.*` fields to compute `depositCommitment` and to run the **Burn -> Prove -> Unlock** pipeline per the SRS relayer requirements and [Deposit Commitment Encoding](deposit-commitment-encoding.md).

## Common Rules

- **`burnCommitmentHex`**: exactly 64 hexadecimal characters (optional `0x` prefix stripped everywhere). The same bytes must appear in the on-chain burn/release binding for that rail.
- **`source`**: optional anchor to the observed event or UTxO. When present, the relayer SHOULD validate consistency with `burnCommitmentHex` before enqueueing or during proving.

## EVM (zkUSDC / zkUSDT)

| Field | Source |
|-------|--------|
| On-chain action | `ZkStablesWrappedToken.burn(amount, recipientOnSource, nonce, burnCommitment)` |
| Event | `Burned(from, recipientOnSource, amount, nonce, burnCommitment)` |
| `burnCommitmentHex` | **Must equal** the `burnCommitment` topic/data from the log (32-byte value) |
| `source.evm` | `txHash`, `logIndex`, `wrappedTokenAddress`, `fromAddress`, `nonce` (bytes32), optional `blockNumber` |

Encoding for Midnight-facing `depositCommitment` uses `ZKStables:EVM:Burn:v1` -- see [`evmBurnCommitment.ts`](https://github.com/dextrlabs-dev/ZK-Stables-USDC-USDT-Non-Custodial-Bridge/blob/main/zk-stables-relayer/src/zk/evmBurnCommitment.ts).

## Cardano (Native ZK Rail + `lock_pool`)

There is **no** ERC-20-style public `burn` on Cardano in this repo. The zk-stable is represented as **native assets locked** at the Aiken [`lock_pool`](https://github.com/dextrlabs-dev/ZK-Stables-USDC-USDT-Non-Custodial-Bridge/blob/main/cardano/aiken/validators/lock_pool.ak) validator with inline [`LockDatum`](https://github.com/dextrlabs-dev/ZK-Stables-USDC-USDT-Non-Custodial-Bridge/blob/main/cardano/aiken/lib/zk_stables_bridge/types.ak).

| Field | Source |
|-------|--------|
| On-chain redeem | User (or operator) spends the lock UTxO with redeemer **`BridgeRelease`** |
| `burnCommitmentHex` | **Must equal** the `recipient_commitment` field in the **lock output's inline datum** (same bytes the relayer stored at mint+lock time) |
| `source.cardano` | `txHash` + `outputIndex` of the **lock UTxO** (the output that sits at `lock_pool` before release) |
| `source.cardano.spendTxHash` | If that UTxO is **already spent**, set this to the **BridgeRelease** transaction id so indexers need not resolve history from an unspent UTxO (optional; see relayer validation) |

Inner `event_commitment` for BURN uses `ZKStables:Cardano:Burn:v1` -- see [`cardanoEncoding.ts`](https://github.com/dextrlabs-dev/ZK-Stables-USDC-USDT-Non-Custodial-Bridge/blob/main/zk-stables-relayer/src/zk/cardanoEncoding.ts) `computeCardanoBurnEventCommitmentDigest`.

## Midnight (Compact `zk-stables`)

| Field | Source |
|-------|--------|
| On-chain action | Holder calls `initiateBurn(destChain, recipientComm)` then operator may call `finalizeBurn()` after the unlock pipeline |
| `burnCommitmentHex` | **Must equal** the 32-byte **`recipientComm`** passed to `initiateBurn` (hex-encoded) |
| `source.midnight` | `txId` (and/or `txHash`) of the transaction that included `initiateBurn`, plus optional `contractAddress` for disambiguation |

Until a full indexer watcher lands, the UI supplies `source.midnight` after the wallet/SDK completes `initiateBurn`. Inner `event_commitment` uses `ZKStables:Midnight:Burn:v1` -- see [`cardanoEncoding.ts`](https://github.com/dextrlabs-dev/ZK-Stables-USDC-USDT-Non-Custodial-Bridge/blob/main/zk-stables-relayer/src/zk/cardanoEncoding.ts) `computeMidnightBurnEventCommitmentDigest` and [`evmBurnCommitment.ts`](https://github.com/dextrlabs-dev/ZK-Stables-USDC-USDT-Non-Custodial-Bridge/blob/main/zk-stables-relayer/src/zk/evmBurnCommitment.ts) `computeBurnDepositCommitmentHexFromIntent`.

## UI Principle

Do not ask end users to paste raw `burnCommitmentHex` for happy paths: derive it from receipts (EVM), lock datum (Cardano), or circuit submission (Midnight), then submit the intent automatically.

## Related

- [Bridge Swap Flow](bridge-swap-flow.md) -- asset roles (mUSDC/mUSDT vs zk rails)
- [Deposit Commitment Encoding](deposit-commitment-encoding.md) -- canonical 32-byte commitment construction
- [System Overview](system-overview.md) -- high-level architecture and trust model

---

Source: [`docs/BURN_ANCHOR_SPEC.md`](https://github.com/dextrlabs-dev/ZK-Stables-USDC-USDT-Non-Custodial-Bridge/blob/main/docs/BURN_ANCHOR_SPEC.md)
