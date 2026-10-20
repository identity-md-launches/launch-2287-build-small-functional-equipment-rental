# Fieldkit interface

## Overview

Fieldkit is an equipment-rental utility for people using a disposable testnet wallet. The visual idea is a small field-equipment counter: a pale work surface, a simple case illustration and dark green action controls. The product and Connect wallet action appear on the first 390-pixel screen. The interface prioritizes the listing, exact accepted terms and transaction status over introductory copy.

The implemented source of truth is `src/style.css`, with UI patterns in `src/App.tsx` and the wallet dialog in `src/WalletControl.tsx`. There is one light theme, one page and no external font or image service.

## Colors

Semantic tokens in `src/style.css`:

| Token | Value | Use |
| --- | --- | --- |
| `--color-page` | `#f6f7f2` | Page background |
| `--color-surface` | `#ffffff` | Form and booking surfaces |
| `--color-subtle` | `#eef1e7` | Equipment panel, explanatory states |
| `--color-text` | `#242d28` | Main content |
| `--color-muted` | `#626d64` | Labels and supporting text |
| `--color-border` | `#d7ddd1` | Structural dividers |
| `--color-control-border` | `#7c8975` | Interactive boundaries |
| `--color-accent` | `#294c3d` | Primary actions and links |
| `--color-accent-hover` | `#1e3d2f` | Primary hover |
| `--color-warning-bg` / `--color-warning-text` | `#fff2d9` / `#725013` | Wrong chain, missing funds and expiry |
| `--color-error-bg` / `--color-error-text` | `#fff0eb` / `#943b26` | RPC/wallet errors and cancellation confirmation |
| `--color-error-hover` | `#7b2d1b` | Cancellation hover and press |
| `--color-focus` | `#3d654c` | 2px keyboard focus perimeter |

Local component treatments are defined beside their selectors: testnet notice `#e8eddb`/`#3e4d32`, availability `#dce8ca`/`#304c23`, disabled buttons `#e9ede5`/`#5c6656`. Status always includes text. Measured contrast includes body on page 13.17:1, muted text on subtle 4.72:1, white on primary 9.57:1, disabled text 5.07:1 and the control boundary on white 3.69:1. Measurements and coverage limits are in `artifacts/validation.md`.

## Typography

Use the system stack `-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`; no font download is needed. The scale is 14, 16, 18, 22, 32 and 40px. Weights are 400, 500 and 600. Body is 16px/1.5; supporting UI text is 14px/1.5. Inputs remain 16px to avoid small-input zoom on phones.

The desktop h1 is 40px/1.16 at weight 600 with `-.045em` tracking; it becomes 32px with `-.04em` tracking below 680px. Section titles use 18 or 22px; reservation subheads use 18px. Deposits and credit use 32px with tabular numerals. Recovery references alone use a system monospace stack. Addresses, maximum integer values and untrusted metadata wrap completely; critical values are not ellipsized. Headings balance, paragraphs use pretty wrapping, and useful content remains selectable.

## Layout

`.page-width` is at most 1120px, with 32px desktop side margins, 20px below 950px and 16px below 680px. Spacing mostly follows 4px steps, with 8–12px inside groups and 20–48px between groups. The brand and wallet control share a header alignment edge.

`.rental-panel` splits listing and terms into equal columns. The listing has a tonal background and the drawing is decorative. `.manage-grid` separates booking lookup from aggregate credit in 1.25:1 columns. `.account-strip` has four columns, becomes two below 950px, and gives address/network full rows below 680px.

At 680px the rental and management grids stack, the decorative drawing disappears, and management separators become horizontal. At 370px and below, input/button rows stack so long labels remain usable. Flex rows wrap, grid children have `min-width: 0`, and `main` inherits `overflow-wrap: anywhere`. The browser smoke test checks 320, 390 and 1440px, including uint256 maxima and long metadata. Intermediate breakpoints were reviewed in source, not exhaustively rendered.

## Elevation & Depth

The interface is flat: one border around the rental surface, tonal separation within it and simple lines for management sections. No surface combines border and shadow, and no card is placed inside another card. Error and pending states use background color and explicit text. The native modal supplies its own top layer with a `rgb(22 33 25 / .45)` backdrop. No fixed transaction banner covers content.

## Shapes

The rental surface uses a 14px outer radius and 13px inset corners for its 1px border. Controls and notices use 8px; status labels use 5px. Step numbers are circular. The wallet dialog uses 16px corners on desktop and 18px top corners as a phone bottom sheet. Content is not clipped to force rounded shapes. The skip link is visually concealed only until keyboard focus.

## Components

- **`.button`** in `src/style.css`: neutral, `primary`, `danger` and `compact`. Minimum height 44px. Hover, press, disabled and 2px `:focus-visible` states are explicit. Text wraps for large amounts. Color transitions last 120ms; the `.96` press scale is enabled only when reduced motion is not requested.
- **`WalletControl`** in `src/WalletControl.tsx`: EIP-6963 wallet choices, explicit connection, disconnect and chain switch/add. The native `<dialog>` gives keyboard focus containment, Escape, backdrop closing and focus return. Phone rows include four wallet-browser links and Coinbase Smart Wallet; row height is 56px. Wallet rejection stays in the dialog as a readable status.
- **`DataRow` and `ReservationTerms`** in `src/App.tsx`: definition-list rows with labels and complete values. The saved reservation uses its own contract snapshot, independently from current listing terms.
- **Booking controls** in `src/App.tsx`: accepted-policy checkbox followed by numbered, separate approval and reservation actions. No action is enabled on a missing quote, wrong session or unresolved request. Insufficient funds receive a nearby explanation.
- **Feedback and recovery patterns** in `src/App.tsx`: a stable polite status region, urgent error alerts, receipt links and a pending request panel. Pending and confirmed are distinct. Unknown data is labeled unavailable rather than zero. A manually supplied hash must match the saved action and a receipt newer than its preflight block; mismatched evidence keeps the pending panel visible. A rejection before broadcast returns the action to idle, while any failure after a known hash retains the pending request. Rejection messages preserve the distinction between an unsubmitted prompt and an already saved uncertain operation.
- **Cancellation and withdrawal confirmations** in `src/App.tsx`: inline disclosures that state the consequence and provide a way back. Refund credit has a separate section and action.
- **Forms**: persistent visible labels, numeric keyboard hint for reservation IDs, ordinary paste support and real submit buttons. Lookup errors have an announced message and a retry path. Screen-reader and native-device behavior remain unverified.

## Do's and Don'ts

Reuse `.page-width`, semantic color tokens, `.section-head`, `.data-row` and existing buttons when adding another utility section. Keep explanations next to the action they explain, and preserve explicit unknown/pending/error states. Add contract data only with the same integer and on-chain validation rules.

Use a dark fill for the current consequential action, neutral controls for supporting actions and danger styling for cancellation confirmation. Keep the header's single wallet entry point. Do not add an introductory hero, decorative gradients, external asset dependencies or smaller form text. Do not truncate an address or amount in the content; the conventional short address in the header is accompanied by the full address in the connected-wallet section.

For another page, start from the same width and heading patterns, reuse the type scale, then put its main task first and use the existing state feedback patterns. Record any new responsive behavior before introducing another breakpoint or font size.

Design guidance attribution and retained licenses: `docs/ATTRIBUTION.md` and `docs/DESIGN-GUIDE-LICENSE.txt`.
