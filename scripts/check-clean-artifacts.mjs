import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const ignoredDirs = new Set(['.git', 'node_modules']);
const forbidden = [];

function isForbidden(name, relPath) {
  if (name === '__MACOSX') return true;
  if (name === '.DS_Store') return true;
  if (name.startsWith('._')) return true;
  if (relPath.split('/').length === 1 && (name.endsWith('.zip') || name.endsWith('.tgz'))) return true;
  return false;
}

function scan(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const relPath = relative(root, full).split('\\').join('/');
    if (ignoredDirs.has(name)) continue;
    if (isForbidden(name, relPath)) forbidden.push(relPath);
    if (statSync(full).isDirectory()) scan(full);
  }
}

scan(root);

if (forbidden.length > 0) {
  console.error('Forbidden review/release artifacts found:');
  for (const path of forbidden) console.error(`- ${path}`);
  process.exit(1);
}

