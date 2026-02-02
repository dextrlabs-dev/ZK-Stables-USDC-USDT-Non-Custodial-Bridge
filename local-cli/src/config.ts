import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Brick Towers local network + Midnight undeployed endpoints. */
export class LocalUndeployedConfig {
  readonly indexer = 'http://127.0.0.1:8088/api/v3/graphql';
  readonly indexerWS = 'ws://127.0.0.1:8088/api/v3/graphql/ws';
  readonly node = 'http://127.0.0.1:9944';
  readonly proofServer = 'http://127.0.0.1:6300';

  readonly zkStablesArtifactsDir = path.resolve(__dirname, '../../contract/src/managed/zk-stables');

  readonly privateStateStoreName = 'zk-stables-local-private-state';

  constructor() {
    setNetworkId('undeployed');
  }
}
