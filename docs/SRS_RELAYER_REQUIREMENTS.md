# SRS — relayer environment (non-optional)

This project treats the **bridge relayer** as implementing the architecture flows **Lock → Prove → Mint** and **Burn → Prove → Unlock** across **EVM**, **Cardano**, and **Midnight** (SRS §3.1.1–3.1.5, plan: any-to-any 3×3, USDC/USDT).

There are **no optional chains** for a compliant deployment: every chain adapter required for those operations must be configured.

## Enforcement

Set **`RELAYER_SRS_STRICT=true`** on the relayer. Startup **fails** if any required variable below is missing or any required flag is not `true`/`1`.

For partial local debugging only, set **`RELAYER_SRS_STRICT=false`** (not SRS-complete).

Legacy: **`RELAYER_REQUIRE_MIDNIGHT_AND_CARDANO=true`** (without `RELAYER_SRS_STRICT`) still enforces only Midnight + Cardano indexer/features.

## Required variables (when `RELAYER_SRS_STRICT=true`)

### EVM

| Variable | Role |
|----------|------|
| `RELAYER_EVM_LOCK_ADDRESS` | Ingest `Locked` events (LOCK source on EVM). |
| `RELAYER_EVM_WRAPPED_TOKEN` | Ingest `Burned` events (BURN source on EVM). |
| `RELAYER_EVM_POOL_LOCK` | `unlockWithInclusionProof` after BURN proof. |
| `RELAYER_EVM_UNDERLYING_TOKEN` | Underlying ERC-20 for unlock. |
| `RELAYER_EVM_PRIVATE_KEY` | Operator key for unlock + mint. |
| `RELAYER_EVM_BRIDGE_MINT` | `mintWrapped` for LOCK → EVM destination. |

Also set `RELAYER_EVM_WRAPPED_TOKEN` to the token the burn watcher monitors (same as above if one token).

### Cardano

| Variable | Role |
|----------|------|
| `RELAYER_YACI_URL` **or** `RELAYER_BLOCKFROST_PROJECT_ID` | Indexer API (health, watcher, finality, Mesh). With Yaci, set `RELAYER_YACI_ADMIN_URL` if Mesh needs the admin API (see `cardano/ts/.env.example`). |
| `RELAYER_CARDANO_LOCK_ADDRESS` | Lock script payment address for the watcher. |
| `RELAYER_CARDANO_WALLET_MNEMONIC` or `CARDANO_WALLET_MNEMONIC` | Mesh wallet for bridge payouts. |
| `RELAYER_CARDANO_WATCHER_ENABLED` | Must be `true` — ingest lock UTxOs. |
| `RELAYER_CARDANO_BRIDGE_ENABLED` | Must be `true` — settlement payouts. |

### Midnight

| Variable | Role |
|----------|------|
| `RELAYER_MIDNIGHT_ENABLED` | Must be `true`. |
| `GENESIS_SEED_HASH_HEX` **or** `BIP39_MNEMONIC` | Relayer wallet (see `src/midnight/service.ts`). |
| `RELAYER_MIDNIGHT_CONTRACT_ADDRESS` **or** `RELAYER_MIDNIGHT_AUTO_DEPLOY=true` | Join or deploy zk-stables. |

### Bridge operator + demo (SRS UI / intents)

| Variable | Role |
|----------|------|
| `RELAYER_ENABLE_DEMO_WALLETS` | Must be `true` for `GET /v1/demo/wallets`. |
| `RELAYER_BRIDGE_EVM_RECIPIENT` | Default `0x` operator recipient. |
| `RELAYER_BRIDGE_CARDANO_RECIPIENT` | Default Cardano operator recipient. |
| `RELAYER_BRIDGE_MIDNIGHT_RECIPIENT` | Default Midnight bech32 recipient. |

## Reference template

See `zk-stables-relayer/.env.integration.example` (all keys populated; replace placeholders with your network values).
