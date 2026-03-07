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
- **CI green** on `main` for the tagged commit (see workflow [ci.yml](../.github/workflows/ci.yml)).
- For reproducibility, record the Node major version and Aiken version used in CI (see workflow file).

## Test reports

- **JUnit (EVM):** produced when `CI=true` during `npm test` in `evm/` → `evm/test-results/junit-evm.xml`.
- **Aiken log:** full `aiken check` transcript is uploaded from CI as `test-results/aiken-check.log`.

Every successful workflow run on GitHub attaches a **test-reports** artifact (public for public repositories). Open **Actions** → select the run → **Artifacts**. A short in-repo summary lives under [reports/](reports/README.md).
