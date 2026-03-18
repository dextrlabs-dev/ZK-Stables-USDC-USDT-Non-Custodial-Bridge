# Cardano local stack (Yaci) + relayer

To capture **Cardano transaction hashes** in relayer jobs (`destinationHint` lines like `Cardano payout tx: …`), you need:

1. An indexer (**Yaci Store** or **Blockfrost**).
2. **`RELAYER_CARDANO_WATCHER_ENABLED=true`** and **`RELAYER_CARDANO_BRIDGE_ENABLED=true`** (SRS).
3. A funded **`RELAYER_CARDANO_WALLET_MNEMONIC`** used for Mesh payouts.
4. **`RELAYER_CARDANO_LOCK_ADDRESS`** — bech32 address the lock watcher polls for UTxOs.

## Option A — Yaci DevKit (recommended local)

1. Install DevKit ([Docker setup](https://devkit.yaci.xyz/getting-started/docker)):

   ```bash
   curl --proto '=https' --tlsv1.2 -LsSf https://devkit.yaci.xyz/install.sh | bash
   ```

2. **Port clash with the bridge UI:** DevKit’s Yaci Viewer defaults to **5173**, the same as the ZK-Stables Vite app. Before `docker compose up`, set a different viewer port in `~/.yaci-devkit/config/env`, for example `HOST_VIEWER_PORT=5280`. Yaci Store stays on **8080** unless you change `HOST_STORE_API_PORT`.

3. From the repo, start containers and create the default devnet (non-interactive; uses `YACI_DEVKIT_ROOT` if set):

   ```bash
   ./scripts/start-yaci-devkit.sh
   ```

   Or interactively: `devkit start`, then in the CLI run `create-node -o --start`.

   To fund addresses from the CLI: `devnet:default> topup <addr_test1...> 10000`.

   **Or** from the repo (after DevKit admin is up on `RELAYER_YACI_ADMIN_URL`, default `:10000`): `npm run fund:cardano-yaci` — tops up every `addr_test1` in `zk-stables-relayer/.env` plus the Mesh change address from `RELAYER_CARDANO_WALLET_MNEMONIC` (default **50000** ADA each; override with `RELAYER_CARDANO_TOPUP_ADA`). This fixes Mesh `Insufficient input` / `ada in inputs: 0` when the bridge wallet has no UTxOs.

4. Point the relayer at Yaci Store (defaults match `cardano/ts/.env.example`):

   - `RELAYER_YACI_URL=http://127.0.0.1:8080/api/v1`
   - `RELAYER_YACI_ADMIN_URL=http://127.0.0.1:10000` (admin API for Mesh `YaciProvider` when needed)

5. Obtain a **lock script payment address** (UTxOs at this address are ingested by `cardanoLockWatcher`):

   - Run the Plutus lock flow under `cardano/ts` (e.g. `yaci-smoke` / lock scripts) and use the script address as `RELAYER_CARDANO_LOCK_ADDRESS`, **or**
   - Use any funded address you treat as the lock vault for demo polling (team-specific).

6. Fund the **bridge wallet** mnemonic on the same network (same `topup` or faucet).

7. Enable env in one shot:

   ```bash
   cd /path/to/ZK-Stables-USDC-USDT-Non-Custodial-Bridge
   export RELAYER_CARDANO_LOCK_ADDRESS=addr_test1...
   export RELAYER_CARDANO_WALLET_MNEMONIC="word1 word2 ... word24"
   set -a
   source scripts/relayer-cardano-srs.env.sh
   set +a
   ```

## Option B — Blockfrost (preprod / mainnet test project)

Unset `RELAYER_YACI_URL` and set:

- `RELAYER_BLOCKFROST_PROJECT_ID=<project_id>`
- `RELAYER_BLOCKFROST_NETWORK=preprod` (or `mainnet`)

Keep **`RELAYER_CARDANO_WATCHER_ENABLED=true`** and **`RELAYER_CARDANO_BRIDGE_ENABLED=true`**, and set the same lock address + mnemonic (funded on that network).

## Getting a Cardano tx hash in the report

- **LOCK to Cardano (EVM watcher)**: set `RELAYER_EVM_LOCK_DEST_CHAIN=cardano` and ensure the `Locked` event recipient is a valid **bech32** Cardano address.
- **LOCK from Cardano (Cardano watcher)**: deposit at `RELAYER_CARDANO_LOCK_ADDRESS`; watcher enqueues `sourceChain: cardano` jobs.
- **BURN to Cardano**: intent `recipient` as `addr1…` / `addr_test1…` with bridge enabled — settlement line: `Cardano unlock/payout tx: …`.

After the job completes, read `GET /v1/jobs/:id` and inspect `destinationHint`, or use the Bridge UI **Destination txs** section.

## Troubleshooting: UI shows `Yaci Store UTxOs: HTTP 500` (or 502 / 503)

The Vite dev app calls Yaci’s Blockfrost-compatible API via **`VITE_YACI_STORE_URL=/yaci-store`**, which **proxies to `http://127.0.0.1:8080`**. If nothing is listening there (Yaci Store not started, wrong port, or Docker not running), the proxy returns **5xx** and balance fetches fail.

**Fix:** run `./scripts/start-yaci-devkit.sh` (after installing DevKit), or start DevKit manually so **`http://127.0.0.1:8080/api/v1/blocks/latest`** returns JSON (quick check: `curl -sS http://127.0.0.1:8080/api/v1/blocks/latest`). Then restart `npm run dev` if you changed Docker networking.

**Optional:** point the UI at a remote Store by setting **`VITE_YACI_STORE_URL`** to the full base (e.g. `https://…/api/v1`) instead of `/yaci-store` (CORS must allow the browser origin).

### Conway submit: `NotAllowedSupplementalDatums`

If submit returns `ShelleyTxValidationError` / `NotAllowedSupplementalDatums`, the tx was attaching a **witness datum** while the spent UTxO already has an **inline datum**. The relayer and `cardano/ts` release/refund paths use Mesh **`txInInlineDatumPresent()`** for spends of `lock_pool` outputs created with `txOutInlineDatumValue` — upgrade the repo if you still see this on an older checkout.
