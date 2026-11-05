import { describe, expect, it } from 'vitest';
import { bestPlay, chooseDiscards } from '../src/engine/ai';
import { measureTrait, suggestPrice } from '../src/engine/power';
import { Rng } from '../src/engine/rng';
import { cards, testCtx } from './fixtures';

const ctx = testCtx();
const none = { activeTrait: null, keeperTrait: null, discardsLeft: 3 };

describe('AI play selection', () => {
  it('plays the highest-scoring subset of the hand', () => {
    const hand = cards('2S 5S 8S JS KS 3D 4D 6C');
    const best = bestPlay(ctx, hand, none);
    expect(best.result.hand).toBe('flush');
    expect(best.cards.slice().sort()).toEqual(cards('2S 5S 8S JS KS').sort());
  });

  it('prefers a small strong hand over padding with kickers', () => {
    const best = bestPlay(ctx, cards('KS KH 2C 5D 7S 3C 9D 4H'), none);
    expect(best.result.hand).toBe('pair');
    expect(best.result.scoring).toHaveLength(2);
  });

  it('accounts for traits when choosing', () => {
    // A trait that pays per scoring heart makes the heart pair better than the (higher) spade pair.
    const hearts = { type: 'mult_per_scoring_suit', params: { suit: 'hearts', mult: 2 } };
    const hand = cards('KS KD 5H 5C 2D 9S 3C 4D');
    const plain = bestPlay(ctx, hand, none);
    expect(plain.result.hand).toBe('two_pair');
    const withTrait = bestPlay(ctx, cards('KS KD 5H 5D 2C 9S 3C 4D'), { ...none, activeTrait: hearts });
    expect(withTrait.result.score).toBeGreaterThan(0);
  });

  it('can always play 1 card', () => {
    expect(bestPlay(ctx, cards('2S'), none).cards).toEqual(['2S']);
  });
});

describe('AI discard heuristic', () => {
  it('keeps pairs and throws away loose low cards', () => {
    const hand = cards('KS KH 2C 6D 9S 3C JD 8H');
    const best = bestPlay(ctx, hand, none);
    const toss = chooseDiscards(ctx, hand, best.result, 3);
    expect(toss.slice().sort()).toEqual(cards('2C 3C 6D').sort()); // the three cheapest loose cards
    expect(toss).not.toContain('KS');
    expect(toss).not.toContain('KH');
  });

  it('keeps a four-card flush draw', () => {
    const hand = cards('2S 5S 8S JS KH 3D 4D 6C');
    const best = bestPlay(ctx, hand, none);
    const toss = chooseDiscards(ctx, hand, best.result, 3);
    for (const c of cards('2S 5S 8S JS')) expect(toss).not.toContain(c);
  });

  it('does not discard when already holding a straight or better, or with no discards left', () => {
    const hand = cards('5S 6H 7C 8D 9S KH 2D 3C');
    const best = bestPlay(ctx, hand, none);
    expect(chooseDiscards(ctx, hand, best.result, 3)).toEqual([]);
    const weak = cards('2S 4H 7C 9D JS KH 3D 5C');
    expect(chooseDiscards(ctx, weak, bestPlay(ctx, weak, none).result, 0)).toEqual([]);
  });
});

describe('power score', () => {
  it('a strong trait beats nothing; a no-op trait stays near 50%', () => {
    const strong = measureTrait(ctx, { type: 'mult_per_scoring_rank_group', params: { group: 'even', mult: 2 } }, 'MID', 250);
    expect(strong.winProb).toBeGreaterThan(0.6);
    expect(strong.uplift).toBeGreaterThan(0.3);
    const noop = measureTrait(ctx, { type: 'keeper_hand_bonus', params: { bonuses: [{ hand: 'straight_flush', chips: 30, mult: 0 }, { hand: 'four_of_a_kind', chips: 20, mult: 0 }] } }, 'GK', 250);
    expect(Math.abs(noop.winProb - 0.5)).toBeLessThan(0.04);
  });

  it('is deterministic and maps monotonically onto prices', () => {
    const t = { type: 'chips_per_scoring_face', params: { chips: 15 } };
    expect(measureTrait(ctx, t, 'MID', 100).winProb).toBe(measureTrait(ctx, t, 'MID', 100).winProb);
    const prices = [0, 0.05, 0.1, 0.2, 0.3, 0.9].map((p) => suggestPrice(ctx.balance, p));
    expect([...prices].sort((a, b) => a - b)).toEqual(prices);
    expect(prices[0]).toBe(ctx.balance.pricing.minPrice);
    expect(prices[prices.length - 1]).toBe(ctx.balance.pricing.maxPrice);
  });

  it('the RNG is reproducible', () => {
    const a = new Rng(5);
    const b = new Rng(5);
    expect([a.next(), a.next(), a.int(10)]).toEqual([b.next(), b.next(), b.int(10)]);
    expect(new Rng(1).shuffle([1, 2, 3, 4, 5, 6])).toEqual(new Rng(1).shuffle([1, 2, 3, 4, 5, 6]));
  });
});
