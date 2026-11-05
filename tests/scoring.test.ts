import { describe, expect, it } from 'vitest';
import { balance, catalog } from '../src/data';
import { scoreHand } from '../src/engine/scoring';
import { describeTrait, traitModifiers, validateTrait } from '../src/engine/traits';
import type { Trait } from '../src/engine/types';
import { cards } from './fixtures';

const score = (hand: string, activeTrait: Trait | null = null, keeperTrait: Trait | null = null, discardsLeft = 3) =>
  scoreHand(balance, { cards: cards(hand), activeTrait, keeperTrait, discardsLeft });

describe('scoring', () => {
  it('scores a plain high card: (5 + 11) x 1', () => {
    const r = score('AS 2D 3C');
    expect(r.hand).toBe('high_card');
    expect(r.chips).toBe(16);
    expect(r.mult).toBe(1);
    expect(r.score).toBe(16);
  });

  it('pair only counts the two paired cards: (10 + 9 + 9) x 2', () => {
    expect(score('9S 9H AC 8D 2S').score).toBe((10 + 18) * 2);
  });

  it('face cards count 10, aces 11', () => {
    expect(score('KS KH').chips).toBe(10 + 20);
    expect(score('AS AH').chips).toBe(10 + 22);
  });

  it('flush: 35 + all five cards, x4', () => {
    const r = score('2S 5S 8S JS KS');
    expect(r.hand).toBe('flush');
    expect(r.score).toBe((35 + 2 + 5 + 8 + 10 + 10) * 4);
  });

  it('additive chips and mult are applied before xmult', () => {
    const t: Trait = { type: 'xmult_on_hand_type', params: { hands: ['pair'], xmult: 1.5 } };
    const k: Trait = { type: 'keeper_hand_bonus', params: { bonuses: [{ hand: 'pair', chips: 10, mult: 1 }, { hand: 'flush', chips: 5, mult: 1 }] } };
    const r = score('9S 9H', t, k);
    expect(r.chips).toBe(10 + 18 + 10);
    expect(r.mult).toBe((2 + 1) * 1.5);
    expect(r.score).toBe(38 * 4.5);
  });

  it('traits only trigger on scoring cards, not kickers', () => {
    const face: Trait = { type: 'chips_per_scoring_face', params: { chips: 20 } };
    // pair of nines with a King kicker: the King does not trigger
    expect(score('9S 9H KC', face).chips).toBe(10 + 18);
    // pair of kings triggers twice
    expect(score('KS KH 2C', face).chips).toBe(10 + 20 + 40);
  });

  it('suit and rank-group traits', () => {
    const spades: Trait = { type: 'mult_per_scoring_suit', params: { suit: 'spades', mult: 2 } };
    expect(score('9S 9H', spades).mult).toBe(2 + 2);
    const even: Trait = { type: 'mult_per_scoring_rank_group', params: { group: 'even', mult: 1 } };
    expect(score('8S 8H', even).mult).toBe(2 + 2);
    expect(score('9S 9H', even).mult).toBe(2);
    const odd: Trait = { type: 'mult_per_scoring_rank_group', params: { group: 'odd', mult: 1 } };
    expect(score('AS AH', odd).mult).toBe(2 + 2);
    expect(score('KS KH', odd).mult).toBe(2);
    const ace: Trait = { type: 'chips_per_scoring_ace', params: { chips: 10 } };
    expect(score('AS AH', ace).chips).toBe(10 + 22 + 20);
    const suitChips: Trait = { type: 'chips_per_scoring_suit', params: { suit: 'hearts', chips: 5 } };
    expect(score('9S 9H', suitChips).chips).toBe(10 + 18 + 5);
  });

  it('hand-type traits', () => {
    const c: Trait = { type: 'chips_on_hand_type', params: { hands: ['pair', 'flush'], chips: 30 } };
    expect(score('9S 9H', c).chips).toBe(10 + 18 + 30);
    expect(score('AS', c).chips).toBe(5 + 11);
    const m: Trait = { type: 'mult_on_hand_type', params: { hands: ['pair'], mult: 5 } };
    expect(score('9S 9H', m).mult).toBe(7);
  });

  it('unused discards and minimalist traits', () => {
    const unused: Trait = { type: 'mult_per_unused_discard', params: { mult: 2 } };
    expect(score('9S 9H', unused, null, 3).mult).toBe(2 + 6);
    expect(score('9S 9H', unused, null, 0).mult).toBe(2);
    const mini: Trait = { type: 'mult_if_cards_played_at_most', params: { n: 2, mult: 4 } };
    expect(score('9S 9H', mini).mult).toBe(6);
    expect(score('9S 9H 3C', mini).mult).toBe(2);
  });

  it('keeper bonuses apply only to the listed hands', () => {
    const k: Trait = { type: 'keeper_hand_bonus', params: { bonuses: [{ hand: 'pair', chips: 20, mult: 1 }, { hand: 'flush', chips: 15, mult: 2 }] } };
    expect(score('9S 9H', null, k).score).toBe((10 + 18 + 20) * 3);
    expect(score('9S 4H', null, k).score).toBe(5 + 9);
  });

  it('extra discards / hand size are exposed as modifiers', () => {
    expect(traitModifiers({ type: 'extra_discards', params: { amount: 2 } })).toEqual({ extraDiscards: 2, extraHandSize: 0 });
    expect(traitModifiers({ type: 'extra_hand_size', params: { amount: 1 } })).toEqual({ extraDiscards: 0, extraHandSize: 1 });
    expect(traitModifiers(null)).toEqual({ extraDiscards: 0, extraHandSize: 0 });
  });
});

describe('trait catalog', () => {
  it('describes traits with their parameters', () => {
    const d = describeTrait({ type: 'mult_per_scoring_rank_group', params: { group: 'even', mult: 2 } }, catalog, balance);
    expect(d).toBe('+2 mult for each scoring even card');
    const k = describeTrait(
      { type: 'keeper_hand_bonus', params: { bonuses: [{ hand: 'pair', chips: 20, mult: 1 }, { hand: 'flush', chips: 15, mult: 2 }] } },
      catalog,
      balance,
    );
    expect(k).toContain('Pair +20 chips +1 mult');
  });

  it('validates params, positions and keeper rules', () => {
    expect(validateTrait({ type: 'chips_per_scoring_face', params: { chips: 15 } }, 'MID', catalog)).toEqual([]);
    expect(validateTrait({ type: 'chips_per_scoring_face', params: { chips: 999 } }, 'MID', catalog)).not.toEqual([]);
    expect(validateTrait({ type: 'chips_per_scoring_face', params: { chips: 15 } }, 'GK', catalog)).not.toEqual([]);
    const kp = (hands: string[]) => ({
      type: 'keeper_hand_bonus',
      params: { bonuses: hands.map((hand) => ({ hand, chips: 10, mult: 1 })) },
    });
    expect(validateTrait(kp(['pair', 'pair']), 'GK', catalog)).not.toEqual([]);
    expect(validateTrait(kp(['pair']), 'GK', catalog)).not.toEqual([]);
    expect(validateTrait(kp(['pair', 'flush']), 'GK', catalog)).toEqual([]);
    expect(validateTrait(kp(['pair', 'flush']), 'MID', catalog)).not.toEqual([]);
  });
});
