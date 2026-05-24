# Releases and Tags

## Alpha Line

Prototype snapshots are published as **Git annotated tags** on the form:

```
v0.1.0-alpha.N
```

Example first alpha:

```bash
git fetch origin
git checkout main
git pull origin main
git tag -a v0.1.0-alpha.1 -m "Alpha prototype: docs, CI, EVM + Aiken verification"
git push origin v0.1.0-alpha.1
```

GitHub will show the tag under **Releases** (you can optionally promote it to a GitHub Release with notes from the [Changelog](changelog.md)).

## What Each Tag Should Mean

- Documented in the [Changelog](changelog.md) for that version.
- **Verification:** run local checks documented in the [Usage Guide](../guides/usage.md) (there is no full GitHub Actions workflow beyond the minimal CI).

## Test Reports

- **JUnit (EVM):** produced when `CI=true` during `npm test` in `evm/` -- generates `evm/test-results/junit-evm.xml`.
- **Aiken log:** capture with `(cd cardano/aiken && aiken check 2>&1 | tee aiken-check.log)`.

See the [test reports documentation](https://github.com/dextrlabs-dev/ZK-Stables-USDC-USDT-Non-Custodial-Bridge/blob/main/docs/reports/README.md) for local regeneration commands.

---

Source: [`docs/RELEASES.md`](https://github.com/dextrlabs-dev/ZK-Stables-USDC-USDT-Non-Custodial-Bridge/blob/main/docs/RELEASES.md)
