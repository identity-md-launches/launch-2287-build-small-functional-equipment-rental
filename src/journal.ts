import { encodeFunctionData, type Abi, type Address } from 'viem';
import escrowAbi from './abi/RentalEscrow.json';
import tokenAbi from './abi/MockPaymentToken.json';
import { CHAIN_ID, ESCROW, ITEM_ID, TOKEN } from './network';
import { restoreQuote, sameAddress, type Context, type Journal, type Operation, type Store } from './domain';

export const journalKey = (c: Context) => `fieldkit:v1:${c.chainId}:${ESCROW.toLowerCase()}:${c.address.toLowerCase()}`;
const uint = (x: unknown) => typeof x === 'string' && x.length <= 78 && /^(0|[1-9][0-9]*)$/.test(x) && BigInt(x) < 2n ** 256n;
const hash = (x: unknown) => typeof x === 'string' && /^0x[0-9a-fA-F]{64}$/.test(x);
export function transactionFor(op: Pick<Operation, 'kind' | 'quote' | 'ref' | 'reservationId'>): { to: Address; data: `0x${string}` } {
  if (op.kind === 'approve' && op.quote) return { to: TOKEN, data: encodeFunctionData({ abi: tokenAbi as Abi, functionName: 'approve', args: [ESCROW, BigInt(op.quote.deposit)] }) };
  if (op.kind === 'reserve' && op.quote && op.ref) return { to: ESCROW, data: encodeFunctionData({ abi: escrowAbi as Abi, functionName: 'reserve', args: [ITEM_ID, BigInt(op.quote.policyId), op.ref] }) };
  if (op.kind === 'cancel' && op.reservationId) return { to: ESCROW, data: encodeFunctionData({ abi: escrowAbi as Abi, functionName: 'cancel', args: [BigInt(op.reservationId)] }) };
  if (op.kind === 'withdraw') return { to: ESCROW, data: encodeFunctionData({ abi: escrowAbi as Abi, functionName: 'withdrawRefund' }) };
  throw new Error('The saved request is incomplete. Writes are disabled.');
}
export function readJournal(store: Store, c: Context): Journal {
  const raw = store.getItem(journalKey(c));
  if (!raw) return { version: 1 };
  try {
    const j = JSON.parse(raw) as Journal;
    if (j.version !== 1 || (j.lastReservationId !== undefined && !uint(j.lastReservationId))) throw new Error();
    if (j.lastTransaction && (!['approve', 'reserve', 'cancel', 'withdraw'].includes(j.lastTransaction.kind) || !hash(j.lastTransaction.hash) || typeof j.lastTransaction.success !== 'boolean')) throw new Error();
    const op = j.operation;
    if (op) {
      if (!['prepared', 'submitted', 'uncertain'].includes(op.phase) || !uint(op.block) || !Number.isFinite(op.startedAt)) throw new Error();
      if (op.hash !== undefined && !hash(op.hash)) throw new Error();
      if (op.originalHash !== undefined && !hash(op.originalHash)) throw new Error();
      if (op.reservationId !== undefined && (!uint(op.reservationId) || BigInt(op.reservationId) === 0n)) throw new Error();
      if (op.ref !== undefined && (!hash(op.ref) || BigInt(op.ref) === 0n)) throw new Error();
      if (op.quote) {
        if (![op.quote.policyId, op.quote.deposit, op.quote.cancellationFee, op.quote.reservationWindow].every(uint)) throw new Error();
        const q = restoreQuote(op.quote);
        if (q.policyId === 0n || q.policyId >= 2n ** 64n || q.deposit === 0n || q.cancellationFee > q.deposit || q.reservationWindow === 0n || q.reservationWindow >= 2n ** 64n || !Number.isInteger(q.decimals) || q.decimals < 0 || q.decimals > 255) throw new Error();
      }
      const expected = transactionFor(op);
      if (!sameAddress(op.to, expected.to) || op.data !== expected.data) throw new Error();
    }
    return j;
  } catch {
    throw new Error('Saved recovery data is unreadable. Writes are disabled to protect an uncertain payment. Keep this browser data and use your wallet transaction history to reconcile it.');
  }
}
export function writeJournal(store: Store, c: Context, journal: Journal) {
  if (c.chainId !== CHAIN_ID) throw new Error('Switch to Robinhood Chain Testnet first.');
  try { store.setItem(journalKey(c), JSON.stringify(journal)); }
  catch { throw new Error('Browser storage is unavailable. This app must save recovery data before sending. Keep any displayed transaction hash and retry in a browser with local storage enabled.'); }
}
