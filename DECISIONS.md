# Decisions log

Gaps, contradictions and judgement calls found while implementing the brief. Each entry: **issue → choice → why**.
Numbers come from `reports/balance.md` (`npm run sim`).

## Rules and engine

1. **Who triggers the next duel / reveal timing.** The brief has a reveal sequence but no rule for when the next duel starts.
   → The engine has explicit `reveal` and `halftime` phases; both players send `continue` (the UI sends it after the animation
   or on "Skip"; the AI after 3.5–4.5 s; the host forces it after 12 s / 24 s). → The 15 s ready timer can never be eaten by an
   animation, and the next duel is dealt deterministically.
2. **Timers in a pure engine.** → Actions carry `at` (host clock). The engine stores a `deadline` and a `timeout` action resolves
   it; the host (`GameHost`) owns the real `setTimeout`. Clients get *remaining* milliseconds in their projection (no clock sync needed).
3. **Auto-play on timeout** = the single highest-*chip* card of the current hand (ties → higher rank), scored normally with traits,
   even if the slow player had selected something else (as specified). Shot timeout = random zone.
4. **Discard mechanics.** Replacements are drawn in place (slots keep their layout). Discarded cards are held outside the deck until the
   duel ends, so they cannot be redrawn in the same duel. If the deck is too short, the played pile is shuffled back in first
   (this happens in ~0.5 % of halves in simulation, essentially only after long tie streaks).
5. **Ties.** Replay at the same node with a fresh draw; played cards stay out of the deck; ties do not count toward the 8 duels.
   Scores can be fractional (xMult), they are rounded to 2 decimals before comparing. Tie rate in simulation ≈ 1 %.
6. **Pending shot at the end of a half.** The 8th resolved duel may create a shot; it is played before halftime/fulltime.
7. **Hand-size / discard traits** (`extra_hand_size`, `extra_discards`) apply only while that player is the *active* player of the
   duel (a MID's bonus applies at midfield duels, not at a forward duel). Keepers never grant these.
8. **High card** scores only the best chip card; J/Q/K tie on chips, so the higher rank is chosen. Straights use A-2-3-4-5 and 10-J-Q-K-A, no wrap-around.
9. **Rematch** needs both players; the AI votes automatically. A new match gets a fresh random market and $100.
10. **Disconnect after full time** keeps the result screen (the match was already recorded); rematch is disabled. A disconnect earlier voids the match (not recorded).

## Market

11. **Empty price band** → the nearest non-empty band supplies the offer (no duplicates inside one market). If a position has fewer
    distinct players than offers, it shows fewer offers. The cheapest-sum cap is enforced by re-rolling up to 300 times, then the best
    draw is kept (admin warns when the DB makes the cap impossible).
12. **Band assignment for prices in gaps** (e.g. $13–17) → nearest band, ties go to the cheaper band.
13. **Purchase rule when swapping.** Replacing a signed player recomputes the budget without the old pick, so you can always step down in price.
14. **Ready** requires every position that has at least one offer to be filled.

## Balance (see reports/balance.md)

15. **Power metric = duel win probability**, not average score uplift. Average score is dominated by rare huge hands (a flat +100 chips on
    straight flushes looked "strong" but never changes a duel), and it systematically under-rated traits that lift *low* hands
    (e.g. +6 mult on Pair/Two Pair gives ~83 % duel win probability but only +85 % average score). Power = `2·(P(win vs. a trait-less hand) − 0.5)`
    × price weight × template `powerWeight`, measured with exact all-pairs comparison over Monte Carlo samples.
16. **`priceWeights`** (GK 1.0, MID 0.75, DEF 0.65, FWD 0.65) replace the first draft's "usage weights". Measured duel usage is
    GK 100 % / MID 50 % / DEF 25 % / FWD 25 % of duels, but pricing by raw frequency would leave DEF/FWD unable to reach the upper price
    bands with in-bounds traits. The weights blend frequency and peak impact; MID is the highest-weighted field position because it is
    the most frequent, and DEF/FWD traits are allowed to be stronger per trigger, as the brief asks. *Finding:* legend DEF/FWD squads
    perform slightly worse than legend MID/GK squads (47–49 % vs 54–55 %), so the DEF/FWD weight could be lowered to ~0.5 when the real roster arrives.
17. **Trait bounds were tightened** from the first draft after measurement: per-scoring-card mult max 2 (3 gave +125–160 % uplift),
    `mult_on_hand_type` max 8 on at most 2 hands, `mult_if_cards_played_at_most` n ≤ 3, xMult 1.2–2.5 on at most 3 hands, `mult_per_unused_discard` max 2.
18. **Keeper bounds do not follow "rare hand = bigger bonus" strictly.** With 8 cards and 3 discards the best play is Two Pair 29 %, Full House 19 %,
    Straight 16 %, Flush 15 %, Pair 13 %, High Card 3.5 %, Three of a Kind 3.5 %, Four of a Kind 1.1 %, Straight Flush 0.2 %. So Two Pair/Straight/Flush/Full House
    are *common* and get tight bounds (a keeper boosting Two Pair +30/+2 and Flush +40/+3 reached 76 % duel win probability — far too strong), while Four of a Kind and
    Straight Flush keep big bounds but are almost worthless (a 4K+SF keeper is ≈ 0 power) — they are lottery tickets, priced accordingly.
19. **Hand table unchanged** (as specified), although the AI's Pair/Three of a Kind are rare because a 8-card hand almost always contains something better. Human players
    will play more pairs than the AI does.
20. **Pricing curve**: power 0 → $5, power 0.3 → $60 (`pricing` in balance.json). Seeds were generated from the measured power and each (position, band)
    has two players, so every market has a full set of 4 distinct bands.

## Data, admin, tooling

21. **DB version hash** is computed at runtime (FNV-1a over a key-order-independent dump of players + balance + trait catalog) from the bundled JSON, which is
    identical to hashing at build time and also correct in dev after the admin edits files. Balance and catalog are included because they change gameplay.
22. **Admin location**: a separate HTML entry in `admin/` (outside `src/`), served only by the dev server; the API plugin has `apply: 'serve'`. The plugin loads engine
    modules via `server.ssrLoadModule` so `vite.config.ts` has no TS import graph. It validates server-side too, so a bad client cannot write invalid data.
23. **Images**: `image` is omitted from JSON for players without a picture; ids are restricted to `[a-z0-9_-]` and the id is fixed after a player is saved (the image file is named after it).
24. **Stable diffs**: `scripts/format-data.ts` and the admin writer share `engine/serialize.ts`; a test asserts the committed JSON files are byte-identical to the serializer output.
25. **Milestone commits**: the UI imports the online transport, so the networking files (`src/net/peer.ts`, `session.ts`, `protocol.ts`) were committed with milestone 3 and
    exercised/fixed in milestone 5.

## Online mode

26. **Room code is shown only after the broker accepted the peer id** (a guest joining earlier got "room not found"); opening times out after 15 s, joining after 20 s.
27. **Protocol robustness**: the host whitelists intent types and always overwrites `side`/`at`, so a guest cannot forge `timeout` or act for the host. Heartbeat 3 s, dead after 12 s.
28. **Reconnect** is not implemented (as specified). **No TURN**: documented in the UI footnote and README.
29. **Testing**: network logic is written against an abstract `Channel`, tested in-memory (handshake, hash mismatch, projection secrecy, forged intents, silent loss). The PeerJS adapter
    was verified manually with two Chromium contexts over real WebRTC using a local PeerJS server (`npm run peer-server`); the public broker is occasionally slow/unreachable from some environments.

## UI

30. **Perspective**: the pitch is always drawn from the local player's side (my defence on the left, my attack on the right), whichever of A/B I am.
31. **Opponent squad** is hidden during the transfer phase and visible afterwards (the duel panel also shows the opposing active player).
32. **Names** are trimmed to 20 characters; duplicate names are allowed. The username doubles as team name and is saved in localStorage.
33. **Sort buttons** (deal/rank/suit) were added to the hand for usability; they only reorder the display.
