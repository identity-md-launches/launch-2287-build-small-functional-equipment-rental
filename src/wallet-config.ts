import { createConfig, http } from 'wagmi';
import { coinbaseWallet, injected } from 'wagmi/connectors';
import { getWalletClient } from 'wagmi/actions';
import type { WalletGateway } from './domain';
import { sameAddress } from './domain';
import { CHAIN_ID, RPC_URL, chain } from './network';

export const config = createConfig({
  chains: [chain],
  multiInjectedProviderDiscovery: true,
  connectors: [injected(), coinbaseWallet({ appName: 'Fieldkit', preference: { options: 'all' } })],
  transports: { [CHAIN_ID]: http(RPC_URL, { timeout: 12_000, retryCount: 1 }) },
});
export const walletGateway: WalletGateway = {
  async identity() {
    const wallet = await getWalletClient(config);
    const [accounts, chainId] = await Promise.all([
      wallet.request({ method: 'eth_accounts' }),
      wallet.request({ method: 'eth_chainId' }),
    ]);
    if (!accounts[0]) throw new Error('Your wallet is disconnected. Connect again.');
    return { address: accounts[0], chainId: Number(BigInt(chainId)) };
  },
  async send(context, op) {
    const wallet = await getWalletClient(config);
    const [accounts, chainId] = await Promise.all([
      wallet.request({ method: 'eth_accounts' }), wallet.request({ method: 'eth_chainId' }),
    ]);
    if (!accounts[0] || !sameAddress(accounts[0], context.address) || Number(BigInt(chainId)) !== CHAIN_ID) throw new Error('Wallet account or network changed. Reconnect and review the action again.');
    return wallet.sendTransaction({ account: context.address, chain, to: op.to, data: op.data, value: 0n });
  },
};
