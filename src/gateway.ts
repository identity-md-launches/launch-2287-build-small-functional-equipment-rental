import { BaseError, ContractFunctionRevertedError, createPublicClient, http, type Abi, type Address, type Hash, type Hex } from 'viem';
import escrowJson from './abi/RentalEscrow.json';
import tokenJson from './abi/MockPaymentToken.json';
import { CHAIN_ID, ESCROW, ITEM_ID, RPC_URL, TOKEN, chain } from './network';
import { sameAddress, type ChainGateway, type Item, type Operation, type Reservation, type Snapshot } from './domain';

export const escrowAbi = escrowJson as Abi;
export const tokenAbi = tokenJson as Abi;
export const publicClient = createPublicClient({
  chain,
  transport: http(RPC_URL, { timeout: 12_000, retryCount: 1, batch: true }),
  pollingInterval: 2_000,
  cacheTime: 0,
});
function missingItem(error: unknown) {
  if (!(error instanceof BaseError)) return false;
  const revert = error.walk(e => e instanceof ContractFunctionRevertedError);
  return revert instanceof ContractFunctionRevertedError && revert.data?.errorName === 'ItemNotFound';
}
export class PublicChain implements ChainGateway {
  async snapshot(address?: Address): Promise<Snapshot> {
    const [id, block] = await Promise.all([publicClient.getChainId(), publicClient.getBlock()]);
    if (id !== CHAIN_ID) throw new Error('The public RPC returned the wrong chain. Writes are disabled.');
    const read = (target: Address, abi: Abi, functionName: string, args: unknown[] = []) => publicClient.readContract({ address: target, abi, functionName, args, blockNumber: block.number });
    const [paymentToken, decimals, symbol, item] = await Promise.all([
      read(ESCROW, escrowAbi, 'token') as Promise<Address>,
      read(TOKEN, tokenAbi, 'decimals') as Promise<number>,
      read(TOKEN, tokenAbi, 'symbol') as Promise<string>,
      (read(ESCROW, escrowAbi, 'getItem', [ITEM_ID]) as Promise<Item>).catch(error => {
        if (missingItem(error)) return undefined;
        throw error;
      }),
    ]);
    if (!sameAddress(paymentToken, TOKEN)) throw new Error('The escrow payment token does not match this deployment. Writes are disabled.');
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) throw new Error('Invalid payment token decimals.');
    const quote = item ? await read(ESCROW, escrowAbi, 'quote', [ITEM_ID]) as [bigint, { deposit: bigint; cancellationFee: bigint; reservationWindow: bigint }] : undefined;
    if (quote && item?.policyId !== quote[0]) throw new Error('Inconsistent item policy. Refresh to read again.');
    const wallet = address ? await Promise.all([
      read(TOKEN, tokenAbi, 'balanceOf', [address]) as Promise<bigint>,
      read(TOKEN, tokenAbi, 'allowance', [address, ESCROW]) as Promise<bigint>,
      read(ESCROW, escrowAbi, 'refundCreditOf', [address]) as Promise<bigint>,
      publicClient.getBalance({ address, blockNumber: block.number }),
    ]) : undefined;
    return {
      item, quote: quote ? { policyId: quote[0], ...quote[1], decimals } : undefined,
      decimals, symbol, balance: wallet?.[0], allowance: wallet?.[1], credit: wallet?.[2], nativeBalance: wallet?.[3],
      blockNumber: block.number, timestamp: block.timestamp, fetchedAt: Date.now(),
    };
  }
  async reservation(id: bigint): Promise<Reservation> {
    return await publicClient.readContract({ address: ESCROW, abi: escrowAbi, functionName: 'getReservation', args: [id] }) as Reservation;
  }
  async byRef(address: Address, ref: Hex): Promise<bigint> {
    return await publicClient.readContract({ address: ESCROW, abi: escrowAbi, functionName: 'reservationByRef', args: [address, ref] }) as bigint;
  }
  async findReservationHash(id: bigint, address: Address, fromBlock: bigint) {
    const latest = await publicClient.getBlockNumber();
    // Bounded event search for a lost wallet response. This is recovery, not account history.
    const end = latest < fromBlock + 39_999n ? latest : fromBlock + 39_999n;
    for (let start = fromBlock; start <= end; start += 2_000n) {
      const toBlock = start + 1_999n < end ? start + 1_999n : end;
      const events = await publicClient.getContractEvents({ address: ESCROW, abi: escrowAbi, eventName: 'ReservationCreated', args: { reservationId: id, renter: address }, fromBlock: start, toBlock });
      if (events[0]?.transactionHash) return events[0].transactionHash;
    }
    return undefined;
  }
  async simulate(address: Address, op: Operation) {
    await publicClient.call({ account: address, to: op.to, data: op.data, value: 0n });
    await publicClient.estimateGas({ account: address, to: op.to, data: op.data, value: 0n });
  }
  async wait(address: Address, op: Operation, onReplacement: (hash: Hash) => void) {
    if (!op.hash) throw new Error('No transaction hash is known. Check your wallet activity before retrying.');
    const receipt = await publicClient.waitForTransactionReceipt({
      hash: op.hash, confirmations: 1, timeout: 30_000,
      onReplaced: replacement => onReplacement(replacement.transactionReceipt.transactionHash),
    });
    const transaction = await publicClient.getTransaction({ hash: receipt.transactionHash });
    // An older identical withdrawal/approval is not evidence for this pending request.
    const matches = receipt.blockNumber > BigInt(op.block) && sameAddress(transaction.from, address) && !!transaction.to && sameAddress(transaction.to, op.to) && transaction.input.toLowerCase() === op.data.toLowerCase() && transaction.value === 0n;
    return { hash: receipt.transactionHash, success: receipt.status === 'success', matches };
  }
}
