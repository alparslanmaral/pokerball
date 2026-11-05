import { describe, expect, it } from 'vitest';
import { balance } from '../src/data';
import { evaluateHand } from '../src/engine/hands';
import { cards } from './fixtures';

const ev = (s: string) => evaluateHand(cards(s), balance);

describe('hand evaluation', () => {
  it('recognizes every hand type', () => {
    expect(ev('AS').hand).toBe('high_card');
    expect(ev('9S 9H').hand).toBe('pair');
    expect(ev('9S 9H 4C 4D').hand).toBe('two_pair');
    expect(ev('9S 9H 9C').hand).toBe('three_of_a_kind');
    expect(ev('9S 9H 9C 9D').hand).toBe('four_of_a_kind');
    expect(ev('5S 6H 7C 8D 9S').hand).toBe('straight');
    expect(ev('2S 6S 9S JS KS').hand).toBe('flush');
    expect(ev('9S 9H 9C 4D 4S').hand).toBe('full_house');
    expect(ev('9S 9H 9C 9D 4S').hand).toBe('four_of_a_kind');
    expect(ev('5S 6S 7S 8S 9S').hand).toBe('straight_flush');
  });

  it('aces count high and low in straights, but there is no wrap-around', () => {
    expect(ev('AS 2H 3C 4D 5S').hand).toBe('straight');
    expect(ev('TS JH QC KD AS').hand).toBe('straight');
    expect(ev('QS KH AC 2D 3S').hand).toBe('high_card');
    expect(ev('KS AH 2C 3D 4S').hand).toBe('high_card');
  });

  it('needs exactly five cards for straights and flushes', () => {
    expect(ev('5S 6H 7C 8D').hand).toBe('high_card');
    expect(ev('2S 6S 9S JS').hand).toBe('high_card');
  });

  it('three or four cards of a kind are valid with fewer than 5 cards', () => {
    expect(ev('9S 9H 9C 2D').hand).toBe('three_of_a_kind');
    expect(ev('9S 9H 9C 9D 2S').scoring).toHaveLength(4);
  });

  it('only cards that form the hand score; kickers do not', () => {
    expect(ev('9S 9H 2C 5D 7S').scoring.sort()).toEqual(['9H', '9S']);
    expect(ev('9S 9H 4C 4D KS').scoring).toHaveLength(4);
    expect(ev('9S 9H 9C 2D 5S').scoring).toHaveLength(3);
    expect(ev('5S 6H 7C 8D 9S').scoring).toHaveLength(5);
  });

  it('high card scores only the single best chip card', () => {
    expect(ev('2S 7H KD').scoring).toEqual(['KD']);
    expect(ev('2S AH KD').scoring).toEqual(['AH']);
    // J/Q/K are equal in chips, the higher rank wins the tie
    expect(ev('JS KH QD').scoring).toEqual(['KH']);
  });

  it('a pair beats nothing: pair of the lowest rank still classified as pair', () => {
    expect(ev('2S 2H 3C 5D 9S').hand).toBe('pair');
  });
});
