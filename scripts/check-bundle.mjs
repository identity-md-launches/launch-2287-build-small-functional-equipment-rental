import { readdir, stat, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import assert from 'node:assert/strict';

// Mirrors the deliverable paths, never traversing repository metadata or installed dependencies.
const excluded = new Set(['.git', '.imd', 'node_modules']);
const files = [];
async function walk(dir = '.') {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (excluded.has(entry.name)) continue;
    const file = join(dir, entry.name);
    if (file === 'test/scratch') continue;
    assert(!entry.isSymbolicLink(), `Unexpected symlink: ${file}`);
    if (entry.isDirectory()) await walk(file);
    else files.push({ path: relative('.', file), size: (await stat(file)).size });
  }
}
await walk();
const bytes = files.reduce((n, f) => n + f.size, 0);
assert(bytes <= 8_388_608, `Deliverable is over 8 MiB: ${bytes}`);
assert(files.some(f => f.path === 'dist/index.html'), 'Static export missing');
assert(files.some(f => f.path === 'package-lock.json'), 'Lockfile missing');
assert(!files.some(f => /(^|\/)(node_modules|\.cache|\.vite|coverage)(\/|$)|\.(tgz|tar|xz|zip|tsbuildinfo)$/.test(f.path)), 'Unnecessary dependency/cache/archive artifact');
const html = await readFile('dist/index.html', 'utf8');
for (const [, asset] of html.matchAll(/(?:src|href)="([^"]+)"/g)) assert(!asset.startsWith('/'), `Root-relative export asset: ${asset}`);
console.log(JSON.stringify({ files: files.length, sourceAndExportBytes: bytes, limit: 8_388_608, productionExportBytes: files.filter(f => f.path.startsWith('dist/')).reduce((n, f) => n + f.size, 0), exclusions: ['.git/', '.imd/ (inputs)', 'node_modules/', 'test/scratch/'] }, null, 2));
