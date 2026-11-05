import type { Rng } from './rng';
import type { Balance, GameContext, Market, Player, Position, Squad } from './types';
import { POSITIONS } from './types';

/** Index of the price band a price belongs to (nearest band if it falls in a gap). */
export function bandIndexOf(balance: Balance, price: number): number {
  let best = 0;
  let bestDist = Infinity;
  balance.priceBands.forEach((b, i) => {
    const d = price < b.min ? b.min - price : price > b.max ? price - b.max : 0;
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  });
  return best;
}

export function playersAt(ctx: GameContext, position: Position): Player[] {
  return Object.values(ctx.players).filter((p) => p.position === position);
}

function emptyMarket(): Market {
  return { GK: [], DEF: [], MID: [], FWD: [] };
}

export function cheapestPrice(ctx: GameContext, ids: string[]): number {
  return ids.length === 0 ? 0 : Math.min(...ids.map((id) => ctx.players[id].price));
}

export function cheapestSum(ctx: GameContext, market: Market): number {
  return POSITIONS.reduce((s, pos) => s + cheapestPrice(ctx, market[pos]), 0);
}

/** One random draw: one offer per price band for every position. */
function drawMarket(ctx: GameContext, rng: Rng): Market {
  const { balance } = ctx;
  const market = emptyMarket();
  const bandCount = balance.priceBands.length;
  for (const pos of POSITIONS) {
    const all = playersAt(ctx, pos);
    const byBand: Player[][] = balance.priceBands.map(() => []);
    for (const p of all) byBand[bandIndexOf(balance, p.price)].push(p);

    const chosen: Player[] = [];
    const want = Math.min(balance.offersPerPosition, bandCount, all.length);
    for (let b = 0; b < bandCount && chosen.length < want; b++) {
      // Nearest non-empty band that still has an unchosen player.
      let pool: Player[] = [];
      for (let d = 0; d < bandCount && pool.length === 0; d++) {
        for (const idx of [b - d, b + d]) {
          if (idx < 0 || idx >= bandCount) continue;
          pool = pool.concat(byBand[idx].filter((p) => !chosen.includes(p)));
        }
      }
      if (pool.length) chosen.push(rng.pick(pool));
    }
    // Still short (fewer players in the bands than requested)? Top up from anyone left.
    while (chosen.length < want) {
      const rest = all.filter((p) => !chosen.includes(p));
      if (!rest.length) break;
      chosen.push(rng.pick(rest));
    }
    chosen.sort((a, b) => a.price - b.price || a.id.localeCompare(b.id));
    market[pos] = chosen.map((p) => p.id);
  }
  return market;
}

/**
 * Generates a team's market: per position, one offer per price band, re-rolled until the sum of
 * the cheapest offers fits under `cheapestSumCap`. Falls back to the best draw seen.
 */
export function generateMarket(ctx: GameContext, rng: Rng, maxAttempts = 300): Market {
  let best: Market | null = null;
  let bestSum = Infinity;
  for (let i = 0; i < maxAttempts; i++) {
    const m = drawMarket(ctx, rng);
    const sum = cheapestSum(ctx, m);
    if (sum <= ctx.balance.cheapestSumCap) return m;
    if (sum < bestSum) {
      best = m;
      bestSum = sum;
    }
  }
  return best!;
}

export function spent(ctx: GameContext, squad: Squad, except?: Position): number {
  let s = 0;
  for (const pos of POSITIONS) {
    const id = squad[pos];
    if (id && pos !== except) s += ctx.players[id].price;
  }
  return s;
}

export function budgetLeft(ctx: GameContext, squad: Squad): number {
  return ctx.balance.budget - spent(ctx, squad);
}

/**
 * Purchase rule: after buying, the remaining budget must still cover the cheapest offers of every
 * other unfilled position of this team's own market.
 */
export function canBuy(ctx: GameContext, market: Market, squad: Squad, playerId: string): boolean {
  const p = ctx.players[playerId];
  if (!p || !market[p.position].includes(playerId)) return false;
  const remaining = ctx.balance.budget - spent(ctx, squad, p.position) - p.price;
  if (remaining < 0) return false;
  let required = 0;
  for (const pos of POSITIONS) {
    if (pos === p.position || squad[pos]) continue;
    required += cheapestPrice(ctx, market[pos]);
  }
  return remaining >= required;
}

export function squadComplete(market: Market, squad: Squad): boolean {
  return POSITIONS.every((pos) => market[pos].length === 0 || !!squad[pos]);
}
