import { useEffect, useRef, useState } from 'react';
import { useConnection, useConnect, useDisconnect, useSwitchChain, type Connector } from 'wagmi';
import { CHAIN_ID, chain } from './network';
import { errorText } from './domain';

export const shortAddress = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const asset = (name: string) => `${import.meta.env.BASE_URL}wallets/${name}.svg`;
const openIn = [
  { id: 'metamask', name: 'MetaMask', href: (u: string) => `https://link.metamask.io/dapp/${u.replace(/^https?:\/\//, '')}` },
  { id: 'coinbase', name: 'Coinbase Wallet', href: (u: string) => `https://go.cb-w.com/dapp?cb_url=${encodeURIComponent(u)}` },
  { id: 'rabby', name: 'Rabby', href: (u: string) => `https://go.rabby.io/mobile/?_cmd=open-dapp&dapp=${encodeURIComponent(u)}` },
  { id: 'phantom', name: 'Phantom', href: (u: string) => `https://phantom.app/ul/browse/${encodeURIComponent(u)}?ref=${encodeURIComponent(new URL(u).origin)}` },
];
export function WalletControl() {
  const { address, isConnected, chainId } = useConnection();
  const { connectors, connectAsync, isPending, variables } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChainAsync, isPending: switching } = useSwitchChain();
  const [error, setError] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const hasNamed = connectors.some(c => c.type === 'injected' && c.id !== 'injected');
  const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) && !hasNamed && !(window as Window & { ethereum?: unknown }).ethereum;
  const listed = [...connectors.filter(c => c.type === 'injected'), ...connectors.filter(c => c.type !== 'injected')].filter(c => !(c.id === 'injected' && hasNamed) && (!mobile || c.type !== 'injected'));
  const label = (c: Connector) => c.id === 'injected' ? 'Browser wallet' : c.id === 'coinbaseWalletSDK' ? mobile ? 'Coinbase Smart Wallet' : 'Coinbase Wallet' : c.name;
  useEffect(() => { if (isConnected) dialog.current?.close(); }, [isConnected]);
  async function connect(c: Connector) {
    setError('');
    try { await connectAsync({ connector: c }); dialog.current?.close(); }
    catch (e) { setError(errorText(e)); }
  }
  return <div className="wallet-control">
    {isConnected && address ? <>
      {chainId !== CHAIN_ID ? <button className="button primary" disabled={switching} onClick={async () => {
        setError('');
        try { await switchChainAsync({ chainId: CHAIN_ID, addEthereumChainParameter: { chainName: chain.name, nativeCurrency: chain.nativeCurrency, rpcUrls: [chain.rpcUrls.default.http[0]], blockExplorerUrls: [chain.blockExplorers.default.url] } }); }
        catch (e) { setError(errorText(e)); }
      }}>{switching ? 'Switching network…' : 'Switch to Robinhood Chain Testnet'}</button> : <span className="wallet-address" title={address}>{shortAddress(address)}</span>}
      <button className="button compact" onClick={() => disconnect()}>Disconnect</button>
    </> : <button className="button primary connect" onClick={() => { setError(''); dialog.current?.showModal(); }}><WalletIcon />Connect wallet</button>}
    {error && isConnected && <p className="wallet-error" role="status">{error}</p>}
    <dialog ref={dialog} className="wallet-sheet" aria-labelledby="wallet-title" onClick={event => { if (event.target === event.currentTarget) dialog.current?.close(); }}>
      <div className="sheet-inner">
        <div className="section-head"><h2 id="wallet-title">Connect a wallet</h2><button className="icon-button" aria-label="Close wallet picker" onClick={() => dialog.current?.close()}>×</button></div>
        <p className="muted">Testnet only. Connecting does not move tokens.</p>
        {mobile && openIn.map(w => <a className="wallet-row" key={w.id} href={w.href(location.href)}><img width="28" height="28" src={asset(w.id)} alt="" /><span>Open in {w.name}</span><span aria-hidden="true">↗</span></a>)}
        {listed.map(c => <button className="wallet-row" key={c.uid} disabled={isPending} onClick={() => void connect(c)}>
          {c.icon ? <img width="28" height="28" src={c.icon} alt="" /> : c.id === 'coinbaseWalletSDK' ? <img width="28" height="28" src={asset('coinbase')} alt="" /> : <WalletIcon />}
          <span>{label(c)}{isPending && variables?.connector === c ? ' · opening…' : ''}</span><span aria-hidden="true">↗</span>
        </button>)}
        <p className="muted small">Rabby and other browser wallets appear by name when installed. On a phone, open this page inside your wallet’s browser.</p>
        {error && <p className="notice error" role="status">{error}</p>}
      </div>
    </dialog>
  </div>;
}
function WalletIcon() {
  return <svg aria-hidden="true" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M20 8V5H5a2 2 0 0 0 0 4h16v11H5a2 2 0 0 1-2-2V7" /><path d="M21 12h-6v5h6M17 14.5h1" /></svg>;
}
