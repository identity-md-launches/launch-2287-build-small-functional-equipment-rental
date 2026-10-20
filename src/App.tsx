import { useEffect, useLayoutEffect, useState, useSyncExternalStore, type FormEvent, type ReactNode } from 'react';
import { useConnection } from 'wagmi';
import { PublicChain } from './gateway';
import { walletGateway } from './wallet-config';
import { RentalEngine } from './engine';
import { WalletControl } from './WalletControl';
import { amount, canCancel, itemStateNames, restoreQuote, sameAddress, statusNames, windowText, type Reservation } from './domain';
import { CHAIN_ID, ESCROW, EXPLORER_URL, TOKEN, addressLink, txLink } from './network';

const engine = new RentalEngine(new PublicChain(), walletGateway, {
  getItem: key => localStorage.getItem(key), setItem: (key, value) => localStorage.setItem(key, value),
});
const date = (seconds: bigint) => new Date(Number(seconds) * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
export function App() {
  const account = useConnection();
  const state = useSyncExternalStore(engine.subscribe, engine.getState);
  const { data, accepted, booking, journal, loading, busy, error, message, context, storageError } = state;
  const [lookup, setLookup] = useState('');
  const [hash, setHash] = useState('');
  const [cancelConfirm, setCancelConfirm] = useState(false);
  const [withdrawConfirm, setWithdrawConfirm] = useState(false);
  useLayoutEffect(() => {
    setCancelConfirm(false); setWithdrawConfirm(false); setLookup(''); setHash('');
    void engine.setContext(account.isConnected && account.address ? { address: account.address, chainId: account.chainId ?? 0 } : undefined);
  }, [account.address, account.chainId, account.isConnected]);
  useEffect(() => {
    const onStorage = (e: StorageEvent) => engine.storageChanged(e.key);
    const onVisible = () => { if (document.visibilityState === 'visible' && !engine.getState().busy) void engine.refresh(); };
    window.addEventListener('storage', onStorage); document.addEventListener('visibilitychange', onVisible);
    const timer = window.setInterval(() => { if (!engine.getState().busy) void engine.refresh(); }, 30_000);
    return () => { window.removeEventListener('storage', onStorage); document.removeEventListener('visibilitychange', onVisible); clearInterval(timer); };
  }, []);
  useEffect(() => { setCancelConfirm(false); setWithdrawConfirm(false); }, [booking?.id, booking?.reservation.status, context?.address]);
  const correctChain = !!context && context.chainId === CHAIN_ID;
  const accountMatches = !!context && !!account.address && sameAddress(context.address, account.address) && context.chainId === account.chainId;
  const ready = correctChain && accountMatches && !!data && !loading && !busy && !journal.operation && !storageError;
  const q = data?.quote;
  const item = data?.item;
  const available = item?.exists && item.listed && item.state === 0;
  const token = data?.symbol ?? 'mock tokens';
  const money = (value: bigint) => `${amount(value, data?.decimals ?? 6)} ${token}`;
  const approved = !!q && (data?.allowance ?? 0n) >= q.deposit;
  const sufficient = !!q && (data?.balance ?? 0n) >= q.deposit;
  const cancellable = booking && data && canCancel(booking.reservation, correctChain ? context.address : undefined, data.timestamp);
  const op = journal.operation;
  function find(e: FormEvent) { e.preventDefault(); setCancelConfirm(false); void engine.lookup(lookup.trim()); }
  return <>
    <a className="skip-link" href="#main">Skip to equipment</a>
    <div className="testnet-notice"><span className="testnet-mark" aria-hidden="true">◇</span><strong>Testnet demo</strong><span>Mock tokens only. No real payments.</span></div>
    <header className="site-header page-width">
      <a className="brand" href="#main" aria-label="Fieldkit home"><img src={`${import.meta.env.BASE_URL}favicon.svg`} width="34" height="34" alt="" /><span>Fieldkit</span></a>
      <WalletControl />
    </header>
    <main id="main" className="page-width">
      <div className="page-heading"><div><h1>Equipment rental</h1><p className="muted">Reserve, manage, and collect your refund.</p></div><a className="network-link" href={EXPLORER_URL} target="_blank" rel="noreferrer"><span className="status-dot" />Robinhood Chain Testnet <span aria-hidden="true">↗</span></a></div>
      {context && <section className="account-strip" aria-label="Connected wallet">
        <div><span className="muted small">Connected address</span><a className="address small" href={addressLink(context.address)} target="_blank" rel="noreferrer">{context.address}</a></div>
        <div><span className="muted small">Wallet network</span><span>{correctChain ? 'Robinhood Testnet · 46630' : `Wrong network · ${context.chainId}`}</span></div>
        <div><span className="muted small">Mock token balance</span><strong>{data?.balance !== undefined ? money(data.balance) : 'Not loaded'}</strong></div>
        <div><span className="muted small">Gas balance</span><strong>{data?.nativeBalance !== undefined ? `${amount(data.nativeBalance, 18)} test ETH` : 'Not loaded'}</strong></div>
      </section>}
      {context && !correctChain && <div className="notice warning" role="status">Your wallet is on another network. Switch to Robinhood Chain Testnet with the wallet control above. Transaction actions are disabled.</div>}
      <div className="feedback" aria-live="polite" role="status">{message && <div className="notice info">{message}</div>}</div>
      {(error || storageError) && <div className="notice error" role="alert"><strong>{op ? 'Request not confirmed' : 'Action needs attention'}</strong><p>{storageError ?? error}</p>{!storageError && <button className="button compact" disabled={busy} onClick={() => void (op ? engine.recover() : engine.refresh())}>{busy ? 'Checking…' : op ? 'Check pending request' : 'Retry chain reads'}</button>}</div>}
      {op && <section className="pending-panel" aria-labelledby="pending-title">
        <div className="section-head"><h2 id="pending-title">Pending {op.kind === 'withdraw' ? 'refund withdrawal' : op.kind === 'approve' ? 'approval' : op.kind === 'reserve' ? 'reservation' : 'cancellation'}</h2><span className="status-label">{op.phase === 'prepared' ? busy ? 'Awaiting wallet response' : 'Wallet response unknown' : op.phase === 'uncertain' ? 'Confirmation unknown' : 'Awaiting receipt'}</span></div>
        <p>No success is assumed. This request is saved for this wallet, chain and escrow.</p>
        {op.ref && <dl><DataRow label="Recovery reference"><code className="break-value">{op.ref}</code></DataRow></dl>}
        {op.quote && <p className="small">Accepted policy {op.quote.policyId}: {amount(BigInt(op.quote.deposit), op.quote.decimals)} {token} deposit, {amount(BigInt(op.quote.cancellationFee), op.quote.decimals)} {token} cancellation fee, {windowText(restoreQuote(op.quote).reservationWindow)} window.</p>}
        {op.hash && <p><a className="break-value" href={txLink(op.hash)} target="_blank" rel="noreferrer">View pending transaction ↗</a></p>}
        <div className="button-row"><button className="button" disabled={busy} onClick={() => void engine.recover()}>{busy ? 'Checking confirmation…' : 'Check pending request'}</button>{op.kind === 'reserve' && !op.hash && <button className="button" disabled={busy || !correctChain} onClick={() => void engine.retryReservation()}>Retry same booking reference</button>}</div>
        <form className="recovery-form" onSubmit={e => { e.preventDefault(); void engine.recover(hash.trim()); }}><label htmlFor="recovery-hash">Have the transaction hash in your wallet?</label><div className="input-row"><input id="recovery-hash" value={hash} onChange={e => setHash(e.target.value)} placeholder="0x… full transaction hash" spellCheck={false} autoComplete="off" /><button className="button" disabled={busy || !hash.trim()}>Check hash</button></div></form>
      </section>}
      <section className="rental-panel" aria-labelledby="equipment-title">
        <div className="equipment-details">
          <div className="section-head"><span className="item-number">Item 01</span><span className={`status-label ${available ? 'available' : ''}`}>{loading ? 'Reading chain…' : !data ? 'State unavailable' : !item ? 'Item does not exist' : !item.listed ? `Unlisted · ${itemStateNames[item.state] ?? 'Unknown'}` : itemStateNames[item.state] ?? 'Unknown state'}</span></div>
          <EquipmentArt />
          <h2 id="equipment-title">Equipment · Item 1</h2>
          <p className="muted small">Contract listing · one item in this demo</p>
          {data && item && <div className="metadata"><span className="muted small">Listing metadata · untrusted text</span><p dir="auto">{item.metadataURI || 'No description supplied.'}</p></div>}
          {!data && <p className="muted">{loading ? 'Loading the actual listing and policy from the contract.' : 'The listing cannot be read. Retry chain reads above.'}</p>}
          {item && item.activeReservationId !== 0n && <p className="small">Active reservation: <button className="text-button" onClick={() => { setLookup(item.activeReservationId.toString()); void engine.lookup(item.activeReservationId.toString()); }}>#{item.activeReservationId.toString()}</button></p>}
        </div>
        <div className="booking-controls">
          <div className="section-head"><h2>Reservation terms</h2><span className="muted small">{q ? `Policy ${q.policyId}` : 'On-chain policy'}</span></div>
          <dl className="terms">
            <DataRow label="Deposit"><strong className="deposit">{q ? money(q.deposit) : loading ? 'Loading…' : 'Unavailable'}</strong></DataRow>
            <DataRow label="Cancellation fee"><strong>{q ? money(q.cancellationFee) : 'Not loaded'}</strong></DataRow>
            <DataRow label="Reservation window"><strong>{q ? windowText(q.reservationWindow) : 'Not loaded'}</strong></DataRow>
          </dl>
          <p className="small muted">{q ? `Cancel strictly before expiry for a ${money(q.deposit - q.cancellationFee)} refund credit. At expiry the same fee applies; the booking must be settled on chain.` : 'Amounts and expiry rules appear only after a successful contract read.'}</p>
          <p className="small gas-note"><GasIcon />Test ETH pays gas. Mock tokens pay the deposit.</p>
          {context && q && <label className="accept-control"><input type="checkbox" checked={!!accepted} disabled={!ready || !available} onChange={e => engine.accept(e.target.checked)} /><span>I accept policy {q.policyId.toString()}: the deposit, cancellation fee and expiry rules above.</span></label>}
          {!context ? <div className="connection-hint"><WalletIconLarge /><strong>Connect to reserve</strong><p className="muted small">Use Connect wallet above. Rabby and other browser wallets are supported.</p></div> : <>
            <ol className="action-steps">
              <li><span className="step-number">1</span><div><strong>Approve the deposit</strong><p className="small muted">{data?.allowance !== undefined ? `Current allowance: ${money(data.allowance)}. ${approved ? 'It already covers this deposit.' : 'Approval sets the allowance to this deposit only.'}` : 'Allowance has not been read.'}</p><button className="button action-button" disabled={!ready || !accepted || !available || approved || !sufficient} onClick={() => void engine.execute('approve')}>{approved ? 'Deposit approved' : q ? `Approve ${money(q.deposit)}` : 'Approve deposit'}</button></div></li>
              <li><span className="step-number">2</span><div><strong>Reserve the equipment</strong><p className="small muted">A separate wallet action moves your deposit into escrow.</p><button className="button primary action-button" disabled={!ready || !accepted || !available || !approved || !sufficient} onClick={() => void engine.execute('reserve')}>{busy && op?.kind === 'reserve' ? 'Reservation pending…' : 'Reserve item 1'}<span aria-hidden="true">↗</span></button></div></li>
            </ol>
            {ready && q && !sufficient && <p className="notice warning small">You need {money(q.deposit)} for the deposit. Ask the demo operator for mock tokens.</p>}
            {ready && data?.nativeBalance === 0n && <p className="notice warning small">You also need test ETH for gas.</p>}
          </>}
        </div>
      </section>
      <div className="read-status"><span>{data ? `Read at block ${data.blockNumber}. ${loading ? 'Refreshing…' : 'Refreshes every 30 seconds.'}` : 'Chain data unavailable until RPC reads succeed.'}</span><button className="text-button" disabled={loading || busy} onClick={() => void engine.refresh()}>{loading ? 'Refreshing…' : 'Refresh data'}</button></div>
      {journal.lastTransaction && <div className="receipt-line"><span>{journal.lastTransaction.success ? 'Successful receipt observed' : 'Action not completed'} · {journal.lastTransaction.kind}</span><a href={txLink(journal.lastTransaction.hash)} target="_blank" rel="noreferrer">View receipt ↗</a></div>}
      <div className="manage-grid">
        <section className="manage-section" aria-labelledby="booking-title">
          <div className="section-head"><h2 id="booking-title">Find a reservation</h2><span className="muted small">Read from contract</span></div>
          <form onSubmit={find} className="lookup-form"><label htmlFor="reservation-id">Reservation ID</label><div className="input-row"><input id="reservation-id" value={lookup} onChange={e => setLookup(e.target.value)} inputMode="numeric" autoComplete="off" placeholder="For example, 1" /><button className="button" disabled={busy}>{busy && !op ? 'Checking…' : 'Look up'}</button></div></form>
          <p className="small muted">This browser remembers its last booking and pending request. It is not your complete account history.</p>
          {booking ? <div className="reservation-result" data-testid="reservation-result">
            <div className="section-head"><h3>Reservation #{booking.id.toString()}</h3><span className="status-label">{statusNames[booking.reservation.status] ?? 'Unknown'}</span></div>
            <p className="ownership">{context && sameAddress(context.address, booking.reservation.renter) ? 'You are the renter.' : 'This booking belongs to the renter below.'}</p>
            <a className="address small" href={addressLink(booking.reservation.renter)} target="_blank" rel="noreferrer">{booking.reservation.renter}</a>
            <ReservationTerms reservation={booking.reservation} decimals={data?.decimals} symbol={token} />
            {cancellable && <>{cancelConfirm ? <div className="confirm-action"><p>Cancel reservation #{booking.id.toString()}? The accepted fee is {money(booking.reservation.cancellationFee)}. The remainder becomes a credit.</p><div className="button-row"><button className="button danger" disabled={!ready} onClick={() => { setCancelConfirm(false); void engine.execute('cancel', booking.id); }}>Confirm cancellation</button><button className="button" onClick={() => setCancelConfirm(false)}>Keep reservation</button></div></div> : <button className="button" disabled={!ready} onClick={() => setCancelConfirm(true)}>Cancel reservation</button>}</>}
            {booking.reservation.status === 1 && data && data.timestamp >= booking.reservation.expiresAt && <p className="notice warning small">The reservation window has ended. Renter cancellation is closed. A permissionless expiry settlement on the contract is required to create the credit and release the item; this bounded app does not submit it.</p>}
          </div> : <div className="empty-state"><SearchIcon /><p>No reservation selected.</p><span className="small muted">Enter an ID, or make your first booking above.</span></div>}
        </section>
        <section className="manage-section refund-section" aria-labelledby="refund-title">
          <div className="section-head"><h2 id="refund-title">Refund credit</h2><CreditIcon /></div>
          <div className="credit-value">{data?.credit !== undefined ? money(data.credit) : !context ? 'Connect to view' : !correctChain ? 'Switch network to view' : loading ? 'Reading credit…' : 'Credit unavailable'}</div>
          <p className="muted">Credit stays in escrow until you withdraw it. It has not been returned to your wallet.</p>
          <p className="small muted">Withdrawal collects your entire current credit, including credit from other reservations. The contract determines the total at execution.</p>
          {withdrawConfirm ? <div className="confirm-action"><p>Withdraw all current refund credit? The latest total is checked again before the wallet prompt.</p><div className="button-row"><button className="button primary" disabled={!ready || !data?.credit} onClick={() => { setWithdrawConfirm(false); void engine.execute('withdraw'); }}>Confirm withdrawal</button><button className="button" onClick={() => setWithdrawConfirm(false)}>Go back</button></div></div> : <button className="button" disabled={!ready || !data?.credit} onClick={() => setWithdrawConfirm(true)}>Withdraw refund credit <span aria-hidden="true">↗</span></button>}
        </section>
      </div>
      <details className="contract-details"><summary>About this testnet demo and its contracts</summary><p>Frontend only. No backend, account history service or real payments. Item metadata is shown as text and never opened automatically. No admin, staff, minting or fee collection controls are provided.</p><dl><DataRow label="Chain">Robinhood Chain Testnet · 46630</DataRow><DataRow label="Rental escrow"><a className="address" href={addressLink(ESCROW)} target="_blank" rel="noreferrer">{ESCROW}</a></DataRow><DataRow label="Mock payment token"><a className="address" href={addressLink(TOKEN)} target="_blank" rel="noreferrer">{TOKEN}</a></DataRow></dl><p className="small">One successful receipt is the confirmation threshold in this disposable demo. Network reorganizations remain possible. There is no claim of production readiness.</p></details>
    </main>
    <footer className="page-width"><span>Fieldkit · Equipment rental demo</span><span>Robinhood Chain Testnet · 46630</span></footer>
  </>;
}
function DataRow({ label, children }: { label: string; children: ReactNode }) { return <div className="data-row"><dt>{label}</dt><dd>{children}</dd></div>; }
function ReservationTerms({ reservation: r, decimals, symbol }: { reservation: Reservation; decimals?: number; symbol: string }) {
  const money = (v: bigint) => decimals !== undefined ? `${amount(v, decimals)} ${symbol}` : `${v} base units`;
  return <dl className="saved-terms"><DataRow label="Item / accepted policy">{r.itemId.toString()} / {r.policyId.toString()}</DataRow><DataRow label="Accepted deposit">{money(r.deposit)}</DataRow><DataRow label="Accepted fee">{money(r.cancellationFee)}</DataRow><DataRow label="Accepted window">{windowText(r.expiresAt - r.createdAt)}</DataRow><DataRow label="Created">{date(r.createdAt)}</DataRow><DataRow label="Expires">{date(r.expiresAt)}</DataRow></dl>;
}
function EquipmentArt() { return <div className="equipment-art" aria-hidden="true"><svg viewBox="0 0 440 190" fill="none"><ellipse cx="220" cy="157" rx="140" ry="9" fill="#d9ded0"/><g stroke="#405447" strokeWidth="2" strokeLinejoin="round"><path d="m94 65 188-17 66 34-188 23Z" fill="#e5eadc"/><path d="m94 65 66 40v51l-66-38Z" fill="#a3b49a"/><path d="m160 105 188-23v54l-188 20Z" fill="#c0ceaf"/><path d="m94 79 66 40 188-23M160 119v37M122 70l188-17M207 79l20 10 48-5-21-11z"/><path d="m211 121 34-4v11l-34 4z" fill="#405447"/><path d="m178 106 12-1v17l-12 1zm135-16 12-1v17l-12 1z" fill="#f4f6ed"/><path d="m197 72 1-16 46-4 15 8v16l-10 1V63l-42 4v5" fill="#405447"/></g><path d="M61 159h32m266 0h23" stroke="#b2bca5" strokeWidth="2" strokeLinecap="round"/></svg></div>; }
function GasIcon() { return <svg aria-hidden="true" width="17" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M4 21V3h10v18M2 21h14M7 6h4v5H7zM14 13h3v5a2 2 0 0 0 4 0v-7l-4-5" /></svg>; }
function SearchIcon() { return <svg aria-hidden="true" width="27" height="27" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/></svg>; }
function CreditIcon() { return <svg aria-hidden="true" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M7 15h4"/></svg>; }
function WalletIconLarge() { return <svg aria-hidden="true" width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M20 8V5H5a2 2 0 0 0 0 4h16v11H5a2 2 0 0 1-2-2V7M21 12h-6v5h6"/></svg>; }
