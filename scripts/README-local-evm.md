# Local EVM (Foundry Anvil) + relayer + UI

1. **Start Anvil** (chain id **31337**, same as wagmi `localhost`):

   ```bash
   chmod +x scripts/anvil-docker.sh scripts/anvil-stop.sh
   ./scripts/anvil-docker.sh
   ```

   Or install [Foundry](https://getfoundry.sh) and run `anvil --host 0.0.0.0 --port 8545`.

2. **Relayer** — defaults to `RELAYER_EVM_RPC_URL=http://127.0.0.1:8545` for `/v1/health/chains`:

   ```bash
   cd zk-stables-relayer && npm start
   ```

   Optional: `RELAYER_ENABLE_DEMO_WALLETS=true` so the bridge UI can load **`GET /v1/demo/wallets`** (server mnemonics / derived EVM keys in dev).

   Check: `curl -s http://127.0.0.1:8787/v1/health/chains | jq .evm`

3. **Frontend** — `zk-stables-ui` uses `VITE_ETH_LOCALHOST_RPC_URL` (default `http://127.0.0.1:8545`). In the **Ethereum** card, connect MetaMask and **Switch chain → Localhost (31337)**. Add the network manually if needed (RPC `http://127.0.0.1:8545`, chain id `31337`).

4. **Stop Anvil (Docker)**:

   ```bash
   ./scripts/anvil-stop.sh
   ```

**Docker note:** the script uses `--network host` so Anvil binds correctly on Linux. On **Docker Desktop (macOS/Windows)**, use native `anvil` or publish ports and ensure Anvil listens on `0.0.0.0` inside the container.
