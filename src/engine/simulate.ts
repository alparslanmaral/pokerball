import { aiNextAction } from './ai';
import { activePosition, createMatch, reduce } from './match';
import { Rng } from './rng';
import type { GameContext, HandId, MatchState, Side, Squad } from './types';

export interface DuelRecord {
  half: number;
  node: number;
  winner: Side | 'tie';
  outcome: 'tie' | 'advance' | 'shot';
  sides: Record<Side, { score: number; hand: HandId; cards: number; active: string | undefined; keeper: string | undefined }>;
}

export interface MatchLog {
  final: MatchState;
  duels: DuelRecord[];
  shots: { goal: boolean }[];
  /** Number of times the played pile had to be shuffled back into a deck. */
  reshuffles: number;
  /** Duels including ties, per half. */
  duelsPerHalf: [number, number];
}

/** Plays a complete AI-vs-AI match. Optional fixed squads skip the random purchase. */
export function simulateMatch(ctx: GameContext, seed: number, squads?: Partial<Record<Side, Squad>>): MatchLog {
  // Fixed squads ignore the budget (used for tier comparisons), so lift the cap for this run only.
  if (squads) ctx = { ...ctx, balance: { ...ctx.balance, budget: 1e9 } };
  let s = createMatch(ctx, { seed, names: { A: 'A', B: 'B' } });
  if (squads) {
    s = structuredClone(s);
    for (const side of ['A', 'B'] as const) if (squads[side]) s.sides[side].squad = { ...squads[side] };
  }
  const rng = new Rng(seed ^ 0x5bd1e995);
  const log: MatchLog = { final: s, duels: [], shots: [], reshuffles: 0, duelsPerHalf: [0, 0] };
  let guard = 0;
  while (s.phase !== 'fulltime') {
    if (guard++ > 20000) throw new Error('simulation stuck in phase ' + s.phase);
    let progressed = false;
    for (const side of ['A', 'B'] as const) {
      const act = aiNextAction(ctx, s, side, rng);
      if (!act) continue;
      const prev = s;
      s = reduce(ctx, s, act);
      progressed = true;
      for (const sd of ['A', 'B'] as const) {
        // The played pile only shrinks within a half when it is shuffled back into a short deck.
        if (s.half === prev.half && s.sides[sd].played.length < prev.sides[sd].played.length) log.reshuffles++;
      }
      if (s.phase === 'reveal' && prev.phase !== 'reveal' && s.reveal) {
        if (s.reveal.kind === 'duel') {
          const r = s.reveal;
          const mk = (sd: Side) => ({
            score: r.hands[sd].result.score,
            hand: r.hands[sd].result.hand,
            cards: r.hands[sd].cards.length,
            active: s.sides[sd].squad[activePosition(sd, r.nodeBefore)],
            keeper: s.sides[sd].squad.GK,
          });
          log.duels.push({ half: s.half, node: r.nodeBefore, winner: r.winner, outcome: r.outcome, sides: { A: mk('A'), B: mk('B') } });
          log.duelsPerHalf[s.half - 1]++;
        } else {
          log.shots.push({ goal: s.reveal.goal });
        }
      }
    }
    if (!progressed) throw new Error('simulation stalled in phase ' + s.phase);
  }
  log.final = s;
  return log;
}
