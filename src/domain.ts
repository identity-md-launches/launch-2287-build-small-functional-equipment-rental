import { formatUnits, type Address, type Hash, type Hex } from 'viem';

export type Quote = { policyId: bigint; deposit: bigint; cancellationFee: bigint; reservationWindow: bigint; decimals: number };
export type Item = { exists: boolean; listed: boolean; state: number; policyId: bigint; activeReservationId: bigint; metadataURI: string };
export type Reservation = { itemId: bigint; renter: Address; policyId: bigint; createdAt: bigint; expiresAt: bigint; status: number; deposit: bigint; cancellationFee: bigint; clientRef: Hex };
export type Booking = { id: bigint; reservation: Reservation };
export type Snapshot = { item?: Item; quote?: Quote; decimals: number; symbol: string; balance?: bigint; allowance?: bigint; credit?: bigint; nativeBalance?: bigint; blockNumber: bigint; timestamp: bigint; fetchedAt: number };
export type Kind = 'approve' | 'reserve' | 'cancel' | 'withdraw';
export type StoredQuote = { policyId: string; deposit: string; cancellationFee: string; reservationWindow: string; decimals: number };
export type Operation = {
  kind: Kind;
  phase: 'prepared' | 'submitted' | 'uncertain';
  to: Address;
  data: Hex;
  block: string;
  startedAt: number;
  hash?: Hash;
  originalHash?: Hash;
  // A returned retry hash does not resolve an earlier send whose response was lost.
  priorUncertainty?: boolean;
  ref?: Hex;
  quote?: StoredQuote;
  reservationId?: string;
};
export type LastTransaction = { kind: Kind; hash: Hash; success: boolean };
export type Journal = { version: 1; operation?: Operation; lastReservationId?: string; lastTransaction?: LastTransaction };
export type Context = { address: Address; chainId: number };
export type ReceiptResult = { hash: Hash; success: boolean; matches: boolean };

export interface ChainGateway {
  snapshot(address?: Address): Promise<Snapshot>;
  reservation(id: bigint): Promise<Reservation>;
  byRef(address: Address, ref: Hex): Promise<bigint>;
  findReservationHash(id: bigint, address: Address, fromBlock: bigint): Promise<Hash | undefined>;
  simulate(address: Address, op: Operation): Promise<void>;
  wait(address: Address, op: Operation, onReplacement: (hash: Hash) => void): Promise<ReceiptResult>;
}
export interface WalletGateway {
  identity(): Promise<Context>;
  send(context: Context, op: Operation): Promise<Hash>;
}
export type Store = Pick<Storage, 'getItem' | 'setItem'>;
export const statusNames = ['Unknown', 'Reserved', 'Rented', 'Cancelled', 'Expired', 'Returned'];
export const itemStateNames = ['Available', 'Reserved', 'Rented'];
export const sameAddress = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
export const sameQuote = (a?: Quote, b?: Quote) => !!a && !!b && a.policyId === b.policyId && a.deposit === b.deposit && a.cancellationFee === b.cancellationFee && a.reservationWindow === b.reservationWindow && a.decimals === b.decimals;
export const storeQuote = (q: Quote): StoredQuote => ({ policyId: q.policyId.toString(), deposit: q.deposit.toString(), cancellationFee: q.cancellationFee.toString(), reservationWindow: q.reservationWindow.toString(), decimals: q.decimals });
export const restoreQuote = (q: StoredQuote): Quote => ({ policyId: BigInt(q.policyId), deposit: BigInt(q.deposit), cancellationFee: BigInt(q.cancellationFee), reservationWindow: BigInt(q.reservationWindow), decimals: q.decimals });
export function amount(value: bigint, decimals: number) {
  return formatUnits(value, decimals);
}
export function windowText(seconds: bigint) {
  if (seconds % 86400n === 0n) return `${seconds / 86400n} ${seconds === 86400n ? 'day' : 'days'}`;
  if (seconds % 3600n === 0n) return `${seconds / 3600n} ${seconds === 3600n ? 'hour' : 'hours'}`;
  if (seconds % 60n === 0n) return `${seconds / 60n} minutes`;
  return `${seconds} seconds`;
}
export const canCancel = (r: Reservation, address: Address | undefined, timestamp: bigint) => !!address && sameAddress(r.renter, address) && r.status === 1 && timestamp < r.expiresAt;
export function randomRef(): Hex {
  const bytes = new Uint8Array(32);
  do crypto.getRandomValues(bytes); while (bytes.every(b => b === 0));
  return `0x${Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')}`;
}
export function isRejected(error: unknown): boolean {
  let e = error as { code?: number; name?: string; cause?: unknown } | undefined;
  for (let i = 0; e && i < 8; i++, e = e.cause as typeof e) {
    if (e.code === 4001 || e.name === 'UserRejectedRequestError') return true;
  }
  return false;
}
export function errorText(error: unknown): string {
  if (isRejected(error)) return 'Request rejected in your wallet. No new transaction hash was returned.';
  const e = error as { shortMessage?: string; message?: string };
  return (e?.shortMessage ?? e?.message ?? 'The RPC or wallet did not respond. Try again.').slice(0, 500);
}
