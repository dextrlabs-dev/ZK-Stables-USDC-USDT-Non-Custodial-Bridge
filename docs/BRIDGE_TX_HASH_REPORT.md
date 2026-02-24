# Bridge transaction hash report

## Latest: three-chain integration — 2026-04-01 (relayer port **8822**)

**Stacks:** Anvil `http://127.0.0.1:8545` (chainId 31337), Yaci Store `http://127.0.0.1:8080/api/v1` (Docker `node1-yaci-cli-1`, protocol magic **42**), Midnight indexer `http://127.0.0.1:8088/api/v4/graphql`, proof-server `http://127.0.0.1:6300`, relayer `http://127.0.0.1:8822`. **`RELAYER_SRS_STRICT=false`** for this dev run (SRS production checklist still in [SRS_RELAYER_REQUIREMENTS.md](SRS_RELAYER_REQUIREMENTS.md)).

**Cardano bridge wallet:** fund the Mesh-derived address for the `abandon…about` mnemonic by moving **50 ADA** from the devnet `utxo1` key inside the Yaci container (`cardano-cli latest transaction build|sign|submit`). Without this balance, `Cardano payout tx:` cannot be produced.

### Cardano (Yaci devnet)

| Item | Value |
|------|--------|
| **Pre-fund tx** (utxo1 → bridge `changeAddress` for abandon mnemonic) | `d72589d1821994e87654424f13eadc0b17eae71499735dd18064c2f3273bb5d0` |
| Bridge wallet address (abandon mnemonic, Mesh / preview) | `addr_test1qq8ac7qqy0vtulyl7wntmsxc6wex80gvcyjy33qffrhm7sh927ysx5sftuw0dlft05dz3c7revpf7jx0xnlcjz3g69mqkt5dmn` |
| **`POST /v1/intents/lock` LOCK → Cardano** (operator payout) | `d3e07a75b88116781abcb578574a3c4cf6bcf39ca3df5e50e3ff687215318237` |
| Job id | `job_1775042694432_3a027874` |

Yaci Store confirms the payout: `GET /api/v1/txs/d3e07a75b88116781abcb578574a3c4cf6bcf39ca3df5e50e3ff687215318237`.

### EVM (Anvil)

| Item | Value |
|------|--------|
| **Pool `lock()` tx** (`integration-emit-lock.js`) | `0xd066fb81064e17470b1e7f412c374a38e940962af6cb10944fe2f76ae30028cf` |
| Block | `71` |
| `ZkStablesPoolLock` | `0xFD471836031dc5108809D173A067e8486B9047A3` |
| Mock USDC | `0x7bc06c482DEAd17c0e297aFbC32f6e63d3846650` |

Deploy artifact for this run: `/tmp/fulltest-addrs.json`.

### Midnight

| Item | Value |
|------|--------|
| Contract (from Cardano-watcher job hint) | `d278a6f30d97bd078facb80374ce9025213c166792cff4a49b38402e081e2542` |
| **`mintWrappedUnshielded` txHash** (Cardano → Midnight job) | `cd5bb44b02126986a253c36cac4c67e3942ac221ea60870124fd7d11b63311a9` |
| **`mintWrappedUnshielded` txId** | `00fced380a199a9f75057ce8d2fa09f5c6e0bab942f91b76a621a37e64a44b1b29` |

**EVM → Midnight** job `job_1775042679328_dbf1e334` (`lockRef` `evm:0xd066fb81…:1`) **failed** during the Midnight step with `Unexpected error executing scoped transaction … Database failed to open` (local Midnight wallet / SQLite environment). **Cardano lock watcher → Midnight** job `job_1775042703056_39f9e2f7` **completed**; `proveHolder` logged the same DB error in `destinationHint`, but **`mintWrappedUnshielded` succeeded** (tx ids above).

### Relayer jobs (this run)

| Job id | Route | `lockRef` | Phase | Notes |
|--------|--------|-----------|-------|--------|
| `job_1775042694432_3a027874` | API LOCK → **Cardano** | `offchain:…` | `completed` | `Cardano payout tx: d3e07a75…` |
| `job_1775042679328_dbf1e334` | EVM watcher → **Midnight** | `evm:0xd066fb81…:1` | `failed` | Merkle proof OK; Midnight DB error |
| `job_1775042703056_39f9e2f7` | Cardano watcher → **Midnight** | `cardano:d3e07a75…:0` | `completed` | UTxO from payout to `RELAYER_CARDANO_LOCK_ADDRESS`; mint tx above |

**Watcher note:** `RELAYER_CARDANO_LOCK_ADDRESS` was set to the same demo bech32 as `RELAYER_BRIDGE_CARDANO_RECIPIENT`, so the payout output at that address was picked up as a lock UTxO. For production, use a dedicated lock script address.

---

## Earlier run — 2026-04-01 (relayer port **8811**, Midnight only)

**Environment:** Anvil, Midnight indexer, relayer **8811**, **`RELAYER_SRS_STRICT=false`**, no Cardano indexer.

### EVM (Anvil)

| Item | Value |
|------|--------|
| **Pool `lock()` tx** | `0xdfadedc9c10697680fdb675bd68bc0f291978fbe2d82346e431edbeaf7acdf1a` |
| Block | `49` |
| `ZkStablesPoolLock` | `0xf5059a5D33d5853360D16C683c16e67980206f36` |

### Midnight

| Item | Value |
|------|--------|
| **zk-stables contract address** | `d4eacd70f8c66fc2f1d15fafdd799844404ca9ba0d95c6a0c6c5053ecd1e938f` |
| **`proveHolder` txHash** | `07e5189d4a1e7fa20c20e22ed1ef35b3f75b5ddfdf44010e3569fe518d2ad4ef` |
| **`mintWrappedUnshielded` txHash** | `488a470ba0295bc50dd1ea6de06253914a534f6ccdc089e03e43dafdb4fbcd9a` |

### Relayer job

| Field | Value |
|--------|--------|
| Job id | `job_1775041748006_13a11754` |
| `lockRef` | `evm:0xdfadedc9c10697680fdb675bd68bc0f291978fbe2d82346e431edbeaf7acdf1a:1` |
| Phase | `completed` |

---

## SRS policy (reference)

Every chain and operation required by the SRS must be configured for production — see [SRS_RELAYER_REQUIREMENTS.md](SRS_RELAYER_REQUIREMENTS.md). Enforcement: `RELAYER_SRS_STRICT=true`.

---

## Reproduce

### Three-chain dev (Yaci + Anvil + Midnight), relayer **8822**

1. Start Anvil, Midnight stack, Yaci (e.g. Docker DevKit; Store on **8080**, admin **10000**).
2. Fund the relayer Cardano mnemonic on the devnet (see **Cardano** section above).
3. Deploy EVM and emit lock:

```bash
cd evm && EVM_RPC_URL=http://127.0.0.1:8545 npx hardhat run scripts/deploy-anvil.js --network anvil | awk '/^\{/{p=1}p' > /tmp/fulltest-addrs.json
DEPLOY_ADDRS_JSON=/tmp/fulltest-addrs.json npx hardhat run scripts/integration-emit-lock.js --network anvil
```

4. Export pool + tokens from `/tmp/fulltest-addrs.json`, set `RELAYER_EVM_*`, `RELAYER_YACI_URL`, `RELAYER_CARDANO_*`, `GENESIS_SEED_HASH_HEX`, `RELAYER_MIDNIGHT_*`, `RELAYER_BRIDGE_*` (see [`.env.integration.example`](../zk-stables-relayer/.env.integration.example)).
5. `cd zk-stables-relayer && RELAYER_PORT=8822 npm start`
6. Optional Cardano payout smoke:

```bash
curl -s -X POST http://127.0.0.1:8822/v1/intents/lock -H 'content-type: application/json' \
  -d '{"operation":"LOCK","sourceChain":"evm","destinationChain":"cardano","asset":"USDC","assetKind":0,"amount":"1.0","recipient":"addr_test1qq4jrrcfzylccwgqu3su865es52jkf7yzrdu9cw3z84nycnn3zz9lvqj7vs95tej896xkekzkufhpuk64ja7pga2g8ksdf8km4"}'
```

### EVM + Midnight only (no Cardano)

See commands in section **Earlier run**; use `RELAYER_PORT=8811` or any free port.

### Full SRS including Cardano

See [CARDANO_LOCAL_YACI.md](CARDANO_LOCAL_YACI.md) and the **Full SRS** block in the previous revision (Yaci or Blockfrost, all `RELAYER_CARDANO_*`, `RELAYER_SRS_STRICT=true`).

---

*Stop a test relayer with `fuser -k <port>/tcp` (e.g. `8822`).*
