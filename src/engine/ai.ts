import { chipValue, parseCard } from './cards';
import { canBuy, squadComplete } from './market';
import { activeTrait, playerTrait } from './match';
import type { Rng } from './rng';
import { scoreHand } from './scoring';
import type { Action, CardId, GameContext, MatchState, ScoreResult, Side, Squad, Trait } from './types';
import { HAND_IDS, POSITIONS, ZONES } from './types';

export interface ScoringSetup {
  activeTrait: Trait | null;
  keeperTrait: Trait | null;
  discardsLeft: number;
}

function* subsets(items: CardId[], min: number, max: number): Generator<CardId[]> {
  const n = items.length;
  const cur: CardId[] = [];
  function* rec(start: number): Generator<CardId[]> {
    if (cur.length >= min) yield cur.slice();
    if (cur.length === max) return;
    for (let i = start; i < n; i++) {
      cur.push(items[i]);
      yield* rec(i + 1);
      cur.pop();
    }
  }
  yield* rec(0);
}

/** Evaluate every 1-5 card subset and return the best-scoring play. */
export function bestPlay(ctx: GameContext, hand: CardId[], setup: ScoringSetup): { cards: CardId[]; result: ScoreResult } {
  let best: { cards: CardId[]; result: ScoreResult } | null = null;
  for (const cards of subsets(hand, ctx.balance.minPlay, ctx.balance.maxPlay)) {
    const result = scoreHand(ctx.balance, { cards, ...setup });
    if (!best || result.score > best.result.score) best = { cards, result };
  }
  return best!;
}

/** Cards worth keeping: made groups, flush draws and open-ended-ish straight draws, else the top cards. */
function keepSet(ctx: GameContext, hand: CardId[]): Set<CardId> {
  const keep = new Set<CardId>();
  const cards = hand.map(parseCard);

  const byRank = new Map<number, CardId[]>();
  const bySuit = new Map<string, CardId[]>();
  for (const c of cards) {
    byRank.set(c.rank, [...(byRank.get(c.rank) ?? []), c.id]);
    bySuit.set(c.suit, [...(bySuit.get(c.suit) ?? []), c.id]);
  }
  for (const ids of byRank.values()) if (ids.length >= 2) ids.forEach((i) => keep.add(i));
  for (const ids of bySuit.values()) if (ids.length >= 4) ids.forEach((i) => keep.add(i));

  // Straight draws: a 5-rank window (ace low or high) that already holds 4 distinct ranks.
  for (let low = 1; low <= 10; low++) {
    const window = [0, 1, 2, 3, 4].map((o) => (low + o === 1 ? 14 : low + o));
    const present = window.filter((r) => byRank.has(r));
    if (present.length >= 4) present.forEach((r) => keep.add(byRank.get(r)![0]));
  }

  if (keep.size === 0) {
    const top = [...cards].sort((a, b) => chipValue(b, ctx.balance) - chipValue(a, ctx.balance) || b.rank - a.rank);
    top.slice(0, 3).forEach((c) => keep.add(c.id));
  }
  return keep;
}

/** Decide which cards to throw away now (possibly none). */
export function chooseDiscards(ctx: GameContext, hand: CardId[], best: ScoreResult, discardsLeft: number): CardId[] {
  if (discardsLeft <= 0) return [];
  if (HAND_IDS.indexOf(best.hand) >= HAND_IDS.indexOf('straight')) return [];
  const keep = keepSet(ctx, hand);
  const candidates = hand
    .filter((c) => !keep.has(c))
    .sort((a, b) => chipValue(parseCard(a), ctx.balance) - chipValue(parseCard(b), ctx.balance));
  return candidates.slice(0, discardsLeft);
}

export function scoringSetup(ctx: GameContext, squad: Squad, side: Side, node: number, discardsLeft: number): ScoringSetup {
  return {
    activeTrait: activeTrait(ctx, squad, side, node),
    keeperTrait: playerTrait(ctx, squad, 'GK'),
    discardsLeft,
  };
}

/**
 * The AI as a pure "next action" function, used by the live AI opponent and by the simulator.
 * Returns null when there is nothing for this side to do right now.
 */
export function aiNextAction(ctx: GameContext, state: MatchState, side: Side, rng: Rng): Action | null {
  const s = state.sides[side];
  switch (state.phase) {
    case 'transfer': {
      if (s.transferReady) return null;
      if (squadComplete(s.market, s.squad)) return { type: 'transferReady', side };
      const open = POSITIONS.filter((p) => !s.squad[p] && s.market[p].length > 0);
      for (const pos of rng.shuffle(open)) {
        const options = s.market[pos].filter((id) => canBuy(ctx, s.market, s.squad, id));
        if (options.length) return { type: 'buy', side, playerId: rng.pick(options) };
      }
      return { type: 'transferReady', side };
    }
    case 'duel': {
      if (s.lock) return null;
      const setup = scoringSetup(ctx, s.squad, side, state.node, s.discardsLeft);
      const best = bestPlay(ctx, s.hand, setup);
      const discards = chooseDiscards(ctx, s.hand, best.result, s.discardsLeft);
      if (discards.length) return { type: 'discard', side, cards: discards };
      return { type: 'lock', side, cards: best.cards };
    }
    case 'shot':
      return s.shotPick ? null : { type: 'shotPick', side, zone: rng.pick(ZONES) };
    case 'reveal':
    case 'halftime':
      return s.continued ? null : { type: 'continue', side };
    case 'fulltime':
      return null;
  }
}
