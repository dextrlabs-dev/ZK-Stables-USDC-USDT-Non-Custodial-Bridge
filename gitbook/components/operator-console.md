# Bridge Operator Console

A lightweight **Vite + React** UI for operating the ZK-Stables bridge. It provides an **Accounts** view (health, recipients, optional demo wallets) and a **Bridge** view (mint and redeem flows aligned with `zk-bridge` CLI and `POST /v1/intents/*`). Source code lives in [`bridge-operator-console/`](https://github.com/dextrlabs-dev/ZK-Stables-USDC-USDT-Non-Custodial-Bridge/tree/main/bridge-operator-console).

## Run

```bash
cd bridge-operator-console
cp .env.example .env   # optional; defaults to http://127.0.0.1:8787
npm install
npm run dev
```

Start the [relayer](relayer.md) first. The relayer exposes `Access-Control-Allow-Origin: *`, so the dev server can call it from another port.

## Monorepo usage

The package is listed in the workspace root `package.json`. From the repo root:

```bash
npm install
npm run dev -w bridge-operator-console
```

## Features

### Accounts tab

- Chain health status from `GET /v1/health/chains`
- Configured bridge recipients from `GET /v1/bridge/recipients`
- Demo wallets (when `RELAYER_ENABLE_DEMO_WALLETS=true` on the relayer)

### Bridge tab

- **Mint**: generates the `zk-bridge mint ...` command for EVM pool lock, then accepts the lock receipt for `POST /v1/intents/lock`. The browser does not sign `ZkStablesPoolLock.lock` directly.
- **Redeem**: form-based BURN intent submission. Anchors must match on-chain reality; invalid payloads return relayer errors inline.

## Design

Project-local design notes live in [`.impeccable.md`](https://github.com/dextrlabs-dev/ZK-Stables-USDC-USDT-Non-Custodial-Bridge/blob/main/bridge-operator-console/.impeccable.md) (Bricolage Grotesque + Literata typography, OKLCH palette).

## Limitations

- **Mint** requires an external signer (the CLI or a wallet) for the EVM lock transaction. The console generates the command but does not execute it.
- **Redeem** anchors must be valid on-chain references. The console does not validate anchors before submission.
