// Public testnet reads only. No wallet, signing or write RPC methods are used.
import { createPublicClient, http, defineChain } from 'viem';
import { readFile, writeFile } from 'node:fs/promises';
const rpc = 'https://rpc.testnet.chain.robinhood.com';
const token = '0x31339619db548257cE09A76f189b0b1932f5c0cd';
const escrow = '0x06135FF9311eCa80a7484444A552f28fFC660F05';
const chain = defineChain({ id: 46630, name: 'Robinhood Chain Testnet', nativeCurrency: { name: 'Test Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [rpc] } } });
const client = createPublicClient({ chain, transport: http(rpc, { timeout: 15_000, retryCount: 1 }) });
const escrowAbi = JSON.parse(await readFile('src/abi/RentalEscrow.json', 'utf8'));
const tokenAbi = JSON.parse(await readFile('src/abi/MockPaymentToken.json', 'utf8'));
const block = await client.getBlock();
const read = (address, abi, functionName, args = []) => client.readContract({ address, abi, functionName, args, blockNumber: block.number });
const [chainId, codeToken, codeEscrow, configuredToken, decimals, symbol, item] = await Promise.all([
  client.getChainId(), client.getCode({ address: token }), client.getCode({ address: escrow }),
  read(escrow, escrowAbi, 'token'), read(token, tokenAbi, 'decimals'), read(token, tokenAbi, 'symbol'), read(escrow, escrowAbi, 'getItem', [1n]),
]);
if (chainId !== 46630 || !codeToken || !codeEscrow || configuredToken.toLowerCase() !== token.toLowerCase()) throw new Error('Deployment integrity check failed.');
const quote = await read(escrow, escrowAbi, 'quote', [1n]);
const report = { checkedAt: new Date().toISOString(), source: rpc, access: 'read-only; no worker transactions', chainId, blockNumber: block.number, blockTimestamp: block.timestamp, contractsHaveCode: true, configuredToken, decimals, symbol, item, quote };
const json = JSON.stringify(report, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2);
await writeFile('artifacts/live-read.json', json + '\n');
console.log(json);
