import type { Balance, Card, CardId, Suit } from './types';

const RANK_SYMBOLS = '23456789TJQKA';
export const SUIT_LIST: Suit[] = ['S', 'H', 'D', 'C'];

export const SUIT_NAMES: Record<Suit, string> = { S: 'spades', H: 'hearts', D: 'diamonds', C: 'clubs' };
export const SUIT_GLYPH: Record<Suit, string> = { S: '♠', H: '♥', D: '♦', C: '♣' };

const cache = new Map<CardId, Card>();

export function makeId(rank: number, suit: Suit): CardId {
  return RANK_SYMBOLS[rank - 2] + suit;
}

export function parseCard(id: CardId): Card {
  let c = cache.get(id);
  if (!c) {
    const rank = RANK_SYMBOLS.indexOf(id[0]) + 2;
    if (rank < 2 || !SUIT_LIST.includes(id[1] as Suit)) throw new Error(`Bad card id: ${id}`);
    c = { id, rank, suit: id[1] as Suit };
    cache.set(id, c);
  }
  return c;
}

export function rankLabel(rank: number): string {
  return rank === 10 ? '10' : RANK_SYMBOLS[rank - 2];
}

export function fullDeck(): CardId[] {
  const out: CardId[] = [];
  for (const s of SUIT_LIST) for (let r = 2; r <= 14; r++) out.push(makeId(r, s));
  return out;
}

export function chipValue(card: Card, balance: Balance): number {
  if (card.rank === 14) return balance.cards.aceChips;
  if (card.rank >= 11) return balance.cards.faceCardChips;
  return card.rank;
}

export function isFace(card: Card): boolean {
  return card.rank >= 11 && card.rank <= 13;
}

export function isEvenRank(card: Card): boolean {
  return card.rank <= 10 && card.rank % 2 === 0;
}

export function isOddRank(card: Card): boolean {
  return card.rank === 14 || (card.rank <= 9 && card.rank % 2 === 1);
}
