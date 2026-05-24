# Bridge CLI (`zk-bridge`)

Command-line tool for ZK-Stables bridge operations: locking underlying tokens, submitting intents to the relayer, redeeming burns, monitoring balances, and inspecting jobs. Source code lives in [`bridge-cli/`](https://github.com/dextrlabs-dev/ZK-Stables-USDC-USDT-Non-Custodial-Bridge/tree/main/bridge-cli).

## Installation

```bash
cd bridge-cli
npm install
npm run build
```

The compiled binary is at `dist/cli.js`, registered as `zk-bridge` in `package.json`.

## Global options

| Flag | Env variable | Description |
|------|-------------|-------------|
| `--relayer-url <url>` | `BRIDGE_CLI_RELAYER_URL` | Relayer base URL |
| `--rpc-url <url>` | `BRIDGE_CLI_EVM_RPC_URL` | EVM JSON-RPC endpoint |
| `--private-key <hex>` | `BRIDGE_CLI_EVM_PRIVATE_KEY` | EVM signer private key (0x...) |
| `--addresses-json <path>` | `BRIDGE_CLI_ADDRESSES_JSON` | Deploy JSON with contract addresses |
| `--json` | -- | Machine-readable JSON output |

## Commands

### `zk-bridge mint`

Lock underlying USDC/USDT on EVM (approve + `ZkStablesPoolLock.lock`), then POST a LOCK intent to the relayer with the `Locked` log as anchor.

```bash
zk-bridge mint \
  --destination midnight \
  --asset USDC \
  --amount 1.0 \
  --recipient <address>
```

| Option | Description |
|--------|-------------|
| `--destination <chain>` | `evm`, `cardano`, or `midnight` (required) |
| `--asset <sym>` | `USDC` or `USDT` (required) |
| `--amount <decimal>` | Human-readable amount, 6 decimals (required) |
| `--recipient <addr>` | Destination address (required) |
| `--follow` / `--no-follow` | Poll relayer job until terminal (default: true) |
| `--wait-timeout-ms <n>` | Max wait time (default: 900000) |
| `--poll-ms <n>` | Poll interval (default: 2000) |

### `zk-bridge redeem evm`

Burn zkUSDC/zkUSDT on EVM, then POST a BURN intent with the `Burned` log anchor.

```bash
zk-bridge redeem evm \
  --asset USDC \
  --amount 1.0 \
  --payout 0x...
```

| Option | Description |
|--------|-------------|
| `--asset <sym>` | `USDC` or `USDT` (required) |
| `--payout <0x>` | EVM address for unlocked underlying (required) |
| `--amount <decimal>` | Burn amount (required unless `--from-tx`) |
| `--burn-commitment <0x>` | 32-byte commitment; random if omitted |
| `--from-tx <0x>` | Use an existing burn tx instead of sending `burn()` |

### `zk-bridge redeem cardano`

Submit a BURN intent after BridgeRelease from the Cardano `lock_pool`.

```bash
zk-bridge redeem cardano \
  --asset USDC \
  --amount 1.0 \
  --payout 0x... \
  --burn-commitment <64hex> \
  --lock-tx <64hex> \
  --lock-output-index 0 \
  --spend-tx <64hex>
```

### `zk-bridge redeem midnight`

Submit a BURN intent after `initiateBurn` on Midnight.

```bash
zk-bridge redeem midnight \
  --asset USDC \
  --amount 1.0 \
  --payout 0x... \
  --burn-commitment <64hex> \
  --deposit-commitment <64hex> \
  --tx-id <midnight-tx-id>
```

### `zk-bridge job <id>`

Fetch a relayer job by UUID. Use `--follow` to poll until the job reaches a terminal phase.

```bash
zk-bridge job <uuid> --follow
```

### `zk-bridge balances`

Print a JSON snapshot of balances across chains: EVM underlying (mUSDC/mUSDT), Cardano native zk units, and Midnight unshielded zk.

```bash
zk-bridge balances --json
```

### `zk-bridge dashboard`

Interactive TTY dashboard with auto-refreshing balances. Keys: `[r]` refresh, `[m]` run a command, `[q]` quit.

```bash
zk-bridge dashboard --interval-ms 2500
```

### `zk-bridge info`

Print parsed environment and token mapping (no on-chain writes).

```bash
zk-bridge info --json
```

## Dependencies

- [Commander](https://www.npmjs.com/package/commander) for CLI parsing
- [viem](https://viem.sh/) for EVM interactions
- Midnight wallet SDK packages for balance queries
