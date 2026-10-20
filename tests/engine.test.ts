import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodeFunctionData, type Abi, type Address, type Hash, type Hex } from 'viem';
import { RentalEngine } from '../src/engine';
import { amount, canCancel, randomRef, type ChainGateway, type Context, type Operation, type ReceiptResult, type Reservation, type Snapshot, type Store, type WalletGateway } from '../src/domain';
import { CHAIN_ID, ESCROW, TOKEN } from '../src/network';
import { journalKey, readJournal } from '../src/journal';
import escrowAbi from '../src/abi/RentalEscrow.json';
import tokenAbi from '../src/abi/MockPaymentToken.json';

const renter = '0x1111111111111111111111111111111111111111' as Address;
const other = '0x2222222222222222222222222222222222222222' as Address;
const hash = `0x${'ab'.repeat(32)}` as Hash;
const replacement = `0x${'cd'.repeat(32)}` as Hash;
const ref = `0x${'12'.repeat(32)}` as Hex;
const context: Context = { address: renter, chainId: CHAIN_ID };
afterEach(() => vi.unstubAllGlobals());
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}
function fixture() {
  const values = new Map<string, string>();
  const store: Store = { getItem: k => values.get(k) ?? null, setItem: (k, v) => { values.set(k, v); } };
  const data: Snapshot = {
    item: { exists: true, listed: true, state: 0, policyId: 1n, activeReservationId: 0n, metadataURI: '<img src=x onerror=alert(1)>' },
    quote: { policyId: 1n, deposit: 50_000_000n, cancellationFee: 5_000_000n, reservationWindow: 86_400n, decimals: 6 },
    decimals: 6, symbol: 'dds', balance: 100_000_000n, allowance: 0n, credit: 0n, nativeBalance: 10n ** 18n,
    blockNumber: 20n, timestamp: 1_000_000n, fetchedAt: Date.now(),
  };
  let reservation: Reservation = { itemId: 1n, renter, policyId: 1n, createdAt: data.timestamp, expiresAt: data.timestamp + 86_400n, status: 1, deposit: 50_000_000n, cancellationFee: 5_000_000n, clientRef: ref };
  let exists = false;
  const apply = (op: Operation) => {
    if (op.kind === 'approve') data.allowance = BigInt(op.quote!.deposit);
    if (op.kind === 'reserve') {
      if (exists && reservation.clientRef === op.ref) return;
      exists = true; reservation = { ...reservation, clientRef: op.ref!, policyId: BigInt(op.quote!.policyId), deposit: BigInt(op.quote!.deposit), cancellationFee: BigInt(op.quote!.cancellationFee), expiresAt: data.timestamp + BigInt(op.quote!.reservationWindow) };
      data.balance! -= reservation.deposit; data.allowance! -= reservation.deposit;
      data.item!.state = 1; data.item!.activeReservationId = 7n;
    }
    if (op.kind === 'cancel') { reservation.status = 3; data.credit! += reservation.deposit - reservation.cancellationFee; data.item!.state = 0; data.item!.activeReservationId = 0n; }
    if (op.kind === 'withdraw') { data.balance! += data.credit!; data.credit = 0n; }
  };
  const chain: ChainGateway = {
    snapshot: vi.fn(async () => structuredClone(data)),
    reservation: vi.fn(async () => structuredClone(reservation)),
    byRef: vi.fn(async (_a, r) => exists && r === reservation.clientRef ? 7n : 0n),
    findReservationHash: vi.fn(async () => hash),
    simulate: vi.fn(async () => {}),
    wait: vi.fn(async (_a, op) => { apply(op); return { hash: op.hash!, success: true, matches: true }; }),
  };
  const wallet: WalletGateway = { identity: vi.fn(async () => context), send: vi.fn(async () => hash) };
  const engine = new RentalEngine(chain, wallet, store);
  return { engine, chain, wallet, store, values, data, apply, get reservation() { return reservation; }, set reservation(r: Reservation) { reservation = r; }, setExists: (v: boolean) => { exists = v; } };
}
async function connected(f = fixture()) { await f.engine.setContext(context); return f; }
async function approved() {
  const f = await connected();
  f.data.allowance = 50_000_000n;
  await f.engine.refresh(); f.engine.accept(true); return f;
}

describe('integer token amounts', () => {
  it('formats 6 decimals without losing base units or large integer precision', () => {
    expect(amount(50_000_000n, 6)).toBe('50');
    expect(amount(1n, 6)).toBe('0.000001');
    expect(amount(1_234_567n, 6)).toBe('1.234567');
    expect(amount(90_071_992_547_409_931n, 6)).toBe('90071992547.409931');
  });
  it('creates a nonzero, 32-byte cryptographic client reference', () => {
    const a = randomRef(); expect(a).toMatch(/^0x[0-9a-f]{64}$/); expect(BigInt(a)).not.toBe(0n); expect(randomRef()).not.toBe(a);
  });
});

describe('renter lifecycle', () => {
  it('books, cancels into credit, then separately withdraws after successful receipts', async () => {
    const f = await connected(); f.engine.accept(true);
    await f.engine.execute('approve');
    expect(f.wallet.send).toHaveBeenCalledTimes(1);
    expect(f.engine.getState().journal.lastTransaction?.kind).toBe('approve');
    expect(f.engine.getState().booking).toBeUndefined();
    await f.engine.execute('reserve');
    expect(f.engine.getState().booking?.id).toBe(7n);
    expect(f.engine.getState().booking?.reservation.deposit).toBe(50_000_000n);
    expect(f.engine.getState().data?.balance).toBe(50_000_000n);
    await f.engine.execute('cancel', 7n);
    expect(f.engine.getState().booking?.reservation.status).toBe(3);
    expect(f.engine.getState().data?.credit).toBe(45_000_000n);
    expect(f.engine.getState().data?.balance).toBe(50_000_000n);
    expect(f.engine.getState().message).toContain('withdraw it separately');
    await f.engine.execute('withdraw');
    expect(f.engine.getState().data?.credit).toBe(0n);
    expect(f.engine.getState().data?.balance).toBe(95_000_000n);
    expect(f.wallet.send).toHaveBeenCalledTimes(4);
    const op = vi.mocked(f.wallet.send).mock.calls[1][1];
    const call = decodeFunctionData({ abi: escrowAbi as Abi, data: op.data });
    expect(call.functionName).toBe('reserve'); expect(call.args).toEqual([1n, 1n, op.ref]);
  });
  it('sets an exact total allowance, including when the prior allowance is insufficient but nonzero', async () => {
    const f = await connected(); f.data.allowance = 20_000_000n; f.engine.accept(true);
    await f.engine.execute('approve');
    const op = vi.mocked(f.wallet.send).mock.calls[0][1];
    expect(op.to).toBe(TOKEN);
    expect(decodeFunctionData({ abi: tokenAbi as Abi, data: op.data }).args).toEqual([ESCROW, 50_000_000n]);
  });
  it('skips an unnecessary approval when on-chain allowance already covers the deposit', async () => {
    const f = await approved(); await f.engine.execute('approve');
    expect(f.wallet.send).not.toHaveBeenCalled(); expect(f.engine.getState().message).toContain('already covers');
  });
  it('requires acceptance before approval or reservation', async () => {
    const f = await connected(); await f.engine.execute('approve'); await f.engine.execute('reserve');
    expect(f.wallet.send).not.toHaveBeenCalled(); expect(f.engine.getState().error).toContain('accept');
  });
  it.each(['policyId', 'deposit', 'cancellationFee', 'reservationWindow'] as const)('blocks changed %s and clears prior acceptance', async field => {
    const f = await approved(); f.data.quote![field] += 1n;
    await f.engine.execute('reserve');
    expect(f.wallet.send).not.toHaveBeenCalled(); expect(f.engine.getState().accepted).toBeUndefined(); expect(f.engine.getState().error).toContain('policy changed');
  });
  it('stops approval when policy changes, then accepts and uses the renewed terms', async () => {
    const f = await connected(); f.engine.accept(true);
    f.data.quote!.policyId = 2n; f.data.quote!.deposit = 60_000_000n;
    await f.engine.execute('approve'); expect(f.wallet.send).not.toHaveBeenCalled();
    f.engine.accept(true); await f.engine.execute('approve');
    expect(BigInt(vi.mocked(f.wallet.send).mock.calls[0][1].quote!.deposit)).toBe(60_000_000n);
  });
  it.each(['balance', 'nativeBalance'] as const)('blocks insufficient %s', async field => {
    const f = await approved(); f.data[field] = 0n; await f.engine.execute('reserve');
    expect(f.wallet.send).not.toHaveBeenCalled(); expect(f.engine.getState().error).toMatch(/Insufficient|test ETH/);
  });
  it.each([{ listed: false }, { state: 1 }, { exists: false }])('blocks unavailable item %j', async change => {
    const f = await approved(); Object.assign(f.data.item!, change); await f.engine.execute('reserve');
    expect(f.wallet.send).not.toHaveBeenCalled(); expect(f.engine.getState().error).toContain('no longer available');
  });
  it('retains booking snapshot terms even if the current item policy changes', async () => {
    const f = await approved(); await f.engine.execute('reserve');
    f.data.quote!.deposit = 70_000_000n; f.data.quote!.policyId = 2n;
    await f.engine.refresh();
    expect(f.engine.getState().booking?.reservation.deposit).toBe(50_000_000n);
    expect(f.engine.getState().data?.quote?.deposit).toBe(70_000_000n);
  });
});

describe('receipt and recovery safety', () => {
  it('locks duplicate clicks while confirmation is pending and never reports premature success', async () => {
    const f = await approved(); const d = deferred<ReceiptResult>();
    vi.mocked(f.chain.wait).mockImplementation(async (_a, op) => { const result = await d.promise; f.apply(op); return result; });
    const first = f.engine.execute('reserve');
    await vi.waitFor(() => expect(f.chain.wait).toHaveBeenCalledTimes(1));
    await f.engine.execute('reserve');
    expect(f.wallet.send).toHaveBeenCalledTimes(1); expect(f.engine.getState().booking).toBeUndefined();
    expect(f.engine.getState().journal.operation?.hash).toBe(hash);
    expect(f.engine.getState().message).toContain('not confirmed');
    d.resolve({ hash, success: true, matches: true }); await first;
    expect(f.engine.getState().booking?.id).toBe(7n);
  });
  it('serializes wallet actions across tabs using Web Locks when available', async () => {
    let held = false;
    vi.stubGlobal('navigator', { locks: { request: async (_name: string, _options: unknown, callback: (lock: object | null) => Promise<void>) => {
      if (held) return callback(null);
      held = true; try { return await callback({}); } finally { held = false; }
    } } });
    const f = await approved(); const second = new RentalEngine(f.chain, f.wallet, f.store);
    await second.setContext(context); second.accept(true);
    const d = deferred<Hash>(); vi.mocked(f.wallet.send).mockReturnValueOnce(d.promise);
    const attempt = f.engine.execute('reserve'); await vi.waitFor(() => expect(f.wallet.send).toHaveBeenCalledTimes(1));
    await second.execute('reserve'); expect(second.getState().error).toContain('Another tab'); expect(f.wallet.send).toHaveBeenCalledTimes(1);
    d.resolve(hash); await attempt;
  });
  it('distinguishes a confirmed receipt from a failed balance refresh', async () => {
    const f = await approved();
    vi.mocked(f.chain.wait).mockImplementationOnce(async (_a, op) => {
      f.apply(op); vi.mocked(f.chain.snapshot).mockRejectedValueOnce(new Error('RPC failed after confirmation'));
      return { hash, success: true, matches: true };
    });
    await f.engine.execute('reserve');
    expect(f.engine.getState().journal.lastTransaction?.success).toBe(true);
    expect(f.engine.getState().data).toBeUndefined();
    expect(f.engine.getState().message).toContain('could not be refreshed');
    expect(f.engine.getState().error).toContain('RPC failed after confirmation');
  });
  it('recovers a submitted booking after reload using its original reference and hash', async () => {
    const f = await approved(); vi.mocked(f.chain.wait).mockRejectedValueOnce(new Error('Receipt delayed'));
    await f.engine.execute('reserve');
    const saved = readJournal(f.store, context).operation!;
    expect(saved.hash).toBe(hash); expect(f.engine.getState().booking).toBeUndefined();
    const reloaded = new RentalEngine(f.chain, f.wallet, f.store); await reloaded.setContext(context);
    expect(reloaded.getState().booking?.reservation.clientRef).toBe(saved.ref);
    expect(reloaded.getState().journal.operation).toBeUndefined();
    expect(f.wallet.send).toHaveBeenCalledTimes(1);
    const again = new RentalEngine(f.chain, f.wallet, f.store); await again.setContext(context);
    expect(again.getState().booking?.id).toBe(7n);
  });
  it('retains an unknown send result and only retries the same reference after a mapping check', async () => {
    const f = await approved(); vi.mocked(f.wallet.send).mockRejectedValueOnce(new Error('Transport disconnected after send'));
    await f.engine.execute('reserve'); const op = readJournal(f.store, context).operation!;
    expect(op.hash).toBeUndefined(); expect(op.ref).toBeTruthy();
    const reloaded = new RentalEngine(f.chain, f.wallet, f.store); await reloaded.setContext(context);
    await reloaded.retryReservation();
    expect(vi.mocked(f.wallet.send).mock.calls[1][1].ref).toBe(op.ref);
    expect(f.chain.byRef).toHaveBeenCalledWith(renter, op.ref);
    expect(reloaded.getState().booking?.id).toBe(7n);
  });
  it('recovers a lost hash through reservationByRef and creation logs, then checks a receipt', async () => {
    const f = await approved(); vi.mocked(f.wallet.send).mockImplementationOnce(async (_c, op) => { f.apply(op); throw new Error('Wallet response lost'); });
    await f.engine.execute('reserve');
    const reloaded = new RentalEngine(f.chain, f.wallet, f.store); await reloaded.setContext(context);
    expect(f.chain.findReservationHash).toHaveBeenCalledWith(7n, renter, 20n);
    expect(f.chain.wait).toHaveBeenCalled(); expect(f.wallet.send).toHaveBeenCalledTimes(1);
    expect(reloaded.getState().journal.lastTransaction?.success).toBe(true);
  });
  it('never retries if reservationByRef is unavailable or a transaction hash is still unresolved', async () => {
    const f = await approved(); vi.mocked(f.chain.wait).mockRejectedValue(new Error('RPC unavailable'));
    await f.engine.execute('reserve'); await f.engine.retryReservation();
    expect(f.wallet.send).toHaveBeenCalledTimes(1); expect(f.engine.getState().journal.operation?.hash).toBe(hash);
    vi.mocked(f.chain.byRef).mockRejectedValue(new Error('RPC unavailable')); await f.engine.retryReservation();
    expect(f.wallet.send).toHaveBeenCalledTimes(1);
  });
  it('does not retry a stored booking under a different policy', async () => {
    const f = await approved(); vi.mocked(f.wallet.send).mockRejectedValueOnce(new Error('Unknown response'));
    await f.engine.execute('reserve'); f.data.quote!.policyId = 2n;
    await f.engine.retryReservation(); expect(f.wallet.send).toHaveBeenCalledTimes(1); expect(f.engine.getState().error).toContain('policy changed');
  });
  it('clears a known rejected signature without claiming success', async () => {
    const f = await approved(); vi.mocked(f.wallet.send).mockRejectedValueOnce({ code: 4001 });
    await f.engine.execute('reserve'); expect(f.engine.getState().error).toContain('rejected');
    expect(readJournal(f.store, context).operation).toBeUndefined(); expect(f.engine.getState().booking).toBeUndefined();
  });
  it('retains a known broadcast hash even if later RPC failure carries a rejection code', async () => {
    const f = await approved(); vi.mocked(f.chain.wait).mockRejectedValueOnce({ code: 4001, message: 'RPC receipt request refused' });
    await f.engine.execute('reserve');
    expect(readJournal(f.store, context).operation?.hash).toBe(hash);
    expect(f.engine.getState().journal.operation?.phase).toBe('uncertain');
    expect(f.engine.getState().journal.lastTransaction).toBeUndefined();
    expect(f.engine.getState().error).toContain('saved request has been retained');
  });
  it('shows a reverted receipt as failure and permits a fresh explicit attempt', async () => {
    const f = await approved(); vi.mocked(f.chain.wait).mockResolvedValueOnce({ hash, success: false, matches: true });
    await f.engine.execute('reserve'); expect(f.engine.getState().error).toContain('reverted');
    expect(readJournal(f.store, context).lastTransaction?.success).toBe(false); expect(f.engine.getState().booking).toBeUndefined();
    expect(f.engine.getState().journal.operation).toBeUndefined();
  });
  it('does not accept a successful replacement with different calldata as rental success', async () => {
    const f = await approved(); vi.mocked(f.chain.wait).mockResolvedValueOnce({ hash: replacement, success: true, matches: false });
    await f.engine.execute('reserve'); expect(f.engine.getState().error).toContain('replaced'); expect(f.engine.getState().journal.lastTransaction?.success).toBe(false);
  });
  it('persists a sped-up replacement hash before completing the original action', async () => {
    const f = await approved(); vi.mocked(f.chain.wait).mockImplementationOnce(async (_a, op, replaced) => {
      replaced(replacement); expect(readJournal(f.store, context).operation?.hash).toBe(replacement);
      f.apply(op); return { hash: replacement, success: true, matches: true };
    });
    await f.engine.execute('reserve'); expect(f.engine.getState().journal.lastTransaction?.hash).toBe(replacement);
  });
  it('does not discard the unresolved request for an unrelated manually supplied hash', async () => {
    const f = await approved(); vi.mocked(f.wallet.send).mockRejectedValueOnce(new Error('Unknown response'));
    await f.engine.execute('reserve'); const original = readJournal(f.store, context).operation!;
    vi.mocked(f.chain.wait).mockResolvedValueOnce({ hash: replacement, success: true, matches: false });
    await f.engine.recover(replacement);
    expect(readJournal(f.store, context).operation?.ref).toBe(original.ref);
    expect(f.engine.getState().error).toContain('does not match');
  });
});

describe('cancellation, ownership and aggregate refunds', () => {
  it.each([0, 2, 3, 4, 5])('rejects cancellation in status %d', async status => {
    const f = await connected(); f.reservation.status = status;
    await f.engine.execute('cancel', 7n); expect(f.wallet.send).not.toHaveBeenCalled();
  });
  it('rejects cancellation at the exact expiry boundary, and for another renter', async () => {
    const f = await connected(); f.reservation.expiresAt = f.data.timestamp;
    expect(canCancel(f.reservation, renter, f.data.timestamp)).toBe(false);
    await f.engine.execute('cancel', 7n); expect(f.wallet.send).not.toHaveBeenCalled();
    f.reservation.expiresAt += 100n; f.reservation.renter = other;
    await f.engine.execute('cancel', 7n); expect(f.wallet.send).not.toHaveBeenCalled();
  });
  it('re-reads credit and withdraws the aggregate, including other reservations', async () => {
    const f = await connected(); f.data.credit = 75_000_001n; await f.engine.execute('withdraw');
    expect(f.engine.getState().data?.balance).toBe(175_000_001n);
    const op = vi.mocked(f.wallet.send).mock.calls[0][1];
    expect(decodeFunctionData({ abi: escrowAbi as Abi, data: op.data }).functionName).toBe('withdrawRefund');
  });
  it('rejects withdrawal if the latest credit is zero', async () => {
    const f = await connected(); await f.engine.execute('withdraw'); expect(f.wallet.send).not.toHaveBeenCalled();
  });
});

describe('session and RPC safety', () => {
  it('blocks a wrong-chain session and a changed wallet identity', async () => {
    const f = await approved(); await f.engine.setContext({ ...context, chainId: 1 }); await f.engine.execute('reserve');
    expect(f.wallet.send).not.toHaveBeenCalled();
    await f.engine.setContext(context); f.engine.accept(true);
    vi.mocked(f.wallet.identity).mockResolvedValue({ ...context, address: other });
    await f.engine.execute('reserve'); expect(f.wallet.send).not.toHaveBeenCalled(); expect(f.engine.getState().error).toContain('changed');
  });
  it('clears account-specific state and ignores a stale preflight after an account change', async () => {
    const f = await approved(); await f.engine.lookup('7'); const d = deferred<Snapshot>();
    vi.mocked(f.chain.snapshot).mockImplementationOnce(() => d.promise);
    const reads = vi.mocked(f.chain.snapshot).mock.calls.length;
    const attempt = f.engine.execute('reserve'); await vi.waitFor(() => expect(f.chain.snapshot).toHaveBeenCalledTimes(reads + 1));
    await f.engine.setContext({ address: other, chainId: CHAIN_ID });
    expect(f.engine.getState().booking).toBeUndefined(); expect(f.engine.getState().accepted).toBeUndefined();
    d.resolve(structuredClone(f.data)); await attempt; expect(f.wallet.send).not.toHaveBeenCalled();
  });
  it('keeps an in-flight hash in the originating wallet scope after an account change', async () => {
    const f = await approved(); const d = deferred<Hash>(); vi.mocked(f.wallet.send).mockReturnValueOnce(d.promise);
    const attempt = f.engine.execute('reserve'); await vi.waitFor(() => expect(f.wallet.send).toHaveBeenCalled());
    await f.engine.setContext({ address: other, chainId: CHAIN_ID }); d.resolve(hash); await attempt;
    expect(readJournal(f.store, context).operation?.hash).toBe(hash);
    expect(f.engine.getState().journal.operation).toBeUndefined(); expect(f.engine.getState().booking).toBeUndefined();
  });
  it('allows the new account to act while an old account wallet response is outstanding', async () => {
    const f = await approved(); const d = deferred<Hash>(); vi.mocked(f.wallet.send).mockReturnValueOnce(d.promise);
    const oldAttempt = f.engine.execute('reserve'); await vi.waitFor(() => expect(f.wallet.send).toHaveBeenCalledTimes(1));
    f.data.allowance = 0n;
    await f.engine.setContext({ address: other, chainId: CHAIN_ID }); f.engine.accept(true);
    vi.mocked(f.wallet.identity).mockResolvedValue({ address: other, chainId: CHAIN_ID });
    vi.mocked(f.wallet.send).mockResolvedValue(replacement);
    await f.engine.execute('approve');
    expect(f.wallet.send).toHaveBeenCalledTimes(2);
    expect(f.engine.getState().journal.lastTransaction?.kind).toBe('approve');
    d.resolve(hash); await oldAttempt;
    expect(readJournal(f.store, context).operation?.hash).toBe(hash);
    expect(f.engine.getState().journal.lastTransaction?.hash).toBe(replacement);
    expect(f.engine.getState().booking).toBeUndefined();
  });
  it('removes stale chain data when RPC reads fail and allows an honest retry', async () => {
    const f = await approved(); vi.mocked(f.chain.snapshot).mockRejectedValueOnce(new Error('RPC offline'));
    await f.engine.refresh(); expect(f.engine.getState().data).toBeUndefined(); expect(f.engine.getState().error).toContain('RPC offline');
    await f.engine.refresh(); expect(f.engine.getState().data?.balance).toBe(100_000_000n);
  });
  it('blocks sends when simulation reverts or storage cannot preserve recovery data', async () => {
    const f = await approved(); vi.mocked(f.chain.simulate).mockRejectedValueOnce(new Error('Execution reverted'));
    await f.engine.execute('reserve'); expect(f.wallet.send).not.toHaveBeenCalled();
    f.store.setItem = () => { throw new Error('Quota exceeded'); };
    await f.engine.execute('reserve'); expect(f.wallet.send).not.toHaveBeenCalled(); expect(f.engine.getState().error).toContain('storage');
  });
  it('refuses tampered saved calldata instead of sending it to an arbitrary address', async () => {
    const f = await approved(); vi.mocked(f.wallet.send).mockRejectedValueOnce(new Error('Unknown response'));
    await f.engine.execute('reserve');
    const j = readJournal(f.store, context); j.operation!.to = other;
    f.values.set(journalKey(context), JSON.stringify(j));
    const reloaded = new RentalEngine(f.chain, f.wallet, f.store); await reloaded.setContext(context);
    expect(reloaded.getState().storageError).toContain('unreadable'); await reloaded.retryReservation(); expect(f.wallet.send).toHaveBeenCalledTimes(1);
  });
  it('scopes local recovery by chain, escrow and wallet', () => {
    expect(journalKey(context)).toContain(ESCROW.toLowerCase());
    expect(journalKey(context)).not.toBe(journalKey({ ...context, chainId: 1 }));
    expect(journalKey(context)).not.toBe(journalKey({ ...context, address: other }));
  });
  it.each(['0', '-1', '1.2', '0x7', '9999999999999999999999999999999999999999999999999999999999999999999999999999999'])('validates reservation ID %s', async input => {
    const f = await connected(); await f.engine.lookup(input); expect(f.chain.reservation).not.toHaveBeenCalled(); expect(f.engine.getState().error).toContain('positive reservation ID');
  });
});
