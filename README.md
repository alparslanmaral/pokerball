# Poker Pitch

A football game with no real-time football. A match is a series of **card duels** at points on the pitch.
In each duel both players build a poker hand from their own deck; every hand is scored Balatro-style
(`chips × mult`) and the higher score wins the duel. Winning a duel pushes the ball one step towards the
opponent's goal; winning at the last step earns a **shot** (a simultaneous left / center / right guess
against the keeper). Football players act as "jokers": every player has one trait that changes scoring
while they are part of the current duel.

Play **vs the AI** or **online 1v1** (WebRTC, room code). No accounts, no persistent progression.

> The scoring idea is inspired by Balatro; names, art and assets are original. "Poker Pitch" is a working title.

## Quick start

```bash
npm install
npm run dev        # game at http://localhost:5173, admin editor at http://localhost:5173/admin
npm test           # engine unit tests (Vitest)
npm run build      # type-check + production build into dist/
npm run sim        # balance simulation, writes reports/balance.md
```

Requires Node 20.19+ (or 22+).

## How a match works

| Phase | Rules |
|---|---|
| **Transfer** | Each team has **$100** and buys one player per position (GK, DEF, MID, FWD) from its **own random market** (4 offers per position, one per price band). You may change selections until you press Ready. Purchases are only allowed if the remaining budget still covers the cheapest offers of the unfilled positions, so nobody can get stuck. |
| **Duel** | Both sides draw **8 cards** from their own 52-card deck, may **discard up to 3** (one card or several), pick **1–5 cards** and press **Ready**. Once one side is ready the other has **15 s**, otherwise their highest-chip card is auto-played as a High Card. |
| **Scoring** | `chips = hand chips + scoring-card chips + trait/keeper chips`, `mult = hand mult + additive bonuses`, then xMult, `score = chips × mult`. Only the cards that form the hand score and trigger traits (kickers don't). |
| **Pitch** | 3 duel nodes (A-defence / midfield / A-attack). The winner pushes the ball one step; winning at the last step gives a **shot**. Ties replay the duel at the same node (a tie does not count). |
| **Shot** | Shooter and keeper secretly pick left/center/right; same zone = save, otherwise goal. Either way the ball returns to midfield. Pure guess, no traits. |
| **Match** | Two halves of **8 resolved duels** (a pending shot finishes first). Played cards leave the deck for the half; discards and unplayed cards return. Decks are restored at halftime. Draws are allowed. |

Hand table (`chips × mult`): High Card 5×1 · Pair 10×2 · Two Pair 20×2 · Three of a Kind 30×3 · Straight 30×4 ·
Flush 35×4 · Full House 40×4 · Four of a Kind 60×7 · Straight Flush 100×8. Card chips: 2–10 face value, J/Q/K 10, A 11.

**Goalkeepers** never duel. Their trait gives permanent `+chips / +mult` to two hand types for every duel of their team.

## Project layout

```
src/engine/    Pure, framework-free game engine (no DOM / network). (state, action) => state, seeded RNG.
src/data/      balance.json (every number), traits.json (trait catalog), players.json (player DB)
src/net/       GameHost (engine + timers + AI), LocalAITransport, PeerJS transport (host-authoritative)
src/ui/        React UI (lobby, transfer market, match, reveal, results)
admin/         Dev-only admin editor (NOT part of the production build)
vite/          Dev-server middleware that writes the data files (dev only)
scripts/       sim, seed, probe, format-data and optional Playwright smoke scripts
tests/         Vitest suites for engine, data, AI, host and networking
reports/       Generated balance report
```

### Architecture notes

* **Engine**: `reduce(ctx, state, action)` returns a new state (or the *same object* if the action is rejected).
  All randomness comes from a seed stored in the state (`mulberry32`), so a match is reproducible from its seed
  and action list. `GameContext` (balance + trait catalog + player DB) is injected; the engine imports no JSON.
* **Transport abstraction** (`src/net/transport.ts`): one interface, two implementations. `LocalAITransport`
  runs engine + AI in the browser; `PeerTransport` is host-authoritative — the room creator runs the engine,
  the guest sends *intents* (buy, discard, lock, shot pick, continue, rematch) and receives per-player
  **projections** of the state. The opponent's hand, deck, market, lock contents and shot pick are never sent;
  the opponent's played hand is revealed only once both sides are locked.
* The same engine and UI are used in both modes.

## Look & feel, mobile and PWA

* Scores are shown with icons instead of words: a blue **poker chip** for chips, a red **bolt diamond** for mult and a gold
  **star** for the final score (`[chip] 50 × [bolt] 4 = [star] 200`). The same icons replace the words "chips"/"mult" in trait text
  and in the showdown breakdown (`src/ui/components/Icons.tsx`).
* Theme: dark, glassy surfaces, Inter (UI) + Space Grotesk (numbers/headings), both self-hosted via `@fontsource` so they also work offline.
  All colours/spacing are CSS variables at the top of `src/ui/styles.css`.
* Mobile layout (< 720 px): compact scoreboard and pitch, side-by-side player tiles, a 4-column hand grid, a **sticky action bar**
  (preview + Clear / Discard / Ready), bottom-sheet showdown, one-card-per-row transfer market, safe-area insets for notched phones.
* **PWA**: `public/manifest.webmanifest`, icons in `public/icons/` and a service worker generated at build time
  (`vite/pwa-plugin.ts`, output `dist/sw.js`). The app shell is precached (opens offline, single-player works offline), player portraits are cached
  on first use, and each deploy gets a new cache version; an "A new version is ready" toast offers a reload. The lobby shows an **Install app**
  button when the browser allows it (Chrome/Edge/Android; on iOS use Share → Add to Home Screen). The service worker is registered in production builds only.
  Online play still needs a connection. Regenerate icons from `public/icons/icon.svg` with `node scripts/make-icons.mjs`.

## Online play

* Create a room, share the 5-character code, the friend joins. Peer id is `pokerpitch-<code>`.
* Signalling uses the free public **PeerJS broker**; connectivity uses public **STUN** servers only.
  There is **no TURN relay**, so some networks (strict corporate firewalls, some mobile carriers) cannot connect.
* On connect both clients exchange `{username, dbVersionHash}`. If the player DB / balance / trait catalog
  differs, joining is refused with a "please refresh, game data is out of date" message.
* A heartbeat detects silent disconnects; the opponent leaving returns you to the lobby (the match is not recorded).
* Self-hosting the broker (optional): `npm run peer-server` and start the app with
  `VITE_PEER_HOST=localhost VITE_PEER_PORT=9000 VITE_PEER_SECURE=false npm run dev`
  (`VITE_PEER_PATH` defaults to `/`). Handy for offline testing.

## Admin editor (development only)

`npm run dev` → open **http://localhost:5173/admin**.

* **Players tab**: search, filter by position / price / trait, sort (incl. power), duplicate, delete, create.
  The editor has first/last name, position, price, trait picker (only enabled templates allowed for that
  position, parameters constrained to the catalog bounds, auto-generated description), image upload and a
  **live card preview** rendered by the same component as the game.
* **Price**: you set it; next to it is a **suggested price** derived from a Monte Carlo *power score*
  (how often the trait wins duels, scaled by position weight and mapped onto the price range in `balance.json`).
* **Images**: choose a file, crop to a square (drag + zoom), it is downscaled to 512×512 and saved as
  `public/players/<id>.webp`. Players without an image get a generic placeholder.
* **Trait catalog tab**: enable/disable templates and edit the min/max of every numeric parameter
  (and per-hand keeper bounds). Players outside new bounds are flagged.
* **Validation**: errors **block Save** (duplicate ids, missing names, invalid price, params out of bounds,
  keeper without two distinct hands, trait not allowed for the position). Warnings never block but are always
  visible (fewer than 4 players, empty price band, no cheap player, cheapest-offer cap cannot be guaranteed).
* **Save** writes `src/data/players.json`, `src/data/traits.json` and `public/players/*.webp` with stable key
  order and 2-space indent. It then shows the git commands to run — **the editor never runs git**:

  ```bash
  git add src/data/players.json src/data/traits.json public/players
  git commit -m "Update player database"
  git push
  ```

Security: the admin API is a Vite dev-server middleware (`apply: 'serve'`), only accepts loopback connections
(with Host/Origin checks against DNS rebinding), re-validates data server-side and sanitises ids. `/admin` is a separate
HTML entry outside `src/`; neither it nor the API exists in `npm run build` output (CI verifies this).

## Balance & simulation

* Everything tunable lives in `src/data/balance.json` (hand table, hand size, discards, play limit, duels per half,
  timers, budget, price bands, market rules, price weights, pricing curve) and `src/data/traits.json`.
* `npm run sim` runs thousands of AI-vs-AI matches and Monte Carlo trait measurements and writes
  **`reports/balance.md`**: hand frequencies, per-template uplift at min/default/max, per-player duel win rates,
  tier matrix, budget-valid spending strategies, deck-recycling frequency, node usage. Flags: `--quick`,
  `--matches N`, `--samples N`, `--tier N`.
* `npm run seed` regenerates the placeholder roster (`scripts/seed-players.ts`); `npx tsx scripts/probe.ts '<json>'`
  measures candidate traits; `npx tsx scripts/format-data.ts` rewrites the data files in the admin's stable format.
* Design decisions made while implementing are in [DECISIONS.md](DECISIONS.md).

## Deploying (free, no GitHub Actions needed)

The game is a plain static site (`npm run build` → `dist/`). Hosting does not affect online play: matchmaking uses the public
PeerJS broker and players connect peer-to-peer over WebRTC. The host only needs to serve the files over **HTTPS** (all options below do).

**Option A — Cloudflare Pages (recommended: free, unlimited bandwidth, builds on their servers)**
1. dash.cloudflare.com → *Workers & Pages* → *Create* → *Pages* → *Connect to Git* → pick this repository.
2. Build command `npm run build`, output directory `dist`, environment variable `NODE_VERSION=22` (the repo's `.node-version` also sets it).
3. Every push to `main` redeploys. You get `https://<project>.pages.dev`.

**Option B — Netlify**: *Add new site → Import from Git*. `netlify.toml` already contains the settings.
(Or drag the `dist/` folder onto https://app.netlify.com/drop — no Git at all.)

**Option C — Vercel**: *Add New → Project*, framework preset *Vite*, defaults are fine.

**Option D — deploy from your machine, no CI and no Git integration**
```bash
npm run build
npx wrangler pages deploy dist --project-name poker-pitch     # Cloudflare (free account, `wrangler login` once)
# or: npx netlify-cli deploy --dir=dist --prod
# or: npx surge dist poker-pitch.surge.sh
```

**GitHub Pages** still works (`.github/workflows/deploy.yml`), but the free tier needs a public repository and uses Actions minutes.
If you do not want it, delete that workflow file. After editing players in `/admin`, commit and push; the host rebuilds and ships the new database
(or rebuild + redeploy with option D).

`public/_headers` keeps `sw.js`, `index.html` and the manifest uncached on Cloudflare/Netlify so installed PWAs pick up new versions, and caches hashed assets forever.
The build uses a relative `base` (`./`), so it works at a domain root or under a sub-path. Set `BASE_PATH=/<path>/` for absolute asset paths.

## Optional browser smoke tests

`npx playwright install chromium`, start `npm run dev`, then e.g. `node scripts/ui-fullmatch.mjs http://localhost:5173/ shots desktop`
(plays a whole match through the real UI), `scripts/admin-smoke.mjs` (admin) or `scripts/online-smoke.mjs`
(two browsers over WebRTC; run with a local broker, see above) and `scripts/pwa-smoke.mjs` (production preview: manifest, service worker, offline reload).

## License

Code: do what you like. All player data is fictional placeholder content.
