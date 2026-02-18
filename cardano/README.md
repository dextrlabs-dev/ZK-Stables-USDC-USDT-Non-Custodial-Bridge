# Cardano bridge (Phase 3)

Cardano support in the ZK-Stables bridge combines **on-chain Plutus** (Aiken), **normative off-chain encodings** in the contract docs, and the **reference relayer** (`zk-stables-relayer`) for finality-aware observation and proof-oriented digests.

## Normative architecture / requirements (PDFs)

The architectural planning / feasibility report and software requirements PDFs are cited by the internal docs below; copy them into your tree if you need the originals (paths vary by checkout).

Executable specs used by validators and relayer code in this repository:

- [`contract/docs/DEPOSIT_COMMITMENT_ENCODING.md`](../contract/docs/DEPOSIT_COMMITMENT_ENCODING.md) — `operation_type`, `depositCommitment` preimage, and **Cardano `event_commitment`** for a lock UTxO.
- [`contract/docs/BRIDGE_PROOF_BINDING.md`](../contract/docs/BRIDGE_PROOF_BINDING.md) — proofs bind finalized header, event inclusion, and nonce replay; Compact does not verify the cross-chain SNARK.

## On-chain: Aiken package (`cardano/aiken`)

Prerequisites: [Aiken](https://aiken-lang.org/) CLI (example install: see project CI or pin a release binary).

```bash
cd cardano/aiken
aiken check
aiken build   # generates plutus.json (tracked for consumers)
```

- **Validators**: `validators/lock_pool.ak` (lock UTxO spend: refund vs release paths), `validators/unlock_pool.ak` (parametric nonce registry with a **fixed cap of 64** `used_nonces` entries per UTxO — rotate or shard registries for more capacity; see script comments in-repo).
- **Types**: `lib/zk_stables_bridge/types.ak` — datums aligned with bridge intent fields the relayer and encoding doc expect.
- **`plutus.json`**: script hashes and compiled artifacts for wallets / Mesh / deployment tooling.

**Trust model (v1)**: validators enforce chain-local value and authorization (depositor refund, optional bridge operator on release). **Finality, cross-chain inclusion, and ticket-level replay** remain the SNARK + relayer pipeline and Midnight commitments — not reimplemented inside Compact.

## Off-chain locking pattern (Mesh)

End-to-end transaction building (datum hash, collateral, UTxO selection) follows the same patterns as the official Aiken example **hello_world**:

- Upstream reference: [aiken `examples/hello_world`](https://github.com/aiken-lang/aiken/tree/main/examples/hello_world).
- Local clone for experiments: `/root/aiken/examples/hello_world` (lock flow uses `txOut` + `txOutDatumHashValue`).

## Off-chain transaction tooling (`cardano/ts`)

This package drives the Aiken validators with [**Mesh**](https://meshjs.dev/) and the repo-root **`cardano/aiken/plutus.json`** (run `aiken build` first).

```bash
cd cardano/ts
npm install
cp .env.example .env   # set BLOCKFROST_PROJECT_ID, CARDANO_WALLET_MNEMONIC, etc. — never commit secrets
npm run typecheck
```

| npm script | Purpose |
|------------|---------|
| `npm run lock` | Create a lock UTxO (`txOutDatumHashValue` + `LockDatum`) |
| `npm run refund -- <txHash#ix>` | Depositor `UserRefund` (+ collateral) |
| `npm run release -- <txHash#ix>` | `BridgeRelease` (recipient or operator must sign per datum) |
| `npm run registry:init` | Pay to `unlock_pool(parameterized)` with empty `RegistryDatum` (inline datum) |
| `npm run registry:append -- <txHash#ix> [nonceHex]` | Operator records a nonce (continuing inline datum) |

Library entrypoint: `import { submitLock, submitRefund, … } from '@zk-stables/cardano-offchain'` (path: `cardano/ts/src/index.ts`).

**Env (subset):** see `cardano/ts/.env.example` plus `LOCK_LOVELACE`, `LOCK_UTXO_REF`, `LOCK_REFUND_TO_ADDRESS`, `LOCK_RELEASE_TO_ADDRESS`, `LOCK_POLICY_ID_HEX` / `LOCK_ASSET_NAME_HEX`, `BRIDGE_OPERATOR_VKEY_HASH`, `REGISTRY_*`, and datum fields in `src/cli/common.ts`.

**Guarantees:** refunds/releases attach a `txOut` paying the script-held assets to `LOCK_REFUND_TO_ADDRESS` / `LOCK_RELEASE_TO_ADDRESS` (default: wallet change). You should set payout addresses explicitly in production. **`unlock_pool` must use inline datum** so `registry-append` can read `plutusData`.

## Relayer: Cardano lock watcher and digests

When `RELAYER_CARDANO_WATCHER_ENABLED=true`, the relayer polls **Yaci Store** or **Blockfrost** for UTxOs at **`RELAYER_CARDANO_LOCK_ADDRESS`** (bech32 from your deployed script + network), enqueues `LOCK` intents with `source.cardano`, and:

- If **`RELAYER_YACI_URL`** or **`YACI_URL`** is set, Cardano indexer access is **Yaci only** (Blockfrost is not used for Cardano health, watcher, or finality, even if a Blockfrost project id is present).
- Waits **`RELAYER_CARDANO_CONFIRMATIONS`** (default `8`) after the observed block height when the corresponding indexer tip is available (Yaci or Blockfrost).
- Builds **`stub-sha256-v1` proof metadata** that includes **`eventCommitmentHex`** and **`depositCommitmentHex`** when preimage fields are known, using `zk-stables-relayer/src/zk/cardanoEncoding.ts` and `DEPOSIT_COMMITMENT_ENCODING.md`.

Useful env vars (see also `zk-stables-relayer/README.md`):

| Variable | Purpose |
|----------|---------|
| `RELAYER_CARDANO_WATCHER_ENABLED` | `true` to run the watcher |
| `RELAYER_CARDANO_LOCK_ADDRESS` | Script address to scan |
| `RELAYER_CARDANO_LOCK_SCRIPT_HASH` | Optional hex metadata on intents |
| `RELAYER_YACI_URL` / `YACI_URL` | Yaci Store API base (local devnet); takes precedence for Cardano |
| `RELAYER_BLOCKFROST_PROJECT_ID` / `RELAYER_BLOCKFROST_NETWORK` | Blockfrost when no Yaci URL is set |
| `RELAYER_CARDANO_CONFIRMATIONS` | Block depth after inclusion |
| `RELAYER_CARDANO_POLL_MS` | Poll interval |
| `RELAYER_ZK_SOURCE_CHAIN_ID` / `RELAYER_ZK_DEST_CHAIN_ID` | UInt32 public inputs for stub `depositCommitment` (default `0` until assigned) |
| `RELAYER_CARDANO_DEST_CHAIN`, `RELAYER_CARDANO_RECIPIENT_STUB`, `RELAYER_CARDANO_DEFAULT_ASSET`, `RELAYER_CARDANO_ASSET_KIND` | Stub intent fields for automation |

**Operational note**: Blockfrost polling is suitable for bringing up Preprod; production should plan **Kupo + Ogmios** (or similar) for durable cursors and reorg-aware ingestion.

## Networks and assets

- **Yaci local devnet**: point `RELAYER_YACI_URL` (or `YACI_URL`) at Yaci Store, e.g. `http://127.0.0.1:8080/api/v1`.
- **Preprod vs mainnet** (Blockfrost): `RELAYER_BLOCKFROST_NETWORK` must match the Blockfrost project.
- **USDC/USDT on Cardano**: this scaffold uses generic `policyId` + `assetName` (see encoding doc). Choose a test policy on Preprod for demos; mainnet native stable representation is a separate product decision.
