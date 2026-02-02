import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const managed = path.resolve(root, '../contract/src/managed/zk-stables');
const pubKeys = path.join(root, 'public', 'keys');
const pubZkir = path.join(root, 'public', 'zkir');

if (!fs.existsSync(path.join(managed, 'keys'))) {
  console.error('Missing contract ZK artifacts. Run in contract/: npm run compact && npm run build');
  process.exit(1);
}

fs.mkdirSync(pubKeys, { recursive: true });
fs.mkdirSync(pubZkir, { recursive: true });
fs.cpSync(path.join(managed, 'keys'), pubKeys, { recursive: true });
fs.cpSync(path.join(managed, 'zkir'), pubZkir, { recursive: true });
console.log('Copied zk-stables keys/ and zkir/ to public/');
