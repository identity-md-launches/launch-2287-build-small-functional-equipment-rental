// Isolated in-memory EVM RPC fixture. Never sends a network request or real transaction.
import { readFile } from 'node:fs/promises';
import { decodeFunctionData, encodeFunctionResult, encodeErrorResult, encodeEventTopics, encodeAbiParameters, toHex } from 'viem';
export const RPC = 'https://rpc.testnet.chain.robinhood.com';
export const TOKEN = '0x31339619db548257ce09a76f189b0b1932f5c0cd';
export const ESCROW = '0x06135ff9311eca80a7484444a552f28ffc660f05';
export const RENTER = '0x1111111111111111111111111111111111111111';
export const OTHER = '0x2222222222222222222222222222222222222222';
const escrowAbi = JSON.parse(await readFile('src/abi/RentalEscrow.json', 'utf8'));
const tokenAbi = JSON.parse(await readFile('src/abi/MockPaymentToken.json', 'utf8'));
const blockHash = `0x${'ba'.repeat(32)}`;
const zeroHash = `0x${'00'.repeat(32)}`;
const ZERO = '0x0000000000000000000000000000000000000000';
const hex = n => toHex(BigInt(n));
export function createLedger() {
  const l = {
    walletAddress: RENTER, walletChain: 46630, authorized: false, rpcOffline: false, rejectNext: false, revertNext: false, holdReceipts: false, unknownNetwork: false, addedNetwork: false,
    block: 1000n, time: 1_790_000_000n, nextReservation: 7n, txs: new Map(), broadcasts: [],
    balances: new Map([[RENTER, 100_000_000n], [OTHER, 12_000_000n]]), allowances: new Map(), credits: new Map(), refs: new Map(), reservations: new Map(),
    policyId: 1n, policy: { deposit: 50_000_000n, cancellationFee: 5_000_000n, reservationWindow: 86_400n },
    item: { exists: true, listed: true, state: 0, policyId: 1n, activeReservationId: 0n, metadataURI: 'ipfs://rental-trial/cordless-drill' },
  };
  l.reservations.set(8n, { itemId: 2n, renter: OTHER, policyId: 1n, createdAt: l.time, expiresAt: l.time + 86_400n, status: 1, deposit: 50_000_000n, cancellationFee: 5_000_000n, clientRef: `0x${'89'.repeat(32)}` });
  function callResult(to, input, simulate = false) {
    const abi = to.toLowerCase() === TOKEN ? tokenAbi : escrowAbi;
    const { functionName: f, args: a = [] } = decodeFunctionData({ abi, data: input });
    let result;
    const addr = (i = 0) => a[i].toLowerCase();
    if (f === 'token') result = TOKEN;
    else if (f === 'symbol') result = 'dds';
    else if (f === 'name') result = 'kkk';
    else if (f === 'decimals') result = 6;
    else if (f === 'balanceOf') result = l.balances.get(addr()) ?? 0n;
    else if (f === 'allowance') result = l.allowances.get(addr()) ?? 0n;
    else if (f === 'refundCreditOf') result = l.credits.get(addr()) ?? 0n;
    else if (f === 'getItem') result = l.item;
    else if (f === 'quote') result = [l.policyId, l.policy];
    else if (f === 'getPolicy') result = l.policy;
    else if (f === 'getReservation') {
      result = l.reservations.get(a[0]);
      if (!result) throw { code: 3, message: 'execution reverted', data: encodeErrorResult({ abi, errorName: 'ReservationNotFound', args: [a[0]] }) };
    }
    else if (f === 'reservationByRef') result = l.refs.get(`${addr()}:${a[1]}`) ?? 0n;
    else if (f === 'approve') result = true;
    else if (f === 'reserve') {
      if (a[1] !== l.policyId) throw { code: 3, message: 'execution reverted', data: encodeErrorResult({ abi, errorName: 'PolicyMismatch', args: [a[1], l.policyId] }) };
      result = l.nextReservation;
    }
    else if (f === 'withdrawRefund') result = l.credits.get(l.walletAddress) ?? 0n;
    else if (f === 'cancel') result = undefined;
    else throw new Error(`Mock RPC lacks function ${f}`);
    return encodeFunctionResult({ abi, functionName: f, result });
  }
  function mined(tx) {
    if (tx.mined || l.holdReceipts) return;
    tx.mined = true; l.block += 1n;
    if (tx.reverted) return;
    const { functionName: f, args: a = [] } = decodeFunctionData({ abi: tx.to.toLowerCase() === TOKEN ? tokenAbi : escrowAbi, data: tx.input });
    const from = tx.from.toLowerCase();
    if (f === 'approve') l.allowances.set(from, a[1]);
    if (f === 'reserve') {
      const id = l.nextReservation++;
      const r = { itemId: a[0], renter: tx.from, policyId: a[1], createdAt: l.time, expiresAt: l.time + l.policy.reservationWindow, status: 1, deposit: l.policy.deposit, cancellationFee: l.policy.cancellationFee, clientRef: a[2] };
      l.reservations.set(id, r); l.refs.set(`${from}:${a[2]}`, id);
      l.item.state = 1; l.item.activeReservationId = id;
      l.balances.set(from, l.balances.get(from) - r.deposit); l.allowances.set(from, l.allowances.get(from) - r.deposit);
      const event = escrowAbi.find(e => e.type === 'event' && e.name === 'ReservationCreated');
      tx.logs.push({ address: ESCROW, topics: encodeEventTopics({ abi: escrowAbi, eventName: 'ReservationCreated', args: { reservationId: id, itemId: a[0], renter: tx.from } }), data: encodeAbiParameters(event.inputs.filter(i => !i.indexed), [r.policyId, r.deposit, r.cancellationFee, r.expiresAt, r.clientRef]), blockNumber: hex(l.block), blockHash, transactionHash: tx.hash, transactionIndex: '0x0', logIndex: '0x0', removed: false });
    }
    if (f === 'cancel') {
      const r = l.reservations.get(a[0]); r.status = 3; l.item.state = 0; l.item.activeReservationId = 0n;
      l.credits.set(from, (l.credits.get(from) ?? 0n) + r.deposit - r.cancellationFee);
    }
    if (f === 'withdrawRefund') { l.balances.set(from, l.balances.get(from) + (l.credits.get(from) ?? 0n)); l.credits.set(from, 0n); }
  }
  function transaction(tx) {
    return { hash: tx.hash, from: tx.from, to: tx.to, input: tx.input, value: '0x0', nonce: tx.nonce, gas: '0x30d40', gasPrice: '0x3b9aca00', maxFeePerGas: '0x3b9aca00', maxPriorityFeePerGas: '0x0', type: '0x2', chainId: '0xb626', v: '0x0', r: zeroHash, s: zeroHash, yParity: '0x0', accessList: [], blockHash: tx.mined ? blockHash : null, blockNumber: tx.mined ? hex(l.block) : null, transactionIndex: tx.mined ? '0x0' : null };
  }
  function block(full) {
    return { number: hex(l.block), hash: blockHash, parentHash: zeroHash, timestamp: hex(l.time), nonce: '0x0000000000000000', sha3Uncles: zeroHash, logsBloom: `0x${'00'.repeat(256)}`, transactionsRoot: zeroHash, stateRoot: zeroHash, receiptsRoot: zeroHash, miner: ZERO, difficulty: '0x0', totalDifficulty: '0x0', extraData: '0x', size: '0x100', gasLimit: '0x1c9c380', gasUsed: '0x100', baseFeePerGas: '0x3b9aca00', transactions: [...l.txs.values()].filter(t => t.mined).map(t => full ? transaction(t) : t.hash), uncles: [], mixHash: zeroHash };
  }
  l.rpc = async ({ method, params = [] }) => {
    switch (method) {
      case 'eth_chainId': return '0xb626';
      case 'eth_blockNumber': return hex(l.block);
      case 'eth_getBlockByNumber': return block(params[1]);
      case 'eth_getBalance': return hex(10n ** 18n);
      case 'eth_getCode': return '0x60006000';
      case 'eth_call': return callResult(params[0].to, params[0].data ?? params[0].input);
      case 'eth_estimateGas': return '0x30d40';
      case 'eth_gasPrice': return '0x3b9aca00';
      case 'eth_getTransactionCount': return hex(l.broadcasts.length);
      case 'eth_getTransactionByHash': { const tx = l.txs.get(params[0]); return tx ? transaction(tx) : null; }
      case 'eth_getTransactionReceipt': {
        const tx = l.txs.get(params[0]); if (!tx || l.holdReceipts) return null; mined(tx);
        return { transactionHash: tx.hash, transactionIndex: '0x0', blockHash, blockNumber: hex(l.block), from: tx.from, to: tx.to, cumulativeGasUsed: '0x186a0', gasUsed: '0x186a0', effectiveGasPrice: '0x3b9aca00', contractAddress: null, logs: tx.logs, logsBloom: `0x${'00'.repeat(256)}`, status: tx.reverted ? '0x0' : '0x1', type: '0x2' };
      }
      case 'eth_getLogs': return [...l.txs.values()].flatMap(t => t.logs);
      default: throw { code: -32601, message: `Mock RPC does not implement ${method}` };
    }
  };
  l.wallet = async ({ method, params = [] }) => {
    if (method === 'eth_chainId') return hex(l.walletChain);
    if (method === 'eth_accounts') return l.authorized ? [l.walletAddress] : [];
    if (method === 'eth_requestAccounts') { l.authorized = true; return [l.walletAddress]; }
    if (method === 'wallet_switchEthereumChain' && l.unknownNetwork) throw { code: 4902, message: 'Unknown chain' };
    if (method === 'wallet_switchEthereumChain' || method === 'wallet_addEthereumChain') { l.walletChain = Number(BigInt(params[0].chainId)); if (method === 'wallet_addEthereumChain') { l.unknownNetwork = false; l.addedNetwork = true; } return null; }
    if (method === 'wallet_getCapabilities') return {};
    if (method === 'wallet_requestPermissions') { l.authorized = true; return [{ parentCapability: 'eth_accounts' }]; }
    if (method === 'eth_sendTransaction') {
      if (l.rejectNext) { l.rejectNext = false; throw { code: 4001, message: 'User rejected the request.' }; }
      const input = params[0]; const hash = `0x${(l.broadcasts.length + 1).toString(16).padStart(64, '0')}`;
      const tx = { ...input, input: input.data, hash, nonce: hex(l.broadcasts.length), logs: [], mined: false, reverted: l.revertNext };
      l.revertNext = false; l.txs.set(hash, tx); l.broadcasts.push(tx); return hash;
    }
    return l.rpc({ method, params });
  };
  return l;
}

export function injectWallet() {
  const listeners = new Map();
  const provider = {
    isRabby: true,
    on(event, fn) { const set = listeners.get(event) ?? new Set(); set.add(fn); listeners.set(event, set); },
    removeListener(event, fn) { listeners.get(event)?.delete(fn); },
    emit(event, value) { listeners.get(event)?.forEach(fn => fn(value)); },
    async request(args) {
      const response = await window.mockWalletRequest(args);
      if (response.error) throw Object.assign(new Error(response.error.message), { code: response.error.code, data: response.error.data });
      if (args.method === 'wallet_switchEthereumChain' || args.method === 'wallet_addEthereumChain') provider.emit('chainChanged', args.params[0].chainId);
      return response.result;
    },
  };
  window.ethereum = provider;
  const announce = () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: { info: { uuid: 'd77938b4-c279-4327-8f53-f817af14b3e0', name: 'Rabby', rdns: 'io.rabby', icon: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="28" height="28"%3E%3Ccircle cx="14" cy="14" r="14" fill="%238891f2"/%3E%3C/svg%3E' }, provider } }));
  window.addEventListener('eip6963:requestProvider', announce); announce();
}
