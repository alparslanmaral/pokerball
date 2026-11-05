import { parseCard } from './cards';
import type { CardId, HandId } from './types';
import { chipValue } from './cards';
import type { Balance } from './types';

export interface HandEval {
  hand: HandId;
  /** Cards that form the hand (the only ones that score / trigger traits). */
  scoring: CardId[];
}

/** Classify 1-5 cards. Straights and flushes need exactly 5 cards. */
export function evaluateHand(ids: CardId[], balance: Balance): HandEval {
  const cards = ids.map(parseCard);
  const n = cards.length;
  if (n === 0) throw new Error('Cannot evaluate an empty hand');

  const groups = new Map<number, CardId[]>();
  for (const c of cards) {
    const g = groups.get(c.rank);
    if (g) g.push(c.id);
    else groups.set(c.rank, [c.id]);
  }
  const sorted = [...groups.entries()].sort((a, b) => b[1].length - a[1].length || b[0] - a[0]);
  const counts = sorted.map((g) => g[1].length);

  if (n === 5) {
    const flush = cards.every((c) => c.suit === cards[0].suit);
    const ranks = cards.map((c) => c.rank).sort((a, b) => a - b);
    const distinct = new Set(ranks).size === 5;
    const wheel = ranks.join() === '2,3,4,5,14';
    const straight = distinct && (ranks[4] - ranks[0] === 4 || wheel);
    if (straight && flush) return { hand: 'straight_flush', scoring: ids.slice() };
    if (counts[0] === 4) return { hand: 'four_of_a_kind', scoring: sorted[0][1] };
    if (counts[0] === 3 && counts[1] === 2) return { hand: 'full_house', scoring: ids.slice() };
    if (flush) return { hand: 'flush', scoring: ids.slice() };
    if (straight) return { hand: 'straight', scoring: ids.slice() };
  } else if (counts[0] === 4) {
    return { hand: 'four_of_a_kind', scoring: sorted[0][1] };
  }
  if (counts[0] === 3) return { hand: 'three_of_a_kind', scoring: sorted[0][1] };
  if (counts[0] === 2 && counts[1] === 2) return { hand: 'two_pair', scoring: [...sorted[0][1], ...sorted[1][1]] };
  if (counts[0] === 2) return { hand: 'pair', scoring: sorted[0][1] };

  // High card: only the single best card scores.
  const best = cards.reduce((a, b) => {
    const ca = chipValue(a, balance);
    const cb = chipValue(b, balance);
    return cb > ca || (cb === ca && b.rank > a.rank) ? b : a;
  });
  return { hand: 'high_card', scoring: [best.id] };
}
