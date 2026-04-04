# Bridge operator console

Small **Vite + React** UI for the ZK-Stables relayer: **Accounts** (health + recipients + optional demo wallets) and **Bridge** (mint / redeem aligned with `zk-bridge` and `POST /v1/intents/*`).

## Run

```bash
cd bridge-operator-console
cp .env.example .env   # optional; defaults to http://127.0.0.1:8787
npm install
npm run dev
```

Start `zk-stables-relayer` first. The relayer exposes `Access-Control-Allow-Origin: *`, so the dev server can call it from another port.

## Monorepo

This package is listed in the workspace root `package.json`. From the repo root:

```bash
npm install
npm run dev -w bridge-operator-console
```

## Design

Project-local design notes live in [`.impeccable.md`](./.impeccable.md) (operator / archival / kinetic direction, Bricolage Grotesque + Literata, OKLCH palette).

## Limits

- **Mint**: Browser does not sign `ZkStablesPoolLock.lock`; use the generated `zk-bridge mint …` command, then paste the lock receipt into the HTTP form to `POST /v1/intents/lock`.
- **Redeem**: Anchors must match on-chain reality; invalid payloads return relayer errors inline.
