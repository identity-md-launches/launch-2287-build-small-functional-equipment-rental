// Optional regeneration of the committed social image from its repository-native SVG source.
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.IMD_PLAYWRIGHT ? pathToFileURL(process.env.IMD_PLAYWRIGHT).href : 'playwright');
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  const svg = await readFile('design/share.svg', 'utf8');
  await page.setContent(`<style>html,body{margin:0;width:1200px;height:630px}</style>${svg}`);
  await page.screenshot({ path: 'public/share.png' });
} finally { await browser.close(); }
