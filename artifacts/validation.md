# Recovery repair validation

Complete for the stated scope. This is worker-run evidence, not independent certification.

## Scope and implementation

The existing Fieldkit single-page customer dashboard, Robinhood Chain Testnet deployment, full ABIs, exact-deposit approval, explicit policy acceptance, wallet/account/network guards, cancellation into credit and separate withdrawal are preserved. Source and rebuilt static export are included. No contract, dependency manifest, lockfile, build configuration, wallet connector or network configuration changed. No public-chain transaction was sent.

The repair distinguishes a first wallet attempt from a retry. Rejecting a first attempt without earlier uncertainty or a returned hash can clear it. Rejecting a retry retains the complete earlier operation in memory and local storage, including its original reference, accepted quote, calldata, start time, block and hashes. Fresh actions remain blocked through reload. The pending panel and error explain that the earlier booking may still be pending.

An optional `priorUncertainty` boolean is validated in the existing version-1 journal when a retry returns a hash. A failed retry receipt also cannot resolve an earlier hashless attempt. Reference/event recovery can discover the original successful transaction even with a failed retry hash saved. Old version-1 journals remain readable; saved `prepared` requests are treated conservatively on retry.

## Reproduced before repair

- Added the exact engine sequence to the actual delivered fixture: sufficient allowance and acceptance; first send loses its response; zero reference mapping; same-reference retry rejected with code 4001. The assertion that the original operation remained failed with `Received: undefined`. A saved-`prepared` reload case failed likewise. At this stage, **72 passed / 2 failed** in the 74-test suite, including all 64 original tests passing.
- Ran the new browser scenario against the delivered `dist/` before rebuilding. The first reservation was recorded in the mock ledger and left unmined before its response was lost. Only the retry was rejected. The assertion `Rejecting only the retry preserves the entire original request` failed with `actual: undefined`. This reproduced lost recovery, not a second charged deposit.
- After repair, the two receipt-failure variants were added as well, bringing the final suite to **76 passing tests**.

## Clean source-copy validation

A fresh copy of all final source/configuration/lockfile/runtime files was made without `.git/`, `.imd/`, `node_modules/`, `test/scratch/` or `artifacts/`. No directory under `artifacts/` was created manually. Versions: Node 24.21.0, npm 11.19.0, Playwright 1.56.1, bundled Chromium 141.0.7390.37 / build 1194. Playwright and npm caches were installed outside the repository using the setup documented in README.

Commands below ran sequentially from that fresh copy. The ordinary npm cache was redirected outside the repository because this environment's default cache is read-only. See [clean-checks.txt](clean-checks.txt) for actual command output.

| Command | Actual result |
| --- | --- |
| `npm ci --cache /tmp/fieldkit-npm-cache --no-audit --no-fund` | Exit 0; installed from the unchanged lockfile |
| `npm run typecheck` | Exit 0 |
| `npm test` | Exit 0; 76 tests in 2 files |
| `npm run abi:check` | Exit 0; all 76 escrow and 21 token ABI entries matched compilation of all 15 pinned source files; offline |
| `npm run build` | Exit 0; 1,804 modules; relative URLs; export 785,461 bytes |
| `npm run check:bundle` | Exit 0; source/export 1,190,305 bytes before adding evidence files; final bundle check repeated after evidence packaging |
| `npm run test:browser` with the documented `IMD_PLAYWRIGHT` and `PLAYWRIGHT_BROWSERS_PATH` | Exit 0; all 5 scenario groups; absent `artifacts/` automatically created; no page errors or failed local resources |

The fresh build was compared by SHA-256 for every export file and was byte-identical to the delivered `dist/`. The complete browser suite served that export under `/preview/` and intercepted all off-origin requests: writes went only to the in-memory ledger.

The exact browser regression verifies identical first/retry calldata, a zero mapping while the original is unmined, unchanged persisted operation after retry rejection, visible original reference and accepted terms, disabled fresh approval/reservation controls, no additional send on reload, and eventual original reference/event/receipt recovery with only one deposit deducted in the mock. Engine coverage also attempts every fresh write while unresolved, checks a new engine instance, preserves original timing and block boundaries, retains first-attempt rejection behavior, and exercises transport, mapping, wallet identity, snapshot, policy, allowance, gas and simulation retry failures.

The browser report was then saved separately and the fresh copy's generated `artifacts/` directory removed. `scripts/live-read.mjs` ran again with the directory absent, routing fetch through the assignment-provided chain provider, and created its directory/report itself (exit 0). The runtime and report retain the supplied public RPC as the source. [live-read.json](live-read.json) records block **139451427**, chain 46630, both contracts with code, the expected payment token and item 1 available with the 50/5 dds, one-day policy. This was read-only. The direct public RPC route was not exercised by this worker.

## Better Interface review

Applied the pinned Better Interface workflow and core principles of all six domains. Existing tokens, typography, components, layout, copy and styling were retained; only recovery explanations changed. The visual idea remains a compact field-equipment counter with pale surfaces and dark green actions.

| Domain | Coverage and evidence | Limits |
| --- | --- | --- |
| Accessibility — Checked | Source review of native buttons/inputs/dialog, labels, accessible names, status/alert regions, focus styles and reduced-motion guard. Chromium checks Enter opening the picker, Tab containment, Escape closing/focus return. Visible focus appears in the 390 screenshot. | No screen-reader session, full keyboard-only transaction journey, automated accessibility audit, forced-colors or native zoom test |
| Layout — Checked | Production browser at 320, 390, 768 and 1440; initial, connected, pending, retry-rejected, reloaded, confirmed and long-value states. No horizontal overflow. Initial 390 bounds assert product item 1 and Connect wallet within 844px. Screenshots visually inspected. | Other intermediate widths and pseudo-localization/RTL not tested; English/light theme only |
| Writing — Checked | Retry rejection says the earlier booking may still be pending; policy-change retry explanation does not claim the original was never sent. Existing terms and approval/cancellation/withdrawal distinctions preserved. | Review limited to the existing customer page and affected recovery states |
| Typography — Checked | CSS and rendered probe confirm 14/16/18/22/32/40px scale, 400/500/600 weights, system family, 16px inputs, tabular amounts and wrapping. Full references/addresses and uint256 values remain available. | Platform font substitution, screen-reader pronunciation and physical-device text scaling not verified |
| Colors — Checked | Existing semantic tokens retained. Rendered probe measures body/page 13.17:1, muted/subtle 4.72:1, primary/white 9.57:1 and disabled text 5.07:1. Browser separately checks cancellation hover text contrast. Status includes text. | Probe measures resolved solid text/background pairs; no claim of exhaustive contrast compliance for every interactive state |
| UI — Checked | Existing border/tonal surfaces, native modal, receipt states, disabled fresh actions and explicit recovery actions reviewed. Source has 120ms named color transitions behind the reduced-motion preference; no endless animation. | No physical-device wallet UI, vendor passkey flow or animation-panel slow-motion review |

### Findings, corrections and rechecks

1. **High — lost pending-payment recovery.** `src/engine.ts:166`, `src/engine.ts:180`: the previous rejection branch cleared any hashless operation, including a retry of an earlier uncertain send. Now only an explicit first attempt with no evidence can clear. Retry/preflight failures keep the original journal; failed retry receipts retain earlier uncertainty. Rechecked with engine regressions (`tests/engine.test.ts:203`, `:250`, `:271`, `:289`, `:339`) and the mocked browser sequence (`tests/browser/smoke.mjs:164`). Passed.
2. **Medium — misleading recovery explanation.** `src/engine.ts:120`, `src/engine.ts:188`, `src/App.tsx:68`: a retry rejection must not imply the earlier booking was rejected, and changed-policy preflight must not imply no earlier send. Updated only recovery copy, using the existing alert and pending-panel patterns. Rechecked the visible rejected-retry panel and retained full reference/terms at 320/390/1440. Passed.
3. **Medium — clean-checkout reports failed.** `tests/browser/smoke.mjs:287`, `scripts/live-read.mjs:21`: both commands now recursively create `artifacts/` immediately before writing. Rechecked independently with the directory absent. Passed.
4. **Medium — missing evidence / unreproducible browser setup.** README previously referenced absent validation/probe artifacts and unspecified browser tooling. Included actual reports and screenshots; documented Playwright 1.56.1 installation and browser command with ordinary external tooling. Fresh-copy checks passed.

The evidence directory was also matched by a broader tooling ignore rule. `.gitignore` now explicitly includes only these eight named evidence paths with per-file budgets totaling at most 983,040 bytes. Their actual combined size is below that budget. Dependency and scratch exclusions remain zero-byte budgets. Final submission path/size checks include the evidence.

### Pinned taste@1 probe

Ran after the final source build:

```sh
node .imd/reads/skills/design-critic/scripts/taste.mjs --out test/scratch/taste --offline
```

Used the same externally installed Playwright and Chromium via the documented environment variables. Command exit 0; **15/16 raw checks passed**. [design-probe.json](design-probe.json) is the unchanged generated report, including its failed check. Offline mode deliberately blocks chain reads, so this probe covers the honest RPC-error state; the mocked suite covers populated data and wallet states.

The failed `eyebrows` check identifies `src/WalletControl.tsx:39` (`Connect wallet`) above the h1 at 390. Screenshot review confirms this is the established, functional header wallet control, not a content kicker. The pinned review explicitly exempts the conventional dapp header wallet control, and the task requires preserving styling. No change was applied. No applicable first-screen/repeated visual defect was found in the reviewed scope. The probe notes four targets below its comfortable 44px size; all pass its 24px/spacing check.

## Included rendered evidence

- [390px initial dashboard](screenshots/390-disconnected.png): actual mocked listing, policy and header action; visible keyboard focus. The image is full-page; its first 844 CSS pixels were checked by bounds and visual inspection.
- [390px rejected retry](screenshots/390-retry-rejected.png): explicit warning, saved reference/terms and disabled fresh actions.
- [1440px completed journey](screenshots/1440-complete.png): reservation management and separate refund withdrawal after mocked receipts.
- [browser-results.json](browser-results.json): all five scenario groups, viewports, Chromium version, page/resource error counts.

## Remaining limitations

No real extension, phone wallet, passkey account, WebKit, physical device, screen reader, native 200% zoom or live write was tested. Offline probe results and mocked browser results do not certify a wallet vendor or public RPC. Existing bounded event searches, one-receipt confirmation threshold, browser-local recovery scope, lack of complete history and reliance on Web Locks where available remain. A genuinely unresolved original can keep actions blocked until positive receipt/reference reconciliation; a rejected retry, missing hash or zero pre-mining mapping is intentionally insufficient to discard it. No contract-level duplicate-charge claim is made.
