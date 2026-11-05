/**
 * Optional two-browser smoke test of the online mode (real PeerJS broker + WebRTC on this machine).
 *   node scripts/online-smoke.mjs [url] [outDir]
 */
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://localhost:5199/';
const out = process.argv[3] ?? 'ui-shots';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const hostCtx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
const guestCtx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
const host = await hostCtx.newPage();
const guest = await guestCtx.newPage();
const errors = [];
for (const [name, p] of [['host', host], ['guest', guest]]) {
  p.on('pageerror', (e) => errors.push(`${name} pageerror: ${e.message}`));
  p.on('console', (m) => m.type() === 'error' && errors.push(`${name} console: ${m.text()}`));
}

await host.goto(url);
await host.fill('input[placeholder="e.g. Red Dragons"]', 'HostFC');
await host.click('text=Create room');
await host.waitForSelector('.room-code', { timeout: 30000 });
const code = (await host.textContent('.room-code')).trim();
console.log('Room code:', code);
await host.screenshot({ path: `${out}/online-1-waiting.png` });

await guest.goto(url);
await guest.fill('input[placeholder="e.g. Red Dragons"]', 'GuestFC');
await guest.fill('input[placeholder="Room code"]', code);
await guest.click('text=Join room');

for (const [name, p] of [['host', host], ['guest', guest]]) {
  await p.waitForSelector('.transfer', { timeout: 40000 });
  console.log(name, 'reached the transfer market');
}

// both sign players and ready up
for (const p of [host, guest]) {
  for (const pos of ['GK', 'DEF', 'MID', 'FWD']) {
    await p.click(`.tab:has-text("${pos}")`);
    await p.locator('.offers .player-card:not(.disabled)').first().click();
  }
  await p.click('button:has-text("Ready")');
}
for (const [name, p] of [['host', host], ['guest', guest]]) {
  await p.waitForSelector('.hand .pcard', { timeout: 30000 });
  console.log(name, 'sees its hand');
}

// one duel: both lock in a single card
for (const p of [host, guest]) {
  await p.locator('.hand .pcard').first().click();
  await p.click('button.primary:has-text("Ready")');
}
for (const [name, p] of [['host', host], ['guest', guest]]) {
  await p.waitForSelector('.reveal', { timeout: 30000 });
  console.log(name, 'sees the showdown');
}
await host.screenshot({ path: `${out}/online-2-host-reveal.png` });
await guest.screenshot({ path: `${out}/online-3-guest-reveal.png` });

// the guest leaves mid-match: the host must be told
await guestCtx.close();
await host.waitForSelector('text=disconnected', { timeout: 40000 }).catch(() => {});
await host.screenshot({ path: `${out}/online-4-host-after-leave.png` });
console.log('Host lobby notice:', (await host.locator('.notice').first().textContent().catch(() => 'none')));

await browser.close();
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'No console errors.');
