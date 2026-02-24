# Local bridge integration report

**Date:** 2026-04-01  
**Scope:** Non-synthetic `lockRef`, EVM lock watcher → Midnight destination, Merkle proofs, API JSON safety, Midnight deploy attempt.

## Changes implemented

1. **`lockRef` (anchored, not synthetic)** — `zk-stables-relayer/src/pipeline/lockRef.ts`  
   - On-chain: `evm:<txHash>:<logIndex>`, `cardano:<txHash>:<outputIndex>` (aligned with dedupe keys).  
   - API-only intents: `offchain:<sha256-prefix>:<random>`.

2. **EVM lock watcher** — default **`RELAYER_EVM_LOCK_DEST_CHAIN=midnight`** so `Locked` events target the Midnight mint pipeline (override `evm` for same-chain demos).

3. **`GET /v1/jobs` BigInt-safe JSON** — `serializeRelayerJob` clones jobs with a JSON replacer so Merkle fields (`blockNumber`, `logIndex`, etc.) do not break Hono responses.

4. **Root `postinstall`** — `scripts/postinstall-libsodium.mjs` fixes Mesh/libsodium ESM (`libsodium-sumo.mjs` copy) after `patch-package`.

5. **Scripts** — `evm/scripts/integration-emit-lock.js`, `scripts/local-bridge-integration.sh` (deploy + lock smoke).

6. **Example env** — `zk-stables-relayer/.env.integration.example` lists **all** SRS-required variables when `RELAYER_SRS_STRICT=true` (see [SRS_RELAYER_REQUIREMENTS.md](SRS_RELAYER_REQUIREMENTS.md)).

## Local test execution (this environment)

| Check | Result |
|--------|--------|
| Anvil `http://127.0.0.1:8545` | OK (`0x7a69` = 31337) |
| Midnight indexer GraphQL `http://127.0.0.1:8088/api/v4/graphql` | OK |
| EVM `deploy-anvil.js` + `integration-emit-lock.js` | OK — `Locked` at block 11 |
| Relayer EVM watcher + job pipeline | OK — job `lockRef=evm:0x55f0…:1`, `merkle-inclusion-v1`, phase `completed` |
| Midnight `deployContract` via relayer (`RELAYER_MIDNIGHT_AUTO_DEPLOY=true`, test mnemonic) | **Failed** — `Insufficient Funds: could not balance dust` (fund wallet per `local-cli/README.md`: `fund-and-register-dust` on the same `BIP39_MNEMONIC`) |
| Cardano Yaci path | Not exercised (no `RELAYER_YACI_URL` in this run) |

### Relayer settings that made EVM ingestion reliable on Anvil

- **`RELAYER_EVM_CONFIRMATIONS=0`** — With default `1`, if the chain tip equals the block of the log (`tip - confirmations` excludes that block until more blocks are mined). For quiet Anvil chains, either mine extra blocks (`anvil_mine`) or set confirmations to `0` locally.

## Three-chain checklist (operator, SRS — all required)

1. **EVM:** Anvil + deploy contracts; set all `RELAYER_EVM_*` variables in [SRS_RELAYER_REQUIREMENTS.md](SRS_RELAYER_REQUIREMENTS.md).  
2. **Midnight:** Brick Towers `midnight-local-network` compose; fund `GENESIS_SEED_HASH_HEX` / `BIP39` wallet; contract join or auto-deploy.  
3. **Cardano:** Yaci or Blockfrost; `RELAYER_CARDANO_WATCHER_ENABLED=true`, `RELAYER_CARDANO_BRIDGE_ENABLED=true`, lock address, Mesh mnemonic.

## Command recap

```bash
# EVM deploy + one lock (addresses in /tmp/zk-stables-anvil-addrs.json)
cd evm && EVM_RPC_URL=http://127.0.0.1:8545 npx hardhat run scripts/deploy-anvil.js --network anvil | awk '/^\{/{p=1}p' > /tmp/zk-stables-anvil-addrs.json
DEPLOY_ADDRS_JSON=/tmp/zk-stables-anvil-addrs.json npx hardhat run scripts/integration-emit-lock.js --network anvil

# Relayer (example)
cd zk-stables-relayer
export RELAYER_EVM_CONFIRMATIONS=0
export RELAYER_EVM_LOCK_ADDRESS="<poolLock from JSON>"
export RELAYER_EVM_LOCK_DEST_CHAIN=midnight
export RELAYER_MIDNIGHT_ENABLED=true   # after funding BIP39 on local Midnight
export BIP39_MNEMONIC="…"
npm start
```

---

*Generated as part of the zk-stables relayer integration pass; re-run `scripts/local-bridge-integration.sh` after starting local stacks.*
