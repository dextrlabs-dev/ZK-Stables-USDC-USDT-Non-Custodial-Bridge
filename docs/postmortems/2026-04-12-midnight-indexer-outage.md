# Postmortem — Midnight indexer outage during 2026-04-12 integration matrix

**Date:** 2026-04-12
**Severity:** P2 — Midnight-leg degraded; EVM + Cardano legs unaffected.
**Status:** Resolved 2026-04-12 ~06:45 UTC (Midnight indexer container restored).
**Author:** Trivolve / Dextr Labs operations.

## Summary

During the 2026-04-12 cross-chain integration matrix, the local Midnight indexer GraphQL endpoint (`http://127.0.0.1:8088/api/v4/graphql`) was unreachable for ~90 minutes. The bridge-cli timed out on the EVM → Midnight `LOCK` route, and the matrix-coverage flag correctly marked the Midnight legs as "skipped" without aborting the EVM + Cardano legs of the same run. Three retry attempts were captured in the `tmp/` corpus. After the indexer recovered, the Midnight runs completed cleanly.

## Timeline (UTC)

| Time | Event | Artefact |
|---|---|---|
| 05:13 | `tmp/ops-all-chains-report/` matrix run starts. EVM + Cardano legs `completed` ✅; Midnight leg fails with `TypeError: fetch failed` against `127.0.0.1:8088`. | `tmp/ops-all-chains-report/summary.json`, `TX_HASH_REPORT.md` line "Midnight not run: …" |
| 05:30 | First retry: `tmp/midnight-ops-try/`. Same fetch failure. | `tmp/midnight-ops-try/summary.json` |
| 05:45 | Second retry: `tmp/midnight-ops-try2/`. Same fetch failure. | `tmp/midnight-ops-try2/summary.json` |
| 06:00 | `tmp/midnight-hash-report/`: bridge-cli `mint --destination midnight --asset USDC` aborts with `Command failed: ... mint --destination midnight ...`. | `tmp/midnight-hash-report/summary.json` ("Partial run: …") |
| 06:15 | Operator restarts Midnight indexer container; healthcheck confirmed via direct GraphQL ping. | (out-of-repo — Docker container restart) |
| 06:45 | `tmp/ops-midnight-20260412T064637Z/`: first successful post-recovery run. EVM → Midnight LOCK reaches `completed`. | `tmp/ops-midnight-20260412T064637Z/summary.json` |
| 07:36 | `tmp/ops-midnight-run-20260412T073637Z/`: steady-state Midnight LOCK. | same |
| 08:10 | `tmp/ops-midnight-run-20260412T081035Z/`: second steady-state Midnight LOCK. | same |
| 10:30 | `tmp/ops-with-midnight/` final pass — three-chain matrix completes end-to-end. | `tmp/ops-with-midnight/summary.json` |

## Impact

- 4 Midnight-bound intents queued during the outage window failed to start their `awaiting_finality` → `proving` transitions; the bridge-cli surfaced the failure to the operator immediately rather than silently retrying.
- 8 EVM + Cardano intents in the same matrix runs (2026-04-12 05:13 + 05:30 + 05:45 windows) completed normally — the matrix-coverage flag correctly isolated the failure to the Midnight chain.
- No user-side or on-chain inconsistency: the failed Midnight intents never produced a partial commit. Operators saw a clean `"ok": false` summary with the failing command line preserved.

## Root cause

Local Midnight indexer container (`midnightntwrk/indexer-standalone:4.0.0`) had stopped responding on port `8088`. The container itself had not crashed loudly; it had become unresponsive to GraphQL requests while its health endpoint was still inconclusive. The bridge-cli's underlying `fetch` against the GraphQL endpoint hit the OS-level connection-refused / timeout path and surfaced `TypeError: fetch failed`.

The outage was a local-stack operational issue, not a bridge-protocol or relayer code defect.

## What worked

- **Matrix-coverage flag in the relayer**: the integration script honored the per-chain "skip on unreachable" path. EVM + Cardano legs in the same matrix runs completed normally.
- **Per-run JSON snapshot**: every retry produced a self-contained `summary.json` with the failing command preserved verbatim, which made the postmortem write-up a 10-minute job rather than a code-archaeology exercise.
- **Bridge-cli error surfacing**: the `Command failed` message included the full command line + the underlying timeout reason, so the operator could distinguish "indexer down" from "relayer bug" immediately.

## What didn't work

- The indexer container itself had no readiness probe wired into the local stack's `docker compose`. Operators had to detect the outage from a downstream failure rather than directly.
- Three retries (`midnight-ops-try`, `midnight-ops-try2`, `midnight-hash-report`) all fired against the still-unhealthy indexer. The bridge-cli could have used an exponential backoff with circuit-breaking instead of repeating the full command.

## Mitigations applied

- The local-stack documentation in [`docs/CARDANO_LOCAL_YACI.md`](../CARDANO_LOCAL_YACI.md) and the related Midnight stack notes now include a "verify indexer reachable before running matrix" checklist line.
- The production SRS checklist ([`docs/SRS_RELAYER_REQUIREMENTS.md`](../SRS_RELAYER_REQUIREMENTS.md)) treats indexer health as a hard precondition for the Midnight leg.

## Follow-ups

- **(open)** Add a `docker compose healthcheck:` clause to the local Midnight indexer + proof-server services so `docker compose up --wait` blocks on real readiness, not container start.
- **(open)** Wrap the bridge-cli's GraphQL calls in a small circuit-breaker so repeated retries skip the underlying GraphQL call when the previous N attempts failed in M seconds.
- **(open)** Surface `/v1/health` from the relayer with a `midnightIndexerReachable` boolean so the operator console and benchmark harness can refuse to start a Midnight-bound intent against a down indexer.

These follow-ups are tracked under the project's outstanding-items list and gated behind the v1.0.0 final release.
