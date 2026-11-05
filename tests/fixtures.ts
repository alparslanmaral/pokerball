import { balance, catalog, makeContext } from '../src/data';
import { reduce } from '../src/engine/match';
import type { Action, CardId, GameContext, MatchState, Player, Position, Side, Trait } from '../src/engine/types';
import { POSITIONS } from '../src/engine/types';

export const cards = (s: string): CardId[] => s.trim().split(/\s+/);

export function testPlayers(): Player[] {
  const prices = [6, 10, 20, 24, 34, 38, 52, 58];
  const out: Player[] = [];
  for (const pos of POSITIONS) {
    prices.forEach((price, i) => {
      const trait: Trait =
        pos === 'GK'
          ? { type: 'keeper_hand_bonus', params: { bonuses: [{ hand: 'pair', chips: 10, mult: 1 }, { hand: 'flush', chips: 20, mult: 2 }] } }
          : { type: 'chips_per_scoring_face', params: { chips: 10 + i } };
      out.push({ id: `${pos.toLowerCase()}-${i}`, firstName: 'T', lastName: `${pos}${i}`, position: pos, price, trait });
    });
  }
  return out;
}

export function testCtx(extra: Player[] = []): GameContext {
  return makeContext([...testPlayers(), ...extra], balance, catalog);
}

/** Buy the cheapest player in every slot for both sides and ready up. Returns the duel-phase state. */
export function startedMatch(ctx: GameContext, state: MatchState, squads?: Partial<Record<Side, Partial<Record<Position, string>>>>): MatchState {
  let s = state;
  for (const side of ['A', 'B'] as const) {
    for (const pos of POSITIONS) {
      const id = squads?.[side]?.[pos] ?? s.sides[side].market[pos][0];
      s = reduce(ctx, s, { type: 'buy', side, playerId: id });
    }
  }
  s = reduce(ctx, s, { type: 'transferReady', side: 'A' });
  s = reduce(ctx, s, { type: 'transferReady', side: 'B' });
  return s;
}

/** Force specific hands (test helper; state is plain JSON). */
export function withHands(s: MatchState, a: string, b: string): MatchState {
  const c = structuredClone(s);
  for (const [side, h] of [['A', a], ['B', b]] as const) {
    const ids = cards(h);
    const st = c.sides[side];
    st.deck = st.deck.concat(st.hand).filter((x) => !ids.includes(x));
    st.hand = ids;
    st.deck = st.deck.filter((x) => !ids.includes(x));
  }
  return c;
}

export function play(ctx: GameContext, s: MatchState, ...actions: Action[]): MatchState {
  return actions.reduce((acc, a) => reduce(ctx, acc, a), s);
}

/** A wins with a flush, B plays a high card. */
export const WIN_A = { a: '2S 5S 8S JS KS 3D 4D 6C', b: '2H 3C 4D 6H 9C TD JC 7S' };
