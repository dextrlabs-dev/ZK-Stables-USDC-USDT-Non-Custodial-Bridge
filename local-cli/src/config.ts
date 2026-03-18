import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function defaultProofServerUrl(): string {
  const explicit = process.env.MIDNIGHT_PROOF_SERVER?.replace(/\/$/, '');
  if (explicit) return explicit;
  const port = Number.parseInt(process.env.PROOF_SERVER_PORT ?? '6300', 10);
  return `http://127.0.0.1:${port}`;
}

/** Brick Towers local network + Midnight undeployed endpoints. */
export class LocalUndeployedConfig {
  /** Indexer standalone 4.x exposes v3 and v4; align with zk-stables-ui + Midnight local-network defaults. */
  readonly indexer = 'http://127.0.0.1:8088/api/v4/graphql';
  readonly indexerWS = 'ws://127.0.0.1:8088/api/v4/graphql/ws';
  readonly node = 'http://127.0.0.1:9944';
  /** Override with `MIDNIGHT_PROOF_SERVER` (full URL) or `PROOF_SERVER_PORT` (host port, default 6300). */
  readonly proofServer = defaultProofServerUrl();

  /** Managed ZK artifacts (prover/verifier/zkir), same layout as [example-counter `contractConfig.zkConfigPath`](https://github.com/midnightntwrk/example-counter). */
  readonly zkStablesArtifactsDir =
    process.env.MIDNIGHT_ZK_STABLES_ARTIFACTS_DIR ??
    path.resolve(__dirname, '../../contract/src/managed/zk-stables');

  readonly zkStablesRegistryArtifactsDir =
    process.env.MIDNIGHT_ZK_REGISTRY_ARTIFACTS_DIR ??
    path.resolve(__dirname, '../../contract/src/managed/zk-stables-registry');

  /** Override with `MIDNIGHT_PRIVATE_STATE_STORE` (run-genesis sets a fresh default per run). */
  readonly privateStateStoreName = process.env.MIDNIGHT_PRIVATE_STATE_STORE ?? 'zk-stables-local-private-state';

  /** Separate LevelDB namespace when running the multi-deposit registry CLI (`run-registry-all`). */
  readonly registryPrivateStateStoreName =
    process.env.MIDNIGHT_REGISTRY_PRIVATE_STATE_STORE ?? 'zk-stables-registry-local-private-state';

  constructor() {
    setNetworkId('undeployed');
  }
}
