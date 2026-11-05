import { describe, expect, it } from 'vitest';
import { bandIndexOf, canBuy, cheapestSum, generateMarket, spent } from '../src/engine/market';
import { Rng } from '../src/engine/rng';
import { POSITIONS } from '../src/engine/types';
import { testCtx } from './fixtures';

const ctx = testCtx();

describe('market generation', () => {
  it('offers one player per price band for every position', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const m = generateMarket(ctx, new Rng(seed));
      for (const pos of POSITIONS) {
        expect(m[pos]).toHaveLength(4);
        const bands = m[pos].map((id) => bandIndexOf(ctx.balance, ctx.players[id].price)).sort();
        expect(bands).toEqual([0, 1, 2, 3]);
        expect(new Set(m[pos]).size).toBe(4);
      }
    }
  });

  it('guarantees the cheapest-offer sum cap', () => {
    for (let seed = 1; seed <= 200; seed++) {
      expect(cheapestSum(ctx, generateMarket(ctx, new Rng(seed)))).toBeLessThanOrEqual(ctx.balance.cheapestSumCap);
    }
  });

  it('falls back to the nearest band when one is empty', () => {
    const players = Object.values(ctx.players).filter((p) => !(p.position === 'MID' && p.price >= 50));
    const small = { ...ctx, players: Object.fromEntries(players.map((p) => [p.id, p])) };
    const m = generateMarket(small, new Rng(3));
    expect(m.MID).toHaveLength(4);
    expect(new Set(m.MID).size).toBe(4);
  });

  it('is deterministic for a given seed', () => {
    expect(generateMarket(ctx, new Rng(99))).toEqual(generateMarket(ctx, new Rng(99)));
  });
});

describe('purchase rule', () => {
  it('blocks purchases that would leave other positions unaffordable', () => {
    const market = generateMarket(ctx, new Rng(7));
    const legendGK = market.GK.map((id) => ctx.players[id]).find((p) => p.price >= 50)!;
    expect(canBuy(ctx, market, {}, legendGK.id)).toBe(true);
    // After buying a legend GK ($58), a legend DEF ($58) would leave < the cheapest MID+FWD
    const squad = { GK: legendGK.id };
    const legendDef = market.DEF.map((id) => ctx.players[id]).find((p) => p.price >= 50)!;
    const remainingAfter = 100 - 58 - legendDef.price;
    const need = ctx.players[market.MID[0]].price + ctx.players[market.FWD[0]].price;
    expect(canBuy(ctx, market, squad, legendDef.id)).toBe(remainingAfter >= need);
  });

  it('never gets stuck: any sequence of legal buys can finish the squad', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const rng = new Rng(seed);
      const market = generateMarket(ctx, rng);
      const squad: Record<string, string> = {};
      for (const pos of rng.shuffle(POSITIONS)) {
        const options = market[pos].filter((id) => canBuy(ctx, market, squad, id));
        expect(options.length).toBeGreaterThan(0);
        squad[pos] = rng.pick(options);
        expect(spent(ctx, squad)).toBeLessThanOrEqual(100);
      }
    }
  });

  it('rejects players not in the team\'s own market', () => {
    const market = generateMarket(ctx, new Rng(7));
    const stranger = Object.keys(ctx.players).find((id) => !market.GK.includes(id) && id.startsWith('gk'))!;
    expect(canBuy(ctx, market, {}, stranger)).toBe(false);
  });
});
