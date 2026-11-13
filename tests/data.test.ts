import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { balance, catalog, ctx, dbVersionHash, hashData, playerList } from '../src/data';
import { bandIndexOf, cheapestSum, generateMarket } from '../src/engine/market';
import { Rng } from '../src/engine/rng';
import { serializePlayers, serializeTraits } from '../src/engine/serialize';
import { suggestPrice } from '../src/engine/power';
import { POSITIONS } from '../src/engine/types';
import { validateDb } from '../src/engine/validate';

const file = (p: string) => readFileSync(new URL(`../src/data/${p}`, import.meta.url), 'utf8');

describe('shipped game data', () => {
  it('passes validation without errors', () => {
    const report = validateDb(ctx, playerList);
    expect(report.errors).toEqual([]);
  });

  it('has no market-feasibility warnings', () => {
    expect(validateDb(ctx, playerList).warnings).toEqual([]);
  });

  it('is stored in the stable format the admin editor writes (clean git diffs)', () => {
    expect(file('players.json')).toBe(serializePlayers(playerList, catalog));
    expect(file('traits.json')).toBe(serializeTraits(catalog));
  });

  it('generates valid markets for any seed', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const m = generateMarket(ctx, new Rng(seed));
      expect(cheapestSum(ctx, m)).toBeLessThanOrEqual(balance.cheapestSumCap);
      for (const pos of POSITIONS) expect(m[pos]).toHaveLength(balance.offersPerPosition);
    }
  });

  it('covers every price band for every position', () => {
    for (const pos of POSITIONS)
      for (let b = 0; b < balance.priceBands.length; b++)
        expect(playerList.some((p) => p.position === pos && bandIndexOf(balance, p.price) === b)).toBe(true);
  });

  it('data hash is stable and sensitive to changes', () => {
    expect(dbVersionHash).toBe(hashData(playerList, balance, catalog));
    const changed = playerList.map((p, i) => (i === 0 ? { ...p, price: p.price + 1 } : p));
    expect(hashData(changed, balance, catalog)).not.toBe(dbVersionHash);
    // key order must not matter
    const reordered = playerList.map(({ trait, price, id, firstName, lastName, position, ...rest }) => ({
      ...rest,
      trait,
      price,
      id,
      firstName,
      lastName,
      position,
    }));
    expect(hashData(reordered, balance, catalog)).toBe(dbVersionHash);
  });

  it('suggested prices stay inside the configured range', () => {
    expect(suggestPrice(balance, 0)).toBe(balance.pricing.minPrice);
    expect(suggestPrice(balance, 99)).toBe(balance.pricing.maxPrice);
  });
});

describe('validation rules', () => {
  const base = playerList.find((p) => p.position === 'MID')!;
  it('blocks duplicate ids, missing names, bad prices, out-of-bounds params and weak keepers', () => {
    const dup = validateDb(ctx, [base, { ...base }]);
    expect(dup.errors.some((e) => e.message.includes('duplicate'))).toBe(true);
    const noName = validateDb(ctx, [{ ...base, firstName: '', lastName: '' }]);
    expect(noName.errors.some((e) => e.message.includes('missing first name'))).toBe(true);
    expect(validateDb(ctx, [{ ...base, price: 0 }]).errors).not.toEqual([]);
    expect(validateDb(ctx, [{ ...base, price: 12.5 }]).errors).not.toEqual([]);
    const oob = { ...base, trait: { type: 'chips_per_scoring_face', params: { chips: 500 } } };
    expect(validateDb(ctx, [oob]).errors).not.toEqual([]);
    const gk = playerList.find((p) => p.position === 'GK')!;
    const sameHand = { ...gk, trait: { type: 'keeper_hand_bonus', params: { bonuses: [{ hand: 'pair', chips: 10, mult: 1 }, { hand: 'pair', chips: 10, mult: 1 }] } } };
    expect(validateDb(ctx, [sameHand]).errors).not.toEqual([]);
  });

  it('warns (without erroring) about thin markets', () => {
    const few = playerList.filter((p) => !(p.position === 'GK' && p.price > 12));
    const r = validateDb(ctx, few);
    expect(r.errors).toEqual([]);
    expect(r.warnings.some((w) => w.includes('GK') && w.includes('empty'))).toBe(true);
  });
});
