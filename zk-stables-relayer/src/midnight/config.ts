import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_CONFIG } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Paths relative to `zk-stables-relayer/src/midnight` → repo `contract/`. */
export class RelayerMidnightConfig {
  readonly indexer = process.env.RELAYER_MIDNIGHT_INDEXER_HTTP ?? 'http://127.0.0.1:8088/api/v4/graphql';
  readonly indexerWS = process.env.RELAYER_MIDNIGHT_INDEXER_WS ?? 'ws://127.0.0.1:8088/api/v4/graphql/ws';
  readonly node = process.env.RELAYER_MIDNIGHT_NODE_HTTP ?? 'http://127.0.0.1:9944';
  readonly proofServer = process.env.RELAYER_MIDNIGHT_PROOF_SERVER ?? 'http://127.0.0.1:6300';

  readonly zkStablesArtifactsDir =
    process.env.MIDNIGHT_ZK_STABLES_ARTIFACTS_DIR ?? path.resolve(__dirname, '../../../contract/src/managed/zk-stables');

  readonly zkStablesRegistryArtifactsDir =
    process.env.MIDNIGHT_ZK_STABLES_REGISTRY_ARTIFACTS_DIR ??
    path.resolve(__dirname, '../../../contract/src/managed/zk-stables-registry');

  readonly privateStateStoreName = process.env.MIDNIGHT_PRIVATE_STATE_STORE ?? 'zk-stables-relayer-private-state';

  readonly registryPrivateStateStoreName =
    process.env.MIDNIGHT_REGISTRY_PRIVATE_STATE_STORE ?? 'zk-stables-registry-relayer-private-state';

  /**
   * LevelDB location for Midnight private state (same as `midnightDbName` in level-private-state-provider).
   * Default `midnight-level-db` is created under the process cwd — use an absolute path in production
   * (e.g. `/var/lib/zk-stables/midnight-level-db`) if cwd is read-only or you need persistence.
   */
  readonly midnightLevelDbName =
    process.env.RELAYER_MIDNIGHT_LEVEL_DB_PATH?.trim() ||
    process.env.MIDNIGHT_LEVEL_DB_PATH?.trim() ||
    DEFAULT_CONFIG.midnightDbName;

  constructor() {
    setNetworkId('undeployed');
  }

  /** Ensures explicit DB directory exists before Level opens (no-op for single-component relative names). */
  ensureMidnightLevelDbDirectory(): void {
    const loc = this.midnightLevelDbName.trim();
    if (!loc) return;
    if (path.isAbsolute(loc) || loc.includes(path.sep)) {
      fs.mkdirSync(loc, { recursive: true });
    }
  }
}
