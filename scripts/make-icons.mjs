/** Renders public/icons/icon.svg into the PNG sizes the PWA manifest needs (needs Playwright's Chromium). */
import { readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const svg = readFileSync(new URL('../public/icons/icon.svg', import.meta.url), 'utf8');
const browser = await chromium.launch();
const page = await browser.newPage();

async function render(size, file, { maskable = false } = {}) {
  await page.setViewportSize({ width: size, height: size });
  // Maskable icons keep the artwork inside the central safe zone and bleed the background to the edge.
  const inner = maskable ? Math.round(size * 0.72) : size;
  const pad = (size - inner) / 2;
  const body = svg.replace('<svg ', '<svg width="100%" height="100%" ');
  await page.setContent(
    `<body style="margin:0;background:${maskable ? '#0b2a1f' : 'transparent'}">` +
      `<div style="position:absolute;left:${pad}px;top:${pad}px;width:${inner}px;height:${inner}px">${body}</div></body>`,
  );
  const buf = await page.screenshot({ omitBackground: !maskable });
  writeFileSync(new URL(`../public/icons/${file}`, import.meta.url), buf);
  console.log('wrote', file);
}

await render(192, 'icon-192.png');
await render(512, 'icon-512.png');
await render(512, 'icon-maskable-512.png', { maskable: true });
await render(180, 'apple-touch-icon.png');
await browser.close();
