# Attribution

Design review used the assignment's pinned Better Interface guide, adapted from Jakub Krehel's Better Interface (MIT). The documentation method is adapted from Paul Bakaus's [Impeccable document guide at 9d715cc4f5564a990ca8345abfdd5df6dc9b41c8](https://github.com/pbakaus/impeccable/blob/9d715cc4f5564a990ca8345abfdd5df6dc9b41c8/skill/reference/document.md) (Apache-2.0). The supplied combined notices and licenses are preserved in `DESIGN-GUIDE-LICENSE.txt`.

MetaMask, Rabby and Phantom wallet marks in `public/wallets/` are the SVGs from RainbowKit's [wallet connectors](https://github.com/rainbow-me/rainbowkit/tree/main/packages/rainbowkit/src/wallets/walletConnectors), MIT. Coinbase's official mark was supplied in the pinned wallet connector reference. These marks identify their wallets; they do not imply endorsement. RainbowKit's MIT license is included in `RAINBOWKIT-LICENSE.txt`.

The Rabby mobile link follows its official [universal-link configuration](https://github.com/RabbyHub/rabby-mobile/blob/develop/apps/mobile/src/constant/universalLink.ts) and [open-dapp handler](https://github.com/RabbyHub/rabby-mobile/blob/develop/apps/mobile/src/hooks/universalLink.ts): `/mobile/?_cmd=open-dapp&dapp=...`. A physical-device check remains unperformed.

The original rental contract and OpenZeppelin dependency source copies retain their SPDX notices. They are included solely to reproduce the ABI from the task's exact source commit. They are not changed or deployed by this frontend.

The Fieldkit mark, equipment-case drawing and share-card SVG are original repository-native vector artwork. `public/share.png` is rendered from `design/share.svg` by `scripts/share-card.mjs`.
