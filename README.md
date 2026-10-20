# Fieldkit equipment rental

A small Vite, React and TypeScript frontend for the existing rental escrow on **Robinhood Chain Testnet (46630)**. It uses real wallet requests and contract reads. It is a public, disposable demonstration using mock tokens, not real payments or a production service.

The finished static site is in `dist/`. Source, the npm lockfile, ABI provenance and automated tests are included. No backend, indexer, database, deployment, admin tools, staff tools, minting or signing secrets are needed.

## Install, run and rebuild

Use Node **22.12 or newer** and npm. From the repository root:

```sh
npm ci
npm run dev
```

Open the address Vite prints. To check and rebuild:

```sh
npm run typecheck
npm test
npm run abi:check
npm run build
npm run check:bundle
npm run preview
```

`npm run preview` serves the production export locally. Build and tests do not use the public chain. The ABI check compiles the included original Solidity sources with pinned `solc-js 0.8.26`, offline after dependency installation. It creates no contracts and performs no deployment.

## Browser smoke test

The reproducible browser test runs the **production `dist/`** under `/preview/`, injects a mocked EIP-6963 Rabby provider and intercepts every public RPC request with a local in-memory ledger. It does not broadcast any transaction to a network. It manages and closes its own static server and Chromium in one foreground command.

Install the exact tested **Playwright 1.56.1** and its Chromium **141.0.7390.37 (build 1194)** outside the repository. From the repository root, after `npm ci`:

```sh
FIELDKIT_BROWSER_TOOLS="$(mktemp -d /tmp/fieldkit-browser.XXXXXX)"
npm install --prefix "$FIELDKIT_BROWSER_TOOLS" \
  --cache "$FIELDKIT_BROWSER_TOOLS/npm-cache" --no-audit --no-fund playwright@1.56.1
export IMD_PLAYWRIGHT="$FIELDKIT_BROWSER_TOOLS/node_modules/playwright/index.mjs"
export PLAYWRIGHT_BROWSERS_PATH="$FIELDKIT_BROWSER_TOOLS/browsers"
"$FIELDKIT_BROWSER_TOOLS/node_modules/.bin/playwright" install chromium
npm run build
npm run test:browser
```

These commands need no worker tooling or pre-existing reports directory. On minimal Linux installations, Playwright's `install --with-deps chromium` can install the required OS libraries where permitted. If Playwright 1.56.1 is already resolvable as a Node module and its browser is installed, simply run `npm run test:browser`. Playwright is not a runtime dependency of this site; keep its installation and caches outside the repository.

The smoke test covers approval → pending booking → reload recovery → ID lookup and ownership → cancellation into credit → separate withdrawal. Its lost-response regression records the first reservation broadcast, drops its response while it remains pending, rejects only the same-reference retry, checks the saved reference and disabled fresh actions through reload, then mines and recovers the original without another send. It also checks first-prompt rejection, reverted receipts, changed-policy acceptance, wrong chain and unknown-chain addition, account clearing, RPC failure/retry, untrusted metadata, keyboard dialog behavior, phone wallet choices and maximum integer amounts at 320, 390 and 1440 pixels, plus ordinary layout at 768. Results are written to `artifacts/browser-results.json`; temporary screenshots go to `test/scratch/browser/`. The command creates its own output directories.

`npm run check:live` is optional and read-only. It creates `artifacts/live-read.json` and its directory itself. It needs the public RPC; all engine, ABI and mocked-browser tests work without that service. Neither report command requires manual directory creation.

## Static hosting

Upload the **contents of `dist/`**, including `assets/`, `wallets/`, favicon and share image, to any ordinary static host. Preserve filenames and directory structure. HTTPS is needed for normal wallet use; localhost is suitable for development. No build command, environment variables, server process or route rewrites are required on the host.

Vite uses `base: './'`. Assets are relative and the site uses one page with in-page anchors. The browser smoke test verifies serving from a subpath. Do not upload `node_modules`, `.imd` inputs or test scratch files. This assignment does not publish or deploy the site.

## Public deployment and ABI provenance

| Configuration | Value |
| --- | --- |
| Chain | Robinhood Chain Testnet, `46630` |
| Gas token | Native test ETH |
| Public RPC | https://rpc.testnet.chain.robinhood.com |
| Explorer | https://explorer.testnet.chain.robinhood.com |
| MockPaymentToken | `0x31339619db548257cE09A76f189b0b1932f5c0cd` |
| RentalEscrow | `0x06135FF9311eCa80a7484444A552f28fFC660F05` |

These public values are centralized in `src/network.ts`. There are no VITE variables, credentials or alternate production chains.

The authoritative source is [identity-md-launches/launch-1988-kkk at 6ce8023819f68d2b84f2151b24285af477f4d9c7](https://github.com/identity-md-launches/launch-1988-kkk/tree/6ce8023819f68d2b84f2151b24285af477f4d9c7). The exact two contracts and their transitive imports are preserved under `docs/contract-source/upstream/` for reproducibility. `docs/abi-provenance.json` records Git blob IDs, SHA-256 hashes and compiler version for all 15 files.

The **complete** ABIs are `src/abi/RentalEscrow.json` (76 entries) and `src/abi/MockPaymentToken.json` (21 entries), including inherited events/errors and functions. `scripts/check-abi.mjs` checks the original contract Git blob IDs and deep-compares every ABI entry against compilation. They are not hand-written signature subsets. To deliberately re-download the same pinned sources and regenerate:

```sh
node scripts/check-abi.mjs --refresh --write
npm run abi:check
```

The frontend exposes only `approve`, `reserve`, `cancel` and `withdrawRefund` writes. The presence of other functions in a full ABI does not expose them in the interface.

## Transaction and recovery behavior

- Listing existence, listing flag, state, current policy, token address, decimals, balances, allowance and credit come from contract reads. A snapshot pins related contract reads to one block and checks the RPC chain ID and escrow payment token. There is no fallback sample data. Metadata is rendered as plain React text, without fetching its URI or executing HTML.
- All token amounts use `bigint` base units and string formatting. The observed deployment has 6 decimals; amounts are never calculated with floating-point numbers. Test ETH pays gas and mock tokens pay the deposit.
- The checkbox accepts the complete displayed policy. Approval and reservation each re-read it; any change clears acceptance and stops the write. Approval sets the **total allowance to exactly the deposit**, if current allowance is insufficient. It is not an unlimited approval or an increment by the shortfall. Reservation remains a separate action.
- Reservation uses `reserve(1, acceptedPolicyId, randomNonzeroBytes32)`. The contract's expected-policy guard protects a change between preflight and execution. Wallet account and chain are rechecked, and calls are simulated and gas-estimated before requesting a write.
- Recovery data is saved **before** the wallet prompt under `fieldkit:v1:<chain>:<escrow>:<wallet>`. It retains exact calldata, accepted terms, reference and any known hash. A synchronous lock prevents duplicate clicks; Web Locks serialize writes between tabs when supported. Account/chain changes clear displayed account data and acceptance before repaint, while preserving the originating scope's recovery record.
- No action is reported confirmed before a successful receipt. The mined transaction must also match sender, target, calldata and zero native value, and its receipt must be newer than the saved preflight block. An older identical withdrawal is not accepted as evidence for a new pending request. Sped-up replacements are checked and their hashes retained. Reverted or different replacement transactions are shown as failures. Receipt checks wait up to 30 seconds per attempt, then retain the unresolved request for explicit checking.
- Reload reconnects an already authorized wallet without requesting a new connection. It checks the saved receipt and `reservationByRef`; it never automatically resubmits. If a send response was lost, the app looks up the reference and can search creation events in bounded 2,000-block chunks, at most 40,000 blocks from the saved starting block. A wallet transaction hash can also be supplied manually and is checked against the exact request.
- An uncertain booking with **no known hash and no mapping result** can be retried explicitly with the **same** reference and accepted calldata after fresh checks. A known pending hash blocks resubmission. Changed policy or unresolved non-booking actions remain blocked until reconciled; the app does not discard a payment request or invent a new reference to get past uncertainty. Do not clear browser storage while a payment is unresolved.
- Rejecting a **first** wallet attempt with no earlier uncertainty or broadcast evidence clears that attempt normally. Rejecting a **retry** leaves the earlier request unresolved: a zero mapping before mining or a missing returned hash does not prove it was never sent. Retry/preflight failures retain the original terms, calldata, reference, start time, block and known hashes in memory and storage. A returned retry hash also retains an optional `priorUncertainty` flag in the version-1 journal: a failed retry receipt cannot clear the earlier unknown attempt. Recovery can find the original creation receipt even when a failed retry hash is known. Fresh actions stay blocked until reconciliation.
- The recovered reservation's status, renter, deposit, fee, policy and timing come from `getReservation`, not the item's new policy. Only the last local booking is remembered. ID lookup can show other renters' reservations and labels ownership. Local storage is not complete account history and is specific to this browser origin.
- Cancellation rechecks renter, `Reserved` status and **chain timestamp strictly before expiry**. A confirmation explains the accepted fee. Cancellation creates escrow credit; it does not pay the wallet. Withdrawal separately re-reads and withdraws **all current credit**, potentially including other reservations. After confirmed actions, balances, availability and reservation state are refreshed. A refresh failure is reported separately from an already confirmed receipt.

## Validation actually run

| Check | Result |
| --- | --- |
| `npm run typecheck` | Passed |
| `npm test` | 76 tests passed in 2 files; includes the rejected-retry/reload/original-mining regression and first-attempt control; mocked gateways, no network |
| `npm run abi:check` | Both full ABIs matched compilation of all 15 pinned source files; offline |
| `npm run build` | Passed; relative production assets emitted in `dist/` |
| `npm run test:browser` | Five mocked Chromium scenario groups passed; 320/390/768/1440 layouts; no page errors or failed local resources |
| Pinned taste@1 design probe | 15/16 raw checks passed offline; header Connect wallet button flagged as a kicker, reviewed as a false positive; see `artifacts/validation.md` and `artifacts/design-probe.json` |
| Read-only live check | `scripts/live-read.mjs` succeeded through the assignment's RPC provider; `artifacts/live-read.json` pins the observation block and names the public source |
| `npm run check:bundle` | Under the 8 MiB submission limit; exact final count is reported by the command |

The complete install/typecheck/test/ABI/build/bundle/browser sequence was also run in a fresh source copy without installed dependencies or an `artifacts/` directory. Each report command was separately checked with its output directory absent. `artifacts/validation.md` records the actual commands, failing-before evidence and final review coverage.

The live observation found item 1 listed and available, token decimals 6, deposit `50000000`, fee `5000000`, window `86400` seconds. These are observation results, not runtime constants or promises of future availability. All wallet/write testing used mocks. No real Rabby extension, passkey account or live testnet write was exercised by the worker. These checks are self-reported, not independent certification.

## Manual Rabby acceptance checklist

Not performed by the worker. A tester may use a disposable, funded testnet wallet:

1. Open the HTTPS site with Rabby installed. Confirm the testnet notice, press Connect wallet, and select **Rabby by name**. Check the displayed address, chain and balances. On another chain, use Switch to Robinhood Chain Testnet and verify chain ID 46630.
2. Obtain test ETH and mock payment tokens from the demo's operator. The app has no mint/faucet function and cannot provide funds. Check that item 1 is actually available.
3. Read and accept the on-chain deposit, cancellation fee and window. Inspect the approval in Rabby: token and spender must match the table, and the amount must equal the current deposit. Reject once and confirm that no success is shown. Then approve and wait for its receipt link.
4. Reserve separately. Inspect the escrow and `reserve` call. While pending, reload and verify the same saved reference/hash and disabled duplicate submission. Wait for a successful receipt and compare the displayed ID and accepted terms with the explorer.
5. Look up the ID again. Check the renter address. Another renter's ID must never offer cancellation. Before expiry, cancel your own Reserved booking and confirm that credit appears while the token wallet balance has not yet received it.
6. Withdraw separately. Check that current total credit is read before the prompt, wait for its receipt, then compare credit and token balance with the explorer. Test account changes, wrong chain and temporary disconnection; account-specific booking and receipt information must clear.

## Limitations

Item 1 only. No full account history, transaction indexer, staff handover/return flow, admin flow, expiry transaction, token acquisition or hosting integration. An expired Reserved booking needs the contract's permissionless `expire` settlement outside this app before its credit becomes withdrawable. Availability can change between reads. One successful receipt is the demo's confirmation threshold; reorganizations remain possible.

RPC outages and a lost wallet response can leave a request unresolved until its hash or reference can be reconciled. Refund withdrawals have no application idempotency key, so an uncertain withdrawal is never resent automatically. Browsers without Web Locks should use one tab. Coinbase Smart Wallet support for this custom testnet depends on the wallet vendor; failure is surfaced rather than simulated. Phone deep links, physical devices, WebKit, screen readers and native browser zoom have not been manually tested.

`DESIGN.md` describes the implemented interface. `artifacts/validation.md` records review coverage, fixes and remaining limits. Bundle exclusions have an explicit zero-byte path budget in `.gitignore`: `/node_modules/**` and `/test/scratch/**`; `dist/` is intentionally included. Eight named evidence files have explicit inclusion budgets totaling at most 983,040 bytes, overriding broader tooling exclusions so the referenced reports are delivered. The source plus export fits well below 8 MiB and contains no package archives or registry mirror.
