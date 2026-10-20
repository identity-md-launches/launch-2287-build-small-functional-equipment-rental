import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Address, Hash } from 'viem';
import { PublicChain, publicClient } from '../src/gateway';
import { CHAIN_ID, ESCROW, TOKEN } from '../src/network';
import { transactionFor } from '../src/journal';
import type { Operation } from '../src/domain';

const renter = '0x1111111111111111111111111111111111111111' as Address;
const other = '0x2222222222222222222222222222222222222222' as Address;
const hash = `0x${'ef'.repeat(32)}` as Hash;
const replacement = `0x${'ab'.repeat(32)}` as Hash;
const op: Operation = { kind: 'withdraw', ...transactionFor({ kind: 'withdraw' }), phase: 'submitted', block: '10', startedAt: 1000, hash };
type Tx = Awaited<ReturnType<typeof publicClient.getTransaction>>;
type Receipt = Awaited<ReturnType<typeof publicClient.waitForTransactionReceipt>>;
afterEach(() => vi.restoreAllMocks());
describe('receipt verification against actual transaction contents', () => {
  const transaction = { from: renter, to: ESCROW, input: op.data, value: 0n };
  it.each([
    { from: other }, { to: TOKEN }, { to: null }, { input: '0x' }, { value: 1n },
  ])('rejects mismatched transaction fields (case %#)', async change => {
    vi.spyOn(publicClient, 'waitForTransactionReceipt').mockResolvedValue({ transactionHash: hash, status: 'success', blockNumber: 11n } as Receipt);
    vi.spyOn(publicClient, 'getTransaction').mockResolvedValue({ ...transaction, ...change } as Tx);
    const receipt = await new PublicChain().wait(renter, op, () => {});
    expect(receipt.success).toBe(true); expect(receipt.matches).toBe(false);
  });
  it('accepts only a successful receipt and exact sender, target, calldata and zero native value', async () => {
    vi.spyOn(publicClient, 'waitForTransactionReceipt').mockResolvedValue({ transactionHash: hash, status: 'success', blockNumber: 11n } as Receipt);
    vi.spyOn(publicClient, 'getTransaction').mockResolvedValue(transaction as unknown as Tx);
    expect(await new PublicChain().wait(renter, op, () => {})).toEqual({ hash, success: true, matches: true });
  });
  it('does not convert a reverted receipt into success', async () => {
    vi.spyOn(publicClient, 'waitForTransactionReceipt').mockResolvedValue({ transactionHash: hash, status: 'reverted', blockNumber: 11n } as Receipt);
    vi.spyOn(publicClient, 'getTransaction').mockResolvedValue(transaction as unknown as Tx);
    expect((await new PublicChain().wait(renter, op, () => {})).success).toBe(false);
  });
  it('uses the replacement hash and checks the replacement transaction', async () => {
    vi.spyOn(publicClient, 'waitForTransactionReceipt').mockImplementation(async params => {
      params.onReplaced?.({ reason: 'repriced', transaction: { hash: replacement } as Tx, replacedTransaction: { hash } as Tx, transactionReceipt: { transactionHash: replacement } as Receipt });
      return { transactionHash: replacement, status: 'success', blockNumber: 11n } as Receipt;
    });
    const transactionSpy = vi.spyOn(publicClient, 'getTransaction').mockResolvedValue(transaction as unknown as Tx);
    const onReplacement = vi.fn();
    const result = await new PublicChain().wait(renter, op, onReplacement);
    expect(onReplacement).toHaveBeenCalledWith(replacement); expect(transactionSpy).toHaveBeenCalledWith({ hash: replacement }); expect(result.matches).toBe(true);
  });
  it('preserves RPC receipt errors instead of manufacturing a receipt', async () => {
    vi.spyOn(publicClient, 'waitForTransactionReceipt').mockRejectedValue(new Error('RPC unavailable'));
    await expect(new PublicChain().wait(renter, op, () => {})).rejects.toThrow('RPC unavailable');
  });
  it('rejects an older identical withdrawal receipt supplied as recovery evidence', async () => {
    vi.spyOn(publicClient, 'waitForTransactionReceipt').mockResolvedValue({ transactionHash: hash, status: 'success', blockNumber: 10n } as Receipt);
    vi.spyOn(publicClient, 'getTransaction').mockResolvedValue(transaction as unknown as Tx);
    expect((await new PublicChain().wait(renter, op, () => {})).matches).toBe(false);
  });
});
describe('public snapshot integrity', () => {
  it('refuses an RPC on the wrong chain', async () => {
    vi.spyOn(publicClient, 'getChainId').mockResolvedValue(1);
    vi.spyOn(publicClient, 'getBlock').mockResolvedValue({ number: 12n, timestamp: 100n } as Awaited<ReturnType<typeof publicClient.getBlock>>);
    await expect(new PublicChain().snapshot()).rejects.toThrow('wrong chain');
  });
  it('pins every contract read to one block, verifies the payment token, and uses read decimals', async () => {
    vi.spyOn(publicClient, 'getChainId').mockResolvedValue(CHAIN_ID);
    vi.spyOn(publicClient, 'getBlock').mockResolvedValue({ number: 12n, timestamp: 100n } as Awaited<ReturnType<typeof publicClient.getBlock>>);
    const reads = vi.spyOn(publicClient, 'readContract').mockImplementation(async p => {
      const results: Record<string, unknown> = { token: TOKEN, decimals: 6, symbol: 'dds', getItem: { exists: true, listed: true, state: 0, policyId: 1n, activeReservationId: 0n, metadataURI: '' }, quote: [1n, { deposit: 50_000_000n, cancellationFee: 5_000_000n, reservationWindow: 86400n }], balanceOf: 100_000_001n, allowance: 20_000_000n, refundCreditOf: 45_000_000n };
      return results[p.functionName] as never;
    });
    vi.spyOn(publicClient, 'getBalance').mockResolvedValue(10n ** 18n);
    const result = await new PublicChain().snapshot(renter);
    expect(result.decimals).toBe(6); expect(result.balance).toBe(100_000_001n);
    for (const [p] of reads.mock.calls) expect(p.blockNumber).toBe(12n);
    reads.mockImplementation(async p => p.functionName === 'token' ? other as never : p.functionName === 'decimals' ? 6 as never : p.functionName === 'symbol' ? 'dds' as never : { policyId: 1n } as never);
    await expect(new PublicChain().snapshot()).rejects.toThrow('payment token');
  });
});
