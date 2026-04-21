# Releases and tags

## Alpha line

Prototype snapshots are published as **Git annotated tags** on the form:

`v0.1.0-alpha.N`

Example first alpha:

```bash
git fetch origin
git checkout main
git pull origin main
git tag -a v0.1.0-alpha.1 -m "Alpha prototype: docs, CI, EVM + Aiken verification"
git push origin v0.1.0-alpha.1
```

GitHub will show the tag under **Releases** (you can optionally promote it to a GitHub Release with notes from [CHANGELOG.md](../CHANGELOG.md)).

## What each tag should mean

- Documented in [CHANGELOG.md](../CHANGELOG.md) for that version.
- **Verification:** run local checks documented in [USAGE.md](../USAGE.md) (there is no GitHub Actions workflow).

## Test reports

- **JUnit (EVM):** produced when `CI=true` during `npm test` in `evm/` → `evm/test-results/junit-evm.xml`.
- **Aiken log:** capture with `(cd cardano/aiken && aiken check 2>&1 | tee aiken-check.log)`.

See [reports/README.md](reports/README.md) for local regeneration commands.
