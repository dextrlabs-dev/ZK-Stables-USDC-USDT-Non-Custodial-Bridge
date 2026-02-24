import path from 'node:path';
import { fileURLToPath } from 'node:url';
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

  readonly privateStateStoreName = process.env.MIDNIGHT_PRIVATE_STATE_STORE ?? 'zk-stables-relayer-private-state';

  constructor() {
    setNetworkId('undeployed');
  }
}
