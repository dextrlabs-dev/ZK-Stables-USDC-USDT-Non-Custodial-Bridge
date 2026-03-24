import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const registryManaged = path.resolve(root, '../contract/src/managed/zk-stables-registry');
const pubKeys = path.join(root, 'public', 'keys');
const pubZkir = path.join(root, 'public', 'zkir');

if (!fs.existsSync(path.join(registryManaged, 'keys'))) {
  console.error('Missing registry contract ZK artifacts. Run in contract/: npm run compact && npm run build');
  process.exit(1);
}

fs.mkdirSync(pubKeys, { recursive: true });
fs.mkdirSync(pubZkir, { recursive: true });
fs.cpSync(path.join(registryManaged, 'keys'), pubKeys, { recursive: true });
fs.cpSync(path.join(registryManaged, 'zkir'), pubZkir, { recursive: true });
console.log('Copied zk-stables-registry keys/ and zkir/ to public/');
