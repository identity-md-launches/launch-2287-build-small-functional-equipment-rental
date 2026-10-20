import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { decodeFunctionData } from 'viem';
import { createLedger, injectWallet, RPC, RENTER, OTHER, ESCROW } from './mock-chain.mjs';

const moduleName = process.env.IMD_PLAYWRIGHT;
const { chromium } = await import(moduleName ? pathToFileURL(moduleName).href : 'playwright');
const root = resolve('dist');
const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/^\/preview\//, '');
    const file = resolve(root, path || 'index.html');
    if (!file.startsWith(root + '/')) throw new Error('outside static root');
    res.writeHead(200, { 'content-type': mime[extname(file)] ?? 'application/octet-stream' }); res.end(await readFile(file));
  } catch { res.writeHead(404); res.end('Not found'); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;
const url = `${origin}/preview/`;
const browser = await chromium.launch({ headless: true });
const results = [];
const screenshots = 'test/scratch/browser';
await mkdir(screenshots, { recursive: true });
const errors = [];
async function setup(ledger = createLedger(), width = 390, injected = true) {
  const context = await browser.newContext({ viewport: { width, height: 844 }, ...(injected ? {} : { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1', isMobile: true, hasTouch: true }) });
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message));
  await page.exposeFunction('mockWalletRequest', async args => {
    try { return { result: await ledger.wallet(args) }; } catch (error) { return { error: { code: error.code ?? -32000, message: error.message, data: error.data } }; }
  });
  if (injected) await page.addInitScript(injectWallet);
  await page.route('**/*', async route => {
    const request = route.request();
    if (request.url() === RPC || request.url() === RPC + '/') {
      if (ledger.rpcOffline) return route.fulfill({ status: 503, body: 'RPC unavailable in this mocked scenario' });
      const batch = request.postDataJSON();
      const run = async q => {
        try { return { jsonrpc: '2.0', id: q.id, result: await ledger.rpc(q) }; }
        catch (error) { return { jsonrpc: '2.0', id: q.id, error: { code: error.code ?? -32000, message: error.message ?? 'Mock failure', data: error.data } }; }
      };
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(Array.isArray(batch) ? await Promise.all(batch.map(run)) : await run(batch)) });
    }
    if (!request.url().startsWith(origin) && !request.url().startsWith('data:')) return route.abort();
    return route.continue();
  });
  await page.goto(url);
  await page.getByText('ipfs://rental-trial/cordless-drill', { exact: true }).waitFor();
  return { page, context, ledger };
}
async function visible(page, text) { await page.getByText(text, { exact: true }).waitFor({ timeout: 12_000 }); }
async function connect(page) {
  await page.getByRole('button', { name: 'Connect wallet', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: 'Browser wallet', exact: true }).count(), 0, 'Generic injected row is hidden when Rabby announces itself');
  await page.getByRole('button', { name: 'Rabby', exact: true }).click();
  await page.getByText('100 dds', { exact: true }).waitFor();
}
async function accept(page) { await page.getByRole('checkbox').check(); }
async function approve(page) {
  await accept(page); await page.getByRole('button', { name: 'Approve 50 dds', exact: true }).click();
  await visible(page, 'Approval confirmed. Reserve with a separate wallet action.');
}
async function checkOverflow(page, width) {
  await page.setViewportSize({ width, height: 844 });
  const overflow = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth, elements: [...document.querySelectorAll('main *')].filter(el => el.getBoundingClientRect().right > innerWidth + 1).slice(0, 6).map(el => ({ tag: el.tagName, className: el.className, right: el.getBoundingClientRect().right })) }));
  if (overflow.scroll > width) await page.screenshot({ path: `${screenshots}/overflow-${width}.png`, fullPage: true });
  assert.equal(overflow.scroll <= width, true, `No horizontal overflow at ${width}: ${JSON.stringify(overflow)}`);
}
async function checkButtonContrast(locator) {
  const ratio = await locator.evaluate(el => {
    const style = getComputedStyle(el);
    const luminance = color => {
      const [r, g, b] = color.match(/[\d.]+/g).slice(0, 3).map(Number).map(c => { c /= 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; });
      return .2126 * r + .7152 * g + .0722 * b;
    };
    const a = luminance(style.color), b = luminance(style.backgroundColor);
    return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
  });
  assert(ratio >= 4.5, `Button text contrast ${ratio.toFixed(2)}:1 must meet 4.5:1`);
}
try {
  {
    const { page, context, ledger } = await setup();
    assert.equal(await page.title(), 'Fieldkit · Testnet equipment rental');
    const bounds = await page.getByRole('button', { name: 'Connect wallet', exact: true }).boundingBox();
    assert(bounds.y + bounds.height < 844, 'Primary connect action is on the first 390px screen');
    await page.getByRole('button', { name: 'Connect wallet', exact: true }).focus();
    await page.keyboard.press('Enter');
    await page.getByRole('dialog', { name: 'Connect a wallet' }).waitFor();
    await page.keyboard.press('Tab');
    assert(await page.evaluate(() => !!document.activeElement.closest('dialog')), 'Modal focus stays inside the native dialog');
    await page.keyboard.press('Escape');
    assert(await page.getByRole('button', { name: 'Connect wallet', exact: true }).evaluate(el => document.activeElement === el), 'Escape restores focus to the connect trigger');
    await checkOverflow(page, 320); await checkOverflow(page, 390); await checkOverflow(page, 1440); await checkOverflow(page, 390);
    await page.screenshot({ path: `${screenshots}/390-disconnected.png`, fullPage: true });
    await connect(page); await approve(page);
    const tokenAbi = JSON.parse(await readFile('src/abi/MockPaymentToken.json', 'utf8'));
    const approvalArgs = decodeFunctionData({ abi: tokenAbi, data: ledger.broadcasts[0].input }).args;
    assert.equal(approvalArgs[0].toLowerCase(), ESCROW); assert.equal(approvalArgs[1], 50_000_000n);
    ledger.holdReceipts = true;
    await page.getByRole('button', { name: 'Reserve item 1', exact: true }).click();
    await page.getByText('Awaiting receipt', { exact: true }).waitFor();
    assert(await page.getByRole('button', { name: 'Reservation pending…', exact: true }).isDisabled());
    assert.equal(ledger.broadcasts.length, 2);
    const saved = await page.evaluate(() => Object.entries(localStorage).find(([k]) => k.startsWith('fieldkit:v1:'))?.[1]);
    assert(saved && JSON.parse(saved).operation.ref !== `0x${'00'.repeat(32)}`);
    await page.reload(); await page.getByText('Pending reservation', { exact: true }).waitFor();
    assert.equal(ledger.broadcasts.length, 2, 'Reload never resubmits the reservation');
    ledger.holdReceipts = false; ledger.block += 1n;
    await visible(page, 'Reservation confirmed. Its accepted terms were read from getReservation.');
    await visible(page, 'Reservation #7');
    assert.equal(ledger.broadcasts.length, 2);
    assert.equal(ledger.balances.get(RENTER), 50_000_000n);
    await page.reload(); await visible(page, 'Reservation #7');
    assert.equal(ledger.broadcasts.length, 2);
    await page.getByLabel('Reservation ID', { exact: true }).fill('8'); await page.getByRole('button', { name: 'Look up', exact: true }).click();
    await visible(page, 'This booking belongs to the renter below.');
    assert.equal(await page.getByRole('button', { name: 'Cancel reservation', exact: true }).count(), 0);
    await page.getByLabel('Reservation ID', { exact: true }).fill('7'); await page.getByRole('button', { name: 'Look up', exact: true }).click(); await visible(page, 'You are the renter.');
    ledger.policyId = 2n; ledger.item.policyId = 2n; ledger.policy.deposit = 60_000_000n;
    await page.getByRole('button', { name: 'Refresh data', exact: true }).click();
    await visible(page, '60 dds');
    assert.match(await page.getByTestId('reservation-result').innerText(), /Accepted deposit\s+50 dds/);
    await page.getByRole('button', { name: 'Cancel reservation', exact: true }).click();
    const cancellationButton = page.getByRole('button', { name: 'Confirm cancellation', exact: true });
    await cancellationButton.hover(); await checkButtonContrast(cancellationButton); await cancellationButton.click();
    await visible(page, 'Cancellation confirmed. Check your refund credit in escrow, then withdraw it separately to receive tokens in your wallet.');
    assert.equal(ledger.credits.get(RENTER), 45_000_000n); assert.equal(ledger.balances.get(RENTER), 50_000_000n);
    await page.getByRole('button', { name: 'Withdraw refund credit', exact: false }).click();
    await page.getByRole('button', { name: 'Confirm withdrawal', exact: true }).click();
    await visible(page, 'Refund withdrawal confirmed by a successful receipt. Balances have been refreshed.');
    assert.equal(ledger.credits.get(RENTER), 0n); assert.equal(ledger.balances.get(RENTER), 95_000_000n);
    await page.screenshot({ path: `${screenshots}/390-complete.png`, fullPage: true });
    await checkOverflow(page, 320); await checkOverflow(page, 1440);
    await page.screenshot({ path: `${screenshots}/1440-complete.png`, fullPage: true });
    ledger.walletChain = 1; ledger.unknownNetwork = true; await page.evaluate(() => window.ethereum.emit('chainChanged', '0x1'));
    await page.getByText('Wrong network · 1', { exact: true }).waitFor();
    assert.equal(await page.getByText('95 dds', { exact: true }).count(), 0);
    await page.getByRole('button', { name: 'Switch to Robinhood Chain Testnet', exact: true }).click();
    await page.getByText('Robinhood Testnet · 46630', { exact: true }).waitFor();
    assert.equal(ledger.addedNetwork, true, 'Unknown chain uses wallet_addEthereumChain');
    ledger.walletAddress = OTHER; await page.evaluate(a => window.ethereum.emit('accountsChanged', [a]), OTHER);
    await page.getByText('12 dds', { exact: true }).waitFor();
    assert.equal(await page.getByText('Reservation #7', { exact: true }).count(), 0);
    assert.equal(await page.getByText('Successful receipt observed · withdraw', { exact: true }).count(), 0);
    assert.equal(ledger.broadcasts.length, 4);
    results.push({ scenario: 'Complete journey, exact approval, pending reload, booking recovery, foreign lookup, snapshot policy, cancel credit, aggregate withdrawal, chain switch and account clearing', passed: true });
    await context.close();
  }
  {
    const { page, context, ledger } = await setup(); await connect(page); await accept(page);
    ledger.rejectNext = true; await page.getByRole('button', { name: 'Approve 50 dds', exact: true }).click();
    await visible(page, 'Request rejected in your wallet. No new transaction hash was returned.');
    assert.equal(ledger.broadcasts.length, 0);
    ledger.revertNext = true; await page.getByRole('button', { name: 'Approve 50 dds', exact: true }).click();
    await visible(page, 'Transaction reverted. The requested action did not complete. Gas may have been spent.');
    assert.equal(ledger.allowances.get(RENTER) ?? 0n, 0n);
    await page.getByRole('button', { name: 'Approve 50 dds', exact: true }).click();
    await visible(page, 'Approval confirmed. Reserve with a separate wallet action.');
    ledger.policyId = 2n; ledger.item.policyId = 2n; ledger.policy.deposit = 60_000_000n;
    await page.getByRole('button', { name: 'Reserve item 1', exact: true }).click();
    await visible(page, 'The policy changed. Review the new deposit, fee and expiry, then accept again. No transaction was requested.');
    assert.equal(ledger.broadcasts.length, 2); assert.equal(await page.getByRole('checkbox').isChecked(), false);
    ledger.rpcOffline = true; await page.getByRole('button', { name: 'Refresh data', exact: true }).click();
    await page.getByText(/Could not read the chain\./).waitFor({ timeout: 20_000 });
    assert.equal(await page.getByRole('button', { name: 'Reserve item 1', exact: true }).isDisabled(), true);
    ledger.rpcOffline = false; await page.getByRole('button', { name: 'Retry chain reads', exact: true }).click(); await visible(page, '60 dds');
    ledger.item.metadataURI = '<img src=x onerror="window.__metadataExecuted=true">';
    await page.getByRole('button', { name: 'Refresh data', exact: true }).click(); await visible(page, ledger.item.metadataURI);
    assert.equal(await page.evaluate(() => window.__metadataExecuted), undefined);
    assert.equal(await page.locator('.metadata img').count(), 0);
    await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
    await page.getByRole('button', { name: 'Connect wallet', exact: true }).waitFor();
    assert.equal(await page.getByText('100 dds', { exact: true }).count(), 0);
    results.push({ scenario: 'Rejected wallet prompt, reverted receipt, renewed policy acceptance, honest RPC failure/retry, text-only metadata and disconnect', passed: true });
    await context.close();
  }
  {
    const { page, context } = await setup(createLedger(), 390, false);
    await page.getByRole('button', { name: 'Connect wallet', exact: true }).click();
    for (const name of ['MetaMask', 'Coinbase Wallet', 'Rabby', 'Phantom']) await page.getByRole('link', { name: `Open in ${name}`, exact: true }).waitFor();
    const rabby = new URL(await page.getByRole('link', { name: 'Open in Rabby', exact: true }).getAttribute('href'));
    assert.equal(rabby.origin + rabby.pathname, 'https://go.rabby.io/mobile/');
    assert.equal(rabby.searchParams.get('_cmd'), 'open-dapp'); assert.equal(rabby.searchParams.get('dapp'), url);
    await page.getByRole('button', { name: 'Coinbase Smart Wallet', exact: false }).waitFor();
    await checkOverflow(page, 320);
    results.push({ scenario: 'Phone wallet picker without injection: four open-in links and Coinbase Smart Wallet; no relay or project ID', passed: true });
    await context.close();
  }
  {
    const ledger = createLedger();
    ledger.balances.set(RENTER, 2n ** 256n - 1n);
    ledger.policy.deposit = 2n ** 256n - 1n;
    ledger.policyId = 2n ** 64n - 1n; ledger.item.policyId = ledger.policyId;
    const { page, context } = await setup(ledger);
    await page.getByRole('button', { name: 'Connect wallet', exact: true }).click(); await page.getByRole('button', { name: 'Rabby', exact: true }).click();
    await page.getByRole('checkbox').waitFor();
    ledger.item.metadataURI = 'ipfs://untrusted/' + 'x'.repeat(600);
    await page.getByRole('button', { name: 'Refresh data', exact: true }).click(); await visible(page, ledger.item.metadataURI);
    for (const width of [320, 390, 1440]) await checkOverflow(page, width);
    await page.setViewportSize({ width: 320, height: 844 });
    await page.screenshot({ path: `${screenshots}/320-long-values.png`, fullPage: true });
    results.push({ scenario: 'Maximum uint256 6-decimal values, maximum policy ID and long untrusted metadata wrap at 320, 390 and 1440', passed: true });
    await context.close();
  }
  assert.deepEqual(errors, [], 'No browser JavaScript errors');
  const report = { environment: 'Chromium; mocked EIP-6963 Rabby and intercepted public RPC; production dist under /preview/; zero live writes', viewports: [320, 390, 1440], results, pageErrors: errors };
  await writeFile('artifacts/browser-results.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close(); await new Promise(r => server.close(r));
}
