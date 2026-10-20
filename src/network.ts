import { defineChain } from 'viem';

export const CHAIN_ID = 46630;
export const RPC_URL = 'https://rpc.testnet.chain.robinhood.com';
export const EXPLORER_URL = 'https://explorer.testnet.chain.robinhood.com';
export const TOKEN = '0x31339619db548257cE09A76f189b0b1932f5c0cd' as const;
export const ESCROW = '0x06135FF9311eCa80a7484444A552f28fFC660F05' as const;
export const ITEM_ID = 1n;
export const chain = defineChain({
  id: CHAIN_ID,
  name: 'Robinhood Chain Testnet',
  nativeCurrency: { name: 'Test Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
  blockExplorers: { default: { name: 'Robinhood Testnet Explorer', url: EXPLORER_URL } },
  testnet: true,
});
export const txLink = (hash: string) => `${EXPLORER_URL}/tx/${hash}`;
export const addressLink = (address: string) => `${EXPLORER_URL}/address/${address}`;
