import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';
import solc from 'solc';

const commit = '6ce8023819f68d2b84f2151b24285af477f4d9c7';
const base = `https://raw.githubusercontent.com/identity-md-launches/launch-1988-kkk/${commit}/`;
const roots = {
  'src/RentalEscrow.sol': 'f3baf7ba4208aa98c8cc81f3d4c01451d9fdc260',
  'src/MockPaymentToken.sol': '6754a8c529af939c0d6182cf9e309458c8a0e5c5',
};
const refresh = process.argv.includes('--refresh');
const write = process.argv.includes('--write');
const sources = {};
const manifest = {};
const directory = 'docs/contract-source/upstream/';
function resolveImport(from, name) {
  return name.startsWith('@openzeppelin/contracts/')
    ? name.replace('@openzeppelin/contracts/', 'lib/openzeppelin-contracts/contracts/')
    : path.posix.normalize(path.posix.join(path.posix.dirname(from), name));
}
async function load(file) {
  if (sources[file]) return;
  let content;
  if (refresh) {
    content = execFileSync('curl', ['-fLsS', '--max-time', '30', base + file], { encoding: 'utf8' });
    await mkdir(path.dirname(directory + file), { recursive: true });
    await writeFile(directory + file, content);
  } else content = await readFile(directory + file, 'utf8');
  const blob = createHash('sha1').update(`blob ${Buffer.byteLength(content)}\0${content}`).digest('hex');
  if (roots[file]) assert.equal(blob, roots[file], `Pinned Git blob mismatch: ${file}`);
  sources[file] = { content };
  manifest[file] = { gitBlob: blob, sha256: createHash('sha256').update(content).digest('hex') };
  for (const match of content.matchAll(/import\s+(?:[^;]*?from\s*)?["']([^"']+)["']\s*;/g)) {
    await load(resolveImport(file, match[1]));
  }
}
for (const root of Object.keys(roots)) await load(root);
assert.ok(solc.version().startsWith('0.8.26+'), 'Requires solc-js 0.8.26');
const output = JSON.parse(solc.compile(JSON.stringify({
  language: 'Solidity', sources,
  settings: { remappings: ['@openzeppelin/contracts/=lib/openzeppelin-contracts/contracts/'], outputSelection: { '*': { '*': ['abi'] } } },
})));
const errors = output.errors?.filter(e => e.severity === 'error') ?? [];
assert.equal(errors.length, 0, errors.map(e => e.formattedMessage).join('\n'));
for (const name of ['RentalEscrow', 'MockPaymentToken']) {
  const abi = output.contracts[`src/${name}.sol`][name].abi;
  const destination = `src/abi/${name}.json`;
  if (write) await writeFile(destination, JSON.stringify(abi, null, 2) + '\n');
  assert.deepEqual(JSON.parse(await readFile(destination, 'utf8')), abi, `Complete ABI differs: ${name}`);
  console.log(`${name}: all ${abi.length} ABI entries match compilation of the pinned sources.`);
}
const provenance = { repository: 'https://github.com/identity-md-launches/launch-1988-kkk', commit, compiler: solc.version(), sources: manifest };
if (write) await writeFile('docs/abi-provenance.json', JSON.stringify(provenance, null, 2) + '\n');
else assert.deepEqual(JSON.parse(await readFile('docs/abi-provenance.json', 'utf8')), provenance);
console.log(`Verified ${Object.keys(sources).length} source files. ${refresh ? 'Downloaded exact-commit sources.' : 'Offline check; no network used.'}`);
