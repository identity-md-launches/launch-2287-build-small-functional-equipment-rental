import type { Hash } from 'viem';
import { CHAIN_ID } from './network';
import { canCancel, errorText, isRejected, randomRef, restoreQuote, sameAddress, sameQuote, storeQuote, type Booking, type ChainGateway, type Context, type Journal, type Kind, type Operation, type Quote, type Snapshot, type Store, type WalletGateway } from './domain';
import { journalKey, readJournal, transactionFor, writeJournal } from './journal';

export type ViewState = {
  context?: Context;
  data?: Snapshot;
  accepted?: Quote;
  booking?: Booking;
  journal: Journal;
  loading: boolean;
  busy: boolean;
  storageError?: string;
  error?: string;
  message: string;
};
const labels = { approve: 'Approval', reserve: 'Reservation', cancel: 'Cancellation', withdraw: 'Refund withdrawal' };
class StaleContext extends Error {}
export class RentalEngine {
  private state: ViewState = { journal: { version: 1 }, loading: true, busy: false, message: '' };
  private listeners = new Set<() => void>();
  private epoch = 0;
  private readSequence = 0;
  private lockedEpoch?: number;
  constructor(private chain: ChainGateway, private wallet: WalletGateway, private store: Store) {}
  subscribe = (callback: () => void) => { this.listeners.add(callback); return () => { this.listeners.delete(callback); }; };
  getState = () => this.state;
  private patch(next: Partial<ViewState>) { this.state = { ...this.state, ...next }; this.listeners.forEach(fn => fn()); }
  private current(c: Context, epoch: number) { return this.epoch === epoch && !!this.state.context && sameAddress(this.state.context.address, c.address) && this.state.context.chainId === c.chainId; }
  private assertCurrent(c: Context, epoch: number) { if (!this.current(c, epoch)) throw new StaleContext('Account or chain changed. Review the action again.'); }
  private async assertWallet(c: Context, epoch: number) {
    this.assertCurrent(c, epoch);
    if (c.chainId !== CHAIN_ID) throw new Error('Switch to Robinhood Chain Testnet before sending a transaction.');
    const actual = await this.wallet.identity();
    this.assertCurrent(c, epoch);
    if (actual.chainId !== CHAIN_ID || !sameAddress(actual.address, c.address)) throw new Error('Wallet account or network changed. Reconnect and review the action again.');
  }
  private save(c: Context, journal: Journal, epoch: number) {
    writeJournal(this.store, c, journal);
    if (this.current(c, epoch)) this.patch({ journal });
  }
  async setContext(context?: Context) {
    const epoch = ++this.epoch;
    let journal: Journal = { version: 1 };
    let storageError: string | undefined;
    if (context?.chainId === CHAIN_ID) {
      try { journal = readJournal(this.store, context); } catch (error) { storageError = errorText(error); }
    }
    this.state = { context, journal, storageError, loading: true, busy: false, message: '' };
    this.listeners.forEach(fn => fn());
    await this.refresh();
    if (context && this.current(context, epoch) && journal.operation && !storageError) await this.recover();
  }
  async refresh() {
    const epoch = this.epoch;
    const sequence = ++this.readSequence;
    const context = this.state.context;
    this.patch({ loading: true, error: undefined });
    try {
      const address = context?.chainId === CHAIN_ID ? context.address : undefined;
      const data = await this.chain.snapshot(address);
      if (epoch !== this.epoch || sequence !== this.readSequence) return;
      const id = this.state.booking?.id ?? (address && this.state.journal.lastReservationId ? BigInt(this.state.journal.lastReservationId) : undefined);
      const booking = id ? { id, reservation: await this.chain.reservation(id) } : undefined;
      if (epoch !== this.epoch || sequence !== this.readSequence) return;
      const changed = this.state.accepted && !sameQuote(this.state.accepted, data.quote);
      this.patch({ data, booking, loading: false, accepted: changed ? undefined : this.state.accepted, ...(changed ? { message: 'The policy changed. Review the new terms and accept them again.' } : {}) });
    } catch (error) {
      if (epoch === this.epoch && sequence === this.readSequence) this.patch({ data: undefined, booking: undefined, loading: false, error: `Could not read the chain. ${errorText(error)}` });
    }
  }
  accept(accepted: boolean) {
    if (this.state.busy || this.state.journal.operation) return;
    this.patch({ accepted: accepted ? this.state.data?.quote : undefined, error: undefined, message: '' });
  }
  async lookup(input: string) {
    const epoch = this.epoch;
    if (!/^[1-9][0-9]*$/.test(input) || input.length > 78 || BigInt(input) >= 2n ** 256n) { this.patch({ error: 'Enter a positive reservation ID in decimal digits.' }); return; }
    await this.run(async () => {
      const id = BigInt(input);
      const reservation = await this.chain.reservation(id);
      if (epoch === this.epoch) this.patch({ booking: { id, reservation }, error: undefined, message: 'Reservation read from the contract. Check the renter address below.' });
    });
  }
  private async run(action: () => Promise<void>, write = false) {
    const epoch = this.epoch;
    if (this.lockedEpoch === epoch) return;
    this.lockedEpoch = epoch;
    this.patch({ busy: true, error: undefined, message: '' });
    try {
      const c = this.state.context;
      if (write && c && typeof navigator !== 'undefined' && navigator.locks) {
        await navigator.locks.request(journalKey(c), { ifAvailable: true }, async lock => {
          if (!lock) throw new Error('Another tab is handling a wallet action. Check that tab before continuing.');
          await action();
        });
      } else await action();
    }
    catch (error) {
      if (epoch === this.epoch && !(error instanceof StaleContext)) this.patch({
        error: isRejected(error) && this.state.journal.operation
          ? 'Request rejected while a transaction outcome is uncertain. The saved request has been retained; check its receipt before retrying.'
          : errorText(error),
        message: '',
      });
    }
    finally { if (this.lockedEpoch === epoch) this.lockedEpoch = undefined; if (epoch === this.epoch) this.patch({ busy: false }); }
  }
  private requireContext() {
    const c = this.state.context;
    if (!c) throw new Error('Connect your wallet first.');
    if (c.chainId !== CHAIN_ID) throw new Error('Switch to Robinhood Chain Testnet first.');
    if (this.state.storageError) throw new Error(this.state.storageError);
    return c;
  }
  private checkBooking(data: Snapshot, accepted: Quote, retry = false) {
    if (!sameQuote(accepted, data.quote)) {
      this.patch({ data, accepted: undefined });
      throw new Error(retry
        ? 'The policy changed. This retry was not sent; the earlier booking may still be pending. The saved request has been retained. Check pending request.'
        : 'The policy changed. Review the new deposit, fee and expiry, then accept again. No transaction was requested.');
    }
    if (!data.item?.exists || !data.item.listed || data.item.state !== 0) throw new Error('Item 1 is no longer available for reservation. Refresh its current state.');
    if ((data.balance ?? 0n) < accepted.deposit) throw new Error('Insufficient mock tokens for this deposit. Ask the demo operator for test tokens.');
  }
  async execute(kind: Kind, reservationId?: bigint) {
    // A synchronous lock stops double clicks before React has rerendered.
    await this.run(async () => {
      const c = this.requireContext();
      const epoch = this.epoch;
      const stored = readJournal(this.store, c);
      if (stored.operation || this.state.journal.operation) throw new Error('An earlier request is unresolved. Check that request before starting another action.');
      const accepted = this.state.accepted;
      await this.assertWallet(c, epoch);
      const data = await this.chain.snapshot(c.address);
      this.assertCurrent(c, epoch);
      this.patch({ data });
      let quote;
      if (kind === 'approve' || kind === 'reserve') {
        if (!accepted) throw new Error('Review and accept the current policy before approval or reservation.');
        this.checkBooking(data, accepted);
        quote = storeQuote(accepted);
        if (kind === 'approve' && (data.allowance ?? 0n) >= accepted.deposit) { this.patch({ message: 'Your current allowance already covers this deposit. Reserve in a separate wallet action.' }); return; }
        if (kind === 'reserve' && (data.allowance ?? 0n) < accepted.deposit) throw new Error('Approve the exact deposit first, then reserve in a separate wallet action.');
      }
      if (kind === 'cancel') {
        if (!reservationId) throw new Error('Look up a reservation first.');
        const r = await this.chain.reservation(reservationId);
        this.assertCurrent(c, epoch);
        this.patch({ booking: { id: reservationId, reservation: r } });
        if (!canCancel(r, c.address, data.timestamp)) throw new Error('Only the renter can cancel a Reserved booking strictly before its expiry. The latest state does not permit cancellation.');
      }
      if (kind === 'withdraw' && (data.credit ?? 0n) === 0n) throw new Error('There is no refund credit to withdraw. The current credit was checked on chain.');
      if ((data.nativeBalance ?? 0n) === 0n) throw new Error('You need test ETH for gas. Mock tokens pay the deposit; they cannot pay gas.');
      const fields = { kind, quote, ref: kind === 'reserve' ? randomRef() : undefined, reservationId: reservationId?.toString() };
      const op: Operation = { ...fields, ...transactionFor(fields), phase: 'prepared', block: data.blockNumber.toString(), startedAt: Date.now() };
      await this.chain.simulate(c.address, op);
      await this.assertWallet(c, epoch);
      // Check again after asynchronous preflight; another tab may have saved a request.
      if (readJournal(this.store, c).operation) throw new Error('Another tab has an unresolved request. Check it before continuing.');
      this.save(c, { ...stored, operation: op }, epoch);
      await this.send(c, op, epoch, 'first');
    }, true);
  }
  private async send(c: Context, op: Operation, epoch: number, attempt: 'first' | 'retry') {
    let returnedHash = op.hash;
    // A retry rejection says nothing about an earlier send, even a saved prepared send.
    const canClearRejection = attempt === 'first' && op.phase === 'prepared' && !op.hash && !op.originalHash;
    if (this.current(c, epoch)) this.patch({ message: `${labels[op.kind]}: confirm this action in your wallet.` });
    try {
      const hash = await this.wallet.send(c, op);
      returnedHash = hash;
      const submitted: Operation = { ...op, ...(attempt === 'retry' ? { priorUncertainty: true } : {}), hash, originalHash: op.originalHash ?? hash, phase: 'submitted' };
      // Preserve a returned hash in the visible state even if storage subsequently fails.
      if (this.current(c, epoch)) this.patch({ journal: { ...this.state.journal, operation: submitted } });
      this.save(c, { ...readJournal(this.store, c), operation: submitted }, epoch);
      if (this.current(c, epoch)) await this.settle(c, submitted, epoch);
    } catch (error) {
      if (isRejected(error) && !returnedHash && canClearRejection) {
        this.save(c, { ...readJournal(this.store, c), operation: undefined }, epoch);
      } else {
        const latest = this.current(c, epoch) ? this.state.journal.operation ?? op : readJournal(this.store, c).operation ?? op;
        const uncertain: Operation = { ...latest, phase: 'uncertain' };
        if (this.current(c, epoch)) this.patch({ journal: { ...this.state.journal, operation: uncertain } });
        this.save(c, { ...readJournal(this.store, c), operation: uncertain }, epoch);
      }
      if (attempt === 'retry' && isRejected(error)) throw new Error('Retry rejected in your wallet. The earlier booking may still be pending. The saved request has been retained. Check pending request.');
      throw error;
    }
  }
  private async settle(c: Context, op: Operation, epoch: number, manualHash = false) {
    this.assertCurrent(c, epoch);
    this.patch({ message: `${labels[op.kind]} submitted. Waiting for a successful receipt; this is not confirmed yet.` });
    const receipt = await this.chain.wait(c.address, op, hash => {
      op = { ...op, hash, phase: 'submitted' };
      this.save(c, { ...readJournal(this.store, c), operation: op }, epoch);
      if (this.current(c, epoch)) this.patch({ message: 'A replacement transaction was detected. Checking its receipt and exact action.' });
    });
    if (!receipt.matches && manualHash) throw new Error('That transaction does not match this saved request. The pending request has been retained.');
    let journal = readJournal(this.store, c);
    if (!receipt.success || !receipt.matches) {
      // A failed retry receipt cannot resolve the earlier hashless attempt either.
      if (op.priorUncertainty) throw new Error('This retry did not confirm the booking. The earlier booking may still be pending. The saved request and known hashes have been retained. Check pending request.');
      if (op.kind === 'reserve' && op.ref && await this.chain.byRef(c.address, op.ref) !== 0n) throw new Error('This receipt did not confirm the booking, but the reference exists on chain. Keep the request and check the creation transaction in your wallet.');
      journal = { ...journal, operation: undefined, lastTransaction: { kind: op.kind, hash: receipt.hash, success: false } };
      this.save(c, journal, epoch);
      if (this.current(c, epoch)) {
        await this.refresh();
        if (this.current(c, epoch)) this.patch({ message: '', error: receipt.matches ? 'Transaction reverted. The requested action did not complete. Gas may have been spent.' : 'The transaction was replaced with a different action. This rental action was not confirmed.' });
      }
      return;
    }
    let booking: Booking | undefined;
    if (op.kind === 'reserve' && op.ref) {
      const id = await this.chain.byRef(c.address, op.ref);
      if (id === 0n) throw new Error('A successful receipt was found, but its booking is not readable yet. Keep this request and check again.');
      const reservation = await this.chain.reservation(id);
      const q = op.quote && restoreQuote(op.quote);
      if (!q || !sameAddress(reservation.renter, c.address) || reservation.clientRef.toLowerCase() !== op.ref.toLowerCase() || reservation.policyId !== q.policyId || reservation.deposit !== q.deposit || reservation.cancellationFee !== q.cancellationFee || reservation.expiresAt - reservation.createdAt !== q.reservationWindow) throw new Error('The booking does not match the accepted request. Keep the recovery reference and check the contract.');
      booking = { id, reservation };
      journal = { ...journal, lastReservationId: id.toString() };
    }
    journal = { ...journal, operation: undefined, lastTransaction: { kind: op.kind, hash: receipt.hash, success: true } };
    this.save(c, journal, epoch);
    if (this.current(c, epoch)) {
      if (booking) this.patch({ booking, accepted: undefined });
      await this.refresh();
      if (!this.current(c, epoch)) return;
      const baseMessage = op.kind === 'cancel' ? 'Cancellation confirmed. Check your refund credit in escrow, then withdraw it separately to receive tokens in your wallet.' : op.kind === 'withdraw' ? 'Refund withdrawal confirmed by a successful receipt.' : op.kind === 'approve' ? 'Approval confirmed. Reserve with a separate wallet action.' : 'Reservation confirmed. Its accepted terms were read from getReservation.';
      const message = this.state.data ? baseMessage + (op.kind === 'withdraw' ? ' Balances have been refreshed.' : '') : `${baseMessage} The latest balances and state could not be refreshed. Retry chain reads.`;
      this.patch({ message });
    }
  }
  async recover(manualHash?: string) {
    await this.run(async () => {
      const c = this.requireContext();
      const epoch = this.epoch;
      const journal = this.state.journal;
      let op = journal.operation;
      if (!op) { await this.refresh(); return; }
      if (manualHash && !/^0x[0-9a-fA-F]{64}$/.test(manualHash)) throw new Error('Enter the full transaction hash from your wallet, starting with 0x.');
      if (op.kind === 'reserve' && op.ref) {
        const id = await this.chain.byRef(c.address, op.ref);
        this.assertCurrent(c, epoch);
        if (id !== 0n) {
          const reservation = await this.chain.reservation(id);
          this.assertCurrent(c, epoch);
          this.patch({ booking: { id, reservation } });
          if ((!op.hash || op.priorUncertainty) && !manualHash) {
            const hash = await this.chain.findReservationHash(id, c.address, BigInt(op.block));
            this.assertCurrent(c, epoch);
            if (hash) { op = { ...op, hash }; this.save(c, { ...journal, operation: op }, epoch); }
          }
        }
      }
      if (manualHash) op = { ...op, hash: manualHash as Hash };
      if (!op.hash) throw new Error('No transaction hash is known. The reference was checked on chain. Check your wallet activity, paste the hash below, or retry the same booking reference if offered. No new reference will be generated.');
      await this.settle(c, op, epoch, !!manualHash);
    }, true);
  }
  async retryReservation() {
    await this.run(async () => {
      const c = this.requireContext();
      const epoch = this.epoch;
      const op = this.state.journal.operation;
      if (!op || op.kind !== 'reserve' || !op.ref || !op.quote) throw new Error('There is no saved booking request to retry.');
      await this.assertWallet(c, epoch);
      const existing = await this.chain.byRef(c.address, op.ref);
      this.assertCurrent(c, epoch);
      if (existing !== 0n || op.hash) throw new Error('A transaction or booking already exists for this request. Use Check pending request; a new payment will not be sent.');
      const fresh = await this.chain.snapshot(c.address);
      this.assertCurrent(c, epoch);
      this.checkBooking(fresh, restoreQuote(op.quote), true);
      if ((fresh.allowance ?? 0n) < BigInt(op.quote.deposit)) throw new Error('The saved booking no longer has enough allowance. Resolve the wallet transaction before starting another action.');
      if ((fresh.nativeBalance ?? 0n) === 0n) throw new Error('You need test ETH to pay gas.');
      await this.chain.simulate(c.address, op);
      await this.assertWallet(c, epoch);
      // Reuse the exact calldata and nonzero reference. The contract prevents a second deposit.
      await this.send(c, op, epoch, 'retry');
    }, true);
  }
  storageChanged(key: string | null) {
    const c = this.state.context;
    if (!c || key !== journalKey(c) || this.state.busy) return;
    void this.setContext(c);
  }
}
