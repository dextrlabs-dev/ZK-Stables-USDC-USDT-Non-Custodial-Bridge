# Test reports

**Human-readable summary:** [../TEST_REPORT.md](../TEST_REPORT.md) (bridge process, per-chain tx hashes, relayer jobs, CI overview). This page focuses on **machine-readable** artifacts and local regeneration commands.

## Expected artifacts (local)

This repository does not upload CI artifacts from GitHub Actions. Generate the same files locally:

| File | Contents |
|------|----------|
| `junit-evm.xml` | Hardhat / Mocha JUnit output (2 test cases in the current suite) |
| `aiken-check.log` | Full stdout from `aiken check` (compilation + embedded unit tests) |

## Local generation

```bash
(cd evm && mkdir -p test-results && CI=true npm test)
# → evm/test-results/junit-evm.xml

(cd cardano/aiken && aiken check 2>&1 | tee /tmp/aiken-check.log)
```

These paths are listed in [.gitignore](../../.gitignore) so local runs do not dirty the tree by default.

## Snapshot summary (reference)

Last verified locally against the same checks as CI:

- **EVM:** 2 passing (Hardhat)
- **Aiken:** 1 passing unit test (`lock_datum_constructible`)

Re-run the commands above or open the latest **test-reports** artifact for authoritative output on a given commit.
