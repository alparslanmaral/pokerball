/**
 * Optional smoke test for the dev-only admin editor (needs the dev server and Playwright).
 *   node scripts/admin-smoke.mjs [baseUrl] [outDir]
 */
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const base = process.argv[2] ?? 'http://localhost:5199';
const out = process.argv[3] ?? 'ui-shots';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()));

await page.goto(`${base}/admin`);
await page.waitForSelector('.player-list .row');
await page.waitForSelector('text=Suggested', { timeout: 30000 });
await page.screenshot({ path: `${out}/admin-1-players.png` });

// Create a new player with missing names: Save must be blocked.
await page.click('text=+ New player');
await page.waitForSelector('.errors');
const saveDisabled = await page.locator('.save-area button.primary').isDisabled();
console.log('Save disabled with validation errors:', saveDisabled);
await page.fill('.editor-form .grid2 label:nth-child(1) input', 'Test');
await page.fill('.editor-form .grid2 label:nth-child(2) input', 'Player');
await page.screenshot({ path: `${out}/admin-2-new.png` });

// Trait catalog tab
await page.click('text=Trait catalog');
await page.waitForSelector('.tpl');
await page.screenshot({ path: `${out}/admin-3-catalog.png` });

// API must reject non-local style requests (simulated via bad Host header)
const res = await page.request.get(`${base}/__admin/api/data`, { headers: { host: 'evil.example.com' } }).catch(() => null);
console.log('Spoofed Host status:', res ? res.status() : 'request failed');

await browser.close();
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'No console errors.');
