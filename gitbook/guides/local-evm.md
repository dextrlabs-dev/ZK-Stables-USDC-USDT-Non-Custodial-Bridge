# Local EVM Setup

Guide for running the EVM layer of ZK-Stables locally using Foundry Anvil and Hardhat.

## Prerequisites

- **Node.js 20+**
- **Foundry** (for Anvil) -- install via [getfoundry.sh](https://getfoundry.sh/)

## 1. Start Anvil

Anvil is Foundry's local EVM node. The bridge uses chain ID **31337** (Foundry default).

### Option A: Docker

```bash
./scripts/anvil-docker.sh
```

### Option B: Native

```bash
anvil --host 0.0.0.0 --port 8545
```

Anvil starts with 10 pre-funded accounts (10,000 ETH each) using the standard Hardhat/Foundry test mnemonic.

## 2. Install dependencies

```bash
cd evm
npm install
```

## 3. Compile contracts

```bash
npx hardhat compile
```

Solidity 0.8.24 with optimizer (200 runs) and `viaIR` enabled.

## 4. Deploy contracts

```bash
npm run deploy:anvil
```

This deploys all bridge contracts to the local Anvil node and writes the addresses to `/tmp/zk-stables-anvil-addrs.json`. The deploy includes:

- `MockERC20` (mUSDC and mUSDT -- test underlying tokens)
- `BridgeVerifierMock` (always-true proof verifier for development)
- `ZkStablesBridgeMint` (destination mint contract)
- `ZkStablesWrappedToken` (zkUSDC and zkUSDT)
- `ZkStablesPoolLock` (non-custodial lock pool)
- `ZkStablesLiquidityVault` (LP reserve accounting)

The addresses JSON is consumed by the relayer, bridge CLI, and UI.

## 5. Fund test accounts

The deploy script mints test USDC/USDT to the first Anvil account. For additional funding:

```bash
# The start-local-stack script handles this automatically:
npm run fund:local
```

Or mint manually via Hardhat console:

```bash
npx hardhat console --network anvil
```

```js
const MockERC20 = await ethers.getContractFactory("MockERC20");
const usdc = MockERC20.attach("<mUSDC address>");
await usdc.mint("<recipient>", ethers.parseUnits("10000", 6));
```

## 6. Run tests

```bash
npm test
```

Two test suites:

| Test | Description |
|------|-------------|
| `merkle-match.test.js` | Builds a Merkle tree from EVM logs, verifies inclusion proof on-chain via `MerkleVerifyHarness` |
| `burn-usd-commitment.test.js` | Full burn flow: mint wrapped tokens, burn with commitment, verify `Burned` event data |

With CI reporting:

```bash
CI=true npm test
```

Results are written to `evm/test-results/junit-evm.xml`.

## Connecting to the relayer

Point the relayer at the local Anvil node and deployed contracts:

```bash
# In zk-stables-relayer/.env
RELAYER_EVM_RPC_URL=http://127.0.0.1:8545
RELAYER_EVM_BRIDGE_MINT=<address from deploy JSON>
RELAYER_EVM_WRAPPED_TOKEN=<zkUSDC address>
RELAYER_EVM_POOL_LOCK=<pool lock address>
RELAYER_EVM_UNDERLYING_TOKEN=<mUSDC address>
RELAYER_EVM_PRIVATE_KEY=<Anvil account private key>
RELAYER_EVM_CONFIRMATIONS=0   # use 0 on quiet Anvil
```

Or use `./scripts/start-local-stack.sh` which handles all of this automatically.

## Connecting to the bridge CLI

```bash
export BRIDGE_CLI_EVM_RPC_URL=http://127.0.0.1:8545
export BRIDGE_CLI_EVM_PRIVATE_KEY=0xac0974bec...  # Anvil account #0
export BRIDGE_CLI_ADDRESSES_JSON=/tmp/zk-stables-anvil-addrs.json
export BRIDGE_CLI_RELAYER_URL=http://127.0.0.1:8787
```

## Troubleshooting

- **`blockhash` revert in `unlockWithInclusionProof`**: Anvil only stores the last 256 block hashes. On a quiet local chain, the burn block may age out. Mine extra blocks or reduce `RELAYER_EVM_CONFIRMATIONS` to `0`.
- **Nonce errors**: each lock and burn nonce can only be used once. Redeploying contracts resets nonce state.
- **Gas estimation failures**: ensure Anvil is running and the RPC URL is correct.
