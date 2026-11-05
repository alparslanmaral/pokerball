/**
 * Optional browser smoke test (needs `npx playwright install chromium`, dev server running).
 *   node scripts/ui-smoke.mjs [url] [outDir] [duels]
 * Plays a single-player match through the real UI, takes screenshots and reports console errors.
 */
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://localhost:5199/';
const out = process.argv[3] ?? 'ui-shots';
const duels = Number(process.argv[4] ?? 3);
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()));

const shot = (name) => page.screenshot({ path: `${out}/${name}.png` });

await page.goto(url);
await page.fill('input[placeholder="e.g. Red Dragons"]', 'Tester');
await shot('1-lobby');
await page.click('text=Play vs AI');

// Transfer: sign the first affordable offer of every tab.
await page.waitForSelector('.transfer');
for (const pos of ['GK', 'DEF', 'MID', 'FWD']) {
  await page.click(`.tab:has-text("${pos}")`);
  await page.locator('.offers .player-card:not(.disabled)').first().click();
}
await shot('2-transfer');
await page.click('button:has-text("Ready")');

for (let d = 0; d < duels; d++) {
  await page.waitForSelector('.hand .pcard', { timeout: 30000 });
  if (d === 0) await shot('3-match-hand');
  const cards = page.locator('.hand .pcard');
  await cards.nth(0).click();
  await cards.nth(1).click();
  await cards.nth(2).click();
  if (d === 0) await shot('4-selected');
  await page.click('button.primary:has-text("Ready")');
  await page.waitForSelector('.reveal', { timeout: 30000 });
  await page.waitForTimeout(3800);
  if (d === 0) await shot('5-reveal');
  // wait for the reveal to close (auto-continue), possibly passing through a shot
  for (let i = 0; i < 60; i++) {
    if (await page.locator('.shot-area').count()) {
      await page.locator('.zone').first().click();
      await page.waitForSelector('.reveal', { timeout: 30000 });
      await page.waitForTimeout(3000);
      await shot(`6-shot-${d}`);
    }
    if (await page.locator('.hand .pcard').count()) break;
    await page.waitForTimeout(500);
  }
}
await page.click('.team.opp');
await shot('7-opp-squad');
await browser.close();
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'No console errors.');
