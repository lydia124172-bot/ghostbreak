/**
 * 查找本機 GhostBreak 專案根目錄（含 server.js + package.json name=ghostbreak + DOMAIN_NAME）
 */
const fs = require('fs');
const path = require('path');

const START_DIRS = [
  path.join(process.env.USERPROFILE || 'C:\\Users\\User', '.continue'),
  process.env.USERPROFILE || 'C:\\Users\\User',
].filter(Boolean);

const SKIP = new Set([
  'node_modules', 'AppData', '.cursor', '.vscode', 'Local', 'Programs',
]);

function isGhostBreakRoot(dir) {
  const serverJs = path.join(dir, 'server.js');
  const pkgJson = path.join(dir, 'package.json');
  const envFile = path.join(dir, '.env');
  if (!fs.existsSync(serverJs) || !fs.existsSync(pkgJson)) return null;
  let name = '';
  try {
    name = JSON.parse(fs.readFileSync(pkgJson, 'utf8')).name || '';
  } catch {
    return null;
  }
  let domain = '';
  if (fs.existsSync(envFile)) {
    const m = fs.readFileSync(envFile, 'utf8').match(/^DOMAIN_NAME=(.+)$/m);
    domain = m ? m[1].trim() : '';
  }
  if (name === 'ghostbreak' || domain === 'bafuholdings.com') {
    return { dir, name, domain, hasEnv: fs.existsSync(envFile) };
  }
  return null;
}

function walk(dir, depth, found) {
  if (depth > 4) return;
  let hit;
  try {
    hit = isGhostBreakRoot(dir);
  } catch {
    return;
  }
  if (hit) {
    found.push(hit);
    return;
  }
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    if (SKIP.has(ent.name)) continue;
    if (ent.name.startsWith('.') && ent.name !== '.continue') continue;
    walk(path.join(dir, ent.name), depth + 1, found);
  }
}

const found = [];
for (const start of START_DIRS) {
  walk(start, 0, found);
}

if (!found.length) {
  console.log('NOT_FOUND');
  process.exit(1);
}

const primary = found.find((f) => f.name === 'ghostbreak') || found[0];
console.log(JSON.stringify({ roots: found, primary: primary.dir }, null, 2));
