/**
 * Plays a complete single-player match through the real UI (optional dev tool; needs Playwright + dev server).
 *   node scripts/ui-fullmatch.mjs [url] [outDir] [desktop|mobile]
 */
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://localhost:5199/';
const out = process.argv[3] ?? 'ui-shots';
const mode = process.argv[4] ?? 'desktop';
mkdirSync(out, { recursive: true });

const viewport = mode === 'mobile' ? { width: 390, height: 844 } : { width: 1280, height: 900 };
const browser = await chromium.launch();
const page = await browser.newPage({ viewport, hasTouch: mode === 'mobile' });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()));
const shot = (n) => page.screenshot({ path: `${out}/${mode}-${n}.png` });

await page.goto(url);
await page.fill('input[placeholder="e.g. Red Dragons"]', 'Tester');
await shot('lobby');
await page.click('text=Play vs AI');
await page.waitForSelector('.transfer');
for (const pos of ['GK', 'DEF', 'MID', 'FWD']) {
  await page.click(`.tab:has-text("${pos}")`);
  await page.locator('.offers .player-card:not(.disabled)').first().click();
}
await shot('transfer');
await page.click('button:has-text("Ready")');

let seen = { halftime: false, shot: false, reveal: false };
const started = Date.now();
while (Date.now() - started < 8 * 60 * 1000) {
  if (await page.locator('h2:has-text("Full time")').count()) break;
  if (await page.locator('button:has-text("Start second half")').count()) {
    if (!seen.halftime) {
      seen.halftime = true;
      await shot('halftime');
    }
    await page.click('button:has-text("Start second half")').catch(() => {});
  } else if (await page.locator('.shot-area .zone:not([disabled])').count()) {
    if (!seen.shot) {
      seen.shot = true;
      await shot('shot-pick');
    }
    await page.locator('.zone').nth(Math.floor(Math.random() * 3)).click().catch(() => {});
  } else if (await page.locator('.reveal').count()) {
    if (!seen.reveal) {
      seen.reveal = true;
      await page.waitForTimeout(4200);
      await shot('reveal');
    }
  } else if (await page.locator('.hand .pcard.clickable').count()) {
    const ready = page.locator('button.primary:has-text("Ready")');
    if (await ready.isEnabled().catch(() => false)) await ready.click().catch(() => {});
    else {
      const cards = page.locator('.hand .pcard.clickable');
      await cards.nth(0).click().catch(() => {});
      await cards.nth(1).click().catch(() => {});
      if (!seen.hand) {
        seen.hand = true;
        await shot('hand');
      }
    }
  }
  await page.waitForTimeout(400);
}
await shot('fulltime');
console.log('Reached full time:', (await page.locator('h2:has-text("Full time")').count()) > 0, 'in', Math.round((Date.now() - started) / 1000), 's');
console.log('Score text:', (await page.locator('.big-score').first().textContent().catch(() => '?')) ?? '?');
await browser.close();
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'No console errors.');
