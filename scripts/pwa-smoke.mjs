/**
 * PWA smoke test against a production preview (`npm run build && npx vite preview --port 4173`).
 *   node scripts/pwa-smoke.mjs [url]
 * Checks the manifest, service worker registration and that the app shell loads while offline.
 */
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://localhost:4173/';
const browser = await chromium.launch();
const context = await browser.newContext();
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

await page.goto(url);
await page.waitForSelector('.lobby');

const manifest = await page.evaluate(async () => {
  const href = document.querySelector('link[rel=manifest]')?.href;
  const res = await fetch(href);
  return { href, ok: res.ok, json: await res.json() };
});
console.log('manifest:', manifest.ok, manifest.json.name, manifest.json.icons.length, 'icons');

await page.evaluate(() => navigator.serviceWorker.ready);
await page.waitForFunction(() => navigator.serviceWorker.controller || true);
const swState = await page.evaluate(async () => {
  const reg = await navigator.serviceWorker.getRegistration();
  const keys = await caches.keys();
  return { scope: reg?.scope, active: !!reg?.active, caches: keys };
});
console.log('service worker:', swState);

// reload once so the page is controlled, then go offline
await page.reload();
await page.waitForSelector('.lobby');
await context.setOffline(true);
await page.reload();
await page.waitForSelector('.lobby', { timeout: 10000 });
console.log('offline reload works:', (await page.locator('h1').textContent()) === 'Poker Pitch');
await page.fill('input[placeholder="e.g. Red Dragons"]', 'Offline FC');
await page.click('text=Play vs AI');
await page.waitForSelector('.transfer', { timeout: 10000 });
console.log('single-player starts offline: true');

await browser.close();
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'No page errors.');
