# API Reference

The ZK-Stables relayer exposes an HTTP API (powered by [Hono](https://hono.dev/)) for bridge operations, job management, and health checks. Default base URL: `http://127.0.0.1:8787` (configurable via `RELAYER_PORT`).

---

## Health endpoints

### `GET /health`

Liveness probe. Always returns 200 when the relayer process is running.

**Response:**

```json
{
  "ok": true,
  "service": "zk-stables-relayer"
}
```

### `GET /v1/health/chains`

Chain connectivity status. Checks EVM JSON-RPC, Midnight indexer, Cardano indexer (Yaci or Blockfrost), and reports which `relayerBridge` wallets are configured.

**Response:**

```json
{
  "evm": { "ok": true, "chainId": 31337 },
  "midnight": { "ok": true },
  "cardano": { "ok": true, "tip": 12345 },
  "relayerBridge": {
    "evm": true,
    "cardano": true,
    "midnight": false
  }
}
```

---

## Intent endpoints

### `POST /v1/intents/lock`

Enqueue a LOCK intent. The relayer creates a job that progresses through finality, proving, and destination settlement.

**Request body** (`LockIntent`):

```json
{
  "operation": "LOCK",
  "sourceChain": "evm",
  "destinationChain": "midnight",
  "asset": "USDC",
  "assetKind": 0,
  "amount": "1.0",
  "recipient": "addr_test1qq...",
  "source": {
    "evm": {
      "txHash": "0x...",
      "logIndex": 1,
      "blockNumber": "71",
      "poolLockAddress": "0x...",
      "token": "0x...",
      "nonce": "0x..."
    },
    "cardano": {
      "txHash": "abc123...",
      "outputIndex": 0,
      "blockHeight": "500",
      "scriptHash": "...",
      "policyIdHex": "...",
      "assetNameHex": "...",
      "lockNonce": "0"
    }
  },
  "connected": {
    "evm": "0x...",
    "cardano": "addr_test1...",
    "midnight": "...",
    "midnightUnshielded": "mn_addr_..."
  },
  "note": "optional memo"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `operation` | `"LOCK"` | Yes | Must be `"LOCK"` |
| `sourceChain` | `"evm" \| "cardano" \| "midnight"` | Yes | Chain where the lock originated |
| `destinationChain` | `string` | No | Target chain for minting (default from watcher config) |
| `asset` | `"USDC" \| "USDT"` | Yes | Stablecoin asset |
| `assetKind` | `number` | Yes | Asset kind discriminator (0 = USDC, 1 = USDT) |
| `amount` | `string` | Yes | Decimal amount (e.g. `"1.0"`) |
| `recipient` | `string` | Yes | Destination address (bech32 for Cardano, `0x` for EVM, etc.) |
| `source` | `object` | No | On-chain anchor for proving (EVM and/or Cardano fields) |
| `connected` | `object` | No | Connected wallet addresses (UI echo) |
| `note` | `string` | No | Optional memo |

**Response** (201):

```json
{
  "id": "job_1775042694432_3a027874",
  "intent": { "...LockIntent fields..." },
  "phase": "received",
  "createdAt": "2026-04-01T12:00:00.000Z",
  "updatedAt": "2026-04-01T12:00:00.000Z",
  "lockRef": "offchain:abc123:def456",
  "ui": {
    "phaseLabel": "Received",
    "phaseIndex": 0,
    "phaseCount": 5
  }
}
```

### `POST /v1/intents/burn`

Enqueue a BURN intent. The relayer processes the redeem/unlock flow.

**Request body** (`BurnIntent`):

```json
{
  "operation": "BURN",
  "sourceChain": "evm",
  "destinationChain": "evm",
  "asset": "USDC",
  "assetKind": 0,
  "amount": "1.0",
  "recipient": "0x...",
  "burnCommitmentHex": "abcdef0123456789...",
  "source": {
    "evm": {
      "txHash": "0x...",
      "logIndex": 1,
      "blockNumber": "100",
      "wrappedTokenAddress": "0x...",
      "nonce": "0x...",
      "fromAddress": "0x..."
    },
    "cardano": {
      "txHash": "...",
      "outputIndex": 0,
      "blockHeight": "500",
      "scriptHash": "...",
      "spendTxHash": "..."
    },
    "midnight": {
      "txId": "...",
      "txHash": "...",
      "contractAddress": "...",
      "destChainId": 0,
      "lockNonce": "0",
      "depositCommitmentHex": "..."
    }
  },
  "note": "optional memo"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `operation` | `"BURN"` | Yes | Must be `"BURN"` |
| `sourceChain` | `"evm" \| "cardano" \| "midnight"` | Yes | Chain where the burn occurred |
| `destinationChain` | `string` | No | Target chain for unlock |
| `asset` | `"USDC" \| "USDT"` | Yes | Stablecoin asset |
| `assetKind` | `number` | Yes | Asset kind discriminator |
| `amount` | `string` | Yes | Decimal amount |
| `recipient` | `string` | Yes | Address to receive unlocked funds |
| `burnCommitmentHex` | `string` | Yes | 32-byte hex binding the burn to a deposit/ticket |
| `source` | `object` | No | On-chain anchor (EVM, Cardano, and/or Midnight fields) |
| `note` | `string` | No | Optional memo |

**Response** (201): Same shape as LOCK response with the `BurnIntent` in the `intent` field.

---

## Job endpoints

### `GET /v1/jobs`

List all jobs in memory. Development/testing only -- jobs are not persisted across restarts.

**Response:**

```json
{
  "jobs": [
    {
      "id": "job_1775042694432_3a027874",
      "intent": { "..." },
      "phase": "completed",
      "createdAt": "2026-04-01T12:00:00.000Z",
      "updatedAt": "2026-04-01T12:00:05.000Z",
      "lockRef": "evm:0xd066fb81...:1",
      "proofBundle": {
        "algorithm": "merkle-inclusion-v1",
        "digest": "0x...",
        "publicInputsHex": "0x...",
        "inclusion": { "..." }
      },
      "destinationHint": "...",
      "depositCommitmentHex": "..."
    }
  ]
}
```

### `GET /v1/jobs/:id`

Get a single job by id.

**Response** (200):

```json
{
  "id": "job_1775042694432_3a027874",
  "intent": { "..." },
  "phase": "completed",
  "createdAt": "...",
  "updatedAt": "...",
  "lockRef": "offchain:...",
  "proofBundle": { "..." },
  "destinationHint": "..."
}
```

**Response** (404):

```json
{ "error": "not found" }
```

---

## Bridge endpoints

### `GET /v1/bridge/recipients`

Returns the configured `RELAYER_BRIDGE_*` operator wallet addresses. Protect this endpoint in production.

**Response:**

```json
{
  "evmRecipient": "0x...",
  "cardanoRecipient": "addr_test1...",
  "midnightRecipient": "mn_addr_..."
}
```

### `GET /v1/cardano/bridge-metadata`

Returns lock pool script CBOR and address for Mesh-based browser integration.

**Response:**

```json
{
  "scriptCbor": "...",
  "scriptAddress": "addr_test1..."
}
```

---

## Midnight endpoints

### `GET /v1/midnight/contract`

Returns the currently deployed or joined Midnight contract address (when `RELAYER_MIDNIGHT_ENABLED=true`).

**Response:**

```json
{
  "contractAddress": "d278a6f30d97bd078facb80374ce9025213c166792cff4a49b38402e081e2542"
}
```

### `POST /v1/midnight/initiate-burn`

Initiate a burn on the Midnight contract. Used by the UI or CLI to start the redeem flow from Midnight.

---

## Demo endpoints

### `GET /v1/demo/wallets`

Available only when `RELAYER_ENABLE_DEMO_WALLETS=true`. Returns deterministic wallet addresses for testing.

**Response:**

```json
{
  "evm": [
    {
      "address": "0x...",
      "privateKey": "0x...",
      "balances": { "USDC": "10000", "USDT": "10000" }
    }
  ],
  "cardano": [
    { "address": "addr_test1...", "label": "source" },
    { "address": "addr_test1...", "label": "destination" }
  ],
  "midnight": {
    "shielded": "...",
    "unshielded": "mn_addr_..."
  }
}
```

**Note:** Mnemonics and private keys are only included when `NODE_ENV` is not `production`.

---

## Operator console endpoints

These endpoints support the bridge operator console UI:

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/v1/bridge/console-state` | Aggregated bridge state for operator dashboard |
| `GET` | `/v1/console/bridge-state` | Alias for the above |
| `GET` | `/v1/evm/recent-locks` | Recent EVM lock events from the watcher |
| `GET` | `/v1/evm/recent-burn-hints` | Recent EVM burn hints |
| `GET` | `/v1/cardano/recent-burn-hints` | Recent Cardano burn hints |
| `GET` | `/v1/midnight/recent-burn-hints` | Recent Midnight burn hints |
| `POST` | `/v1/evm/execute-lock` | Operator: execute EVM lock |
| `POST` | `/v1/evm/execute-burn` | Operator: execute EVM burn |
| `POST` | `/v1/evm/operator/mint` | Operator: mint wrapped tokens on EVM |
| `POST` | `/v1/evm/operator/redeem-to-evm` | Operator: redeem/unlock to EVM |
| `POST` | `/v1/cardano/operator/mint` | Operator: mint on Cardano |
| `POST` | `/v1/cardano/operator/redeem-to-evm` | Operator: Cardano redeem to EVM |
| `POST` | `/v1/cardano/operator/sweep-locks` | Operator: sweep Cardano lock UTxOs |
| `POST` | `/v1/midnight/operator/redeem-to-evm` | Operator: Midnight redeem to EVM |
| `GET` | `/v1/balances` | Bridge wallet balances |

---

## Types reference

### `RelayerPhase`

Job lifecycle phases:

| Phase | Description |
|-------|-------------|
| `received` | Intent accepted, job created |
| `awaiting_finality` | Waiting for on-chain confirmations |
| `proving` | Generating Merkle proof or stub digest |
| `destination_handoff` | Submitting to destination chain |
| `completed` | Settlement confirmed |
| `failed` | Unrecoverable error |

### `RelayerJob`

```typescript
{
  id: string;                    // e.g. "job_1775042694432_3a027874"
  intent: LockIntent | BurnIntent;
  phase: RelayerPhase;
  createdAt: string;             // ISO 8601
  updatedAt: string;             // ISO 8601
  error?: string;                // Present when phase is "failed"
  lockRef: string;               // "evm:tx:logIndex" | "cardano:tx:out" | "offchain:..."
  proofBundle?: {
    algorithm: string;           // "merkle-inclusion-v1" | "stub-sha256-v1"
    digest: string;
    publicInputsHex: string;
    inclusion?: MerkleInclusionProofV1;
  };
  destinationHint?: string;
  depositCommitmentHex?: string;
}
```

### Source chains

`"evm" | "cardano" | "midnight"`

### Operations

`"LOCK" | "BURN"`
