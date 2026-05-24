# EVM Contracts (Solidity)

The EVM layer of the ZK-Stables bridge consists of Solidity contracts deployed via Hardhat. Source files live in [`evm/contracts/`](https://github.com/dextrlabs-dev/ZK-Stables-USDC-USDT-Non-Custodial-Bridge/tree/main/evm/contracts).

## Contracts

### ZkStablesPoolLock.sol

Non-custodial pool that holds underlying USDC/USDT and emits lock/unlock events.

| Function | Description |
|----------|-------------|
| `lock(token, amount, recipient, nonce)` | Transfers underlying tokens into the pool; emits `Locked`. Nonce must be unique. |
| `unlock(token, amount, recipient, burnNonce)` | Owner-only emergency unlock without proof. |
| `unlockWithInclusionProof(...)` | Verifies a Merkle inclusion proof of a `Burned` log, then releases underlying tokens to the recipient. Checks `blockhash`, leaf hash, Merkle root, amount, and burn commitment. |

Key features:

- Nonce replay protection for both locks and burns (`nonceUsed`, `burnNonceUsed` mappings)
- Pausable by owner
- `Locked` event anchors the relayer's LOCK intent pipeline
- `Unlocked` event confirms redemption

### ZkStablesBridgeMint.sol

Destination mint contract that creates wrapped tokens after proof verification.

| Function | Description |
|----------|-------------|
| `mintWrapped(wrappedToken, recipient, amount, nonce, proof, publicInputsHash)` | Verifies a proof via an `IVerifier`, prevents nonce replay, and mints wrapped tokens. Emits `Minted`. |

The verifier is injected at construction (`IVerifier` interface). In development a mock verifier (`BridgeVerifierMock.sol`) always returns `true`.

### ZkStablesWrappedToken.sol

ERC-20 token representing bridged zkUSDC or zkUSDT.

| Function | Description |
|----------|-------------|
| `mint(to, amount)` | Callable only by the `bridgeMinter` (the `ZkStablesBridgeMint` contract). |
| `burn(amount, recipientOnSource, nonce, burnCommitment)` | Burns tokens and emits a `Burned` event with a commitment for cross-chain proof binding. |
| Standard ERC-20 | `transfer`, `transferFrom`, `approve` |

The `Burned` event includes `burnCommitment` which binds the burn to Midnight/Cardano ZK verification.

### ZkStablesLiquidityVault.sol

Scaffold for per-asset reserve accounting with 1:1 LP shares.

| Function | Description |
|----------|-------------|
| `deposit(token, amount)` | Deposit underlying tokens, receive shares 1:1. |
| `withdraw(token, amount)` | Burn shares, receive underlying tokens. |
| `reserveOf(token)` | View the vault's token balance. |

### MockERC20.sol

Test ERC-20 used to simulate USDC and USDT in local development. Has an unrestricted `mint` function for funding test accounts.

### MerkleProof.sol

OpenZeppelin-style Merkle proof verification library. Uses sorted-pair keccak256 hashing, compatible with `merkletreejs` on the relayer side.

### Supporting contracts

- **LogLeaf.sol** -- hashes EVM log fields into a Merkle leaf
- **BridgeVerifierMock.sol** -- mock `IVerifier` that always returns `true` (development only)
- **MerkleVerifyHarness.sol** -- test harness exposing `MerkleProof.verify` for Hardhat tests

## Deployment

Contracts are compiled and deployed using Hardhat targeting a local Anvil node:

```bash
cd evm
npm install
npx hardhat compile
npm run deploy:anvil   # deploys to localhost:8545, chainId 31337
```

The deploy script writes contract addresses to `/tmp/zk-stables-anvil-addrs.json`, which is consumed by the relayer and UI.

## Tests

Two Hardhat test suites in [`evm/test/`](https://github.com/dextrlabs-dev/ZK-Stables-USDC-USDT-Non-Custodial-Bridge/tree/main/evm/test):

| Test file | Coverage |
|-----------|----------|
| `merkle-match.test.js` | Merkle proof construction and on-chain verification via `MerkleVerifyHarness` |
| `burn-usd-commitment.test.js` | Burn commitment flow: mint wrapped, burn with commitment, verify event data |

Run tests:

```bash
cd evm
npm install
npm test
```

With CI reporting (`CI=true`), results are written to `evm/test-results/junit-evm.xml`.

## Configuration

Hardhat config (`hardhat.config.ts`):

- Solidity 0.8.24 with optimizer (200 runs) and `viaIR`
- Network `anvil`: `http://127.0.0.1:8545`, chain ID 31337
- Override RPC URL with `EVM_RPC_URL` environment variable
