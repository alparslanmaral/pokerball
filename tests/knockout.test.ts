import { describe, expect, it } from 'vitest';
import { createMatch, other, project, reduce } from '../src/engine';
import type { Action, MatchState, Side, Squad } from '../src/engine';
import { WIN_A, play, testCtx, withHands } from './fixtures';

const ctx = testCtx();
const squad: Squad = { GK: 'gk-0', DEF: 'def-0', MID: 'mid-0', FWD: 'fwd-0' };
const names = { A: 'Alpha', B: 'Bravo' };

function knockoutMatch(seed = 1): MatchState {
  return createMatch(ctx, { seed, names, squads: { A: squad, B: squad }, knockout: true });
}

/** Skip to the last duel of the second half and let A win it at midfield (no shot), so regulation ends. */
function toEndOfRegulation(s: MatchState, goalsA = 0, goalsB = 0): MatchState {
  let c = structuredClone(s);
  c.half = 2;
  c.resolvedInHalf = ctx.balance.duelsPerHalf - 1;
  c.sides.A.goals = goalsA;
  c.sides.B.goals = goalsB;
  c = withHands(c, WIN_A.a, WIN_A.b);
  c = play(
    ctx,
    c,
    { type: 'lock', side: 'A', cards: ['2S', '5S', '8S', 'JS', 'KS'] },
    { type: 'lock', side: 'B', cards: ['JC'] },
  );
  expect(c.phase).toBe('reveal');
  return play(ctx, c, { type: 'continue', side: 'A' }, { type: 'continue', side: 'B' });
}

/** One penalty kick: the shooter picks "left"; the keeper picks the same zone (save) or another (goal). */
function kick(s: MatchState, goal: boolean): MatchState {
  expect(s.phase).toBe('shot');
  const shooter = s.shot!.shooter;
  const actions: Action[] = [
    { type: 'shotPick', side: shooter, zone: 'left' },
    { type: 'shotPick', side: other(shooter), zone: goal ? 'right' : 'left' },
  ];
  const revealed = play(ctx, s, ...actions);
  expect(revealed.phase).toBe('reveal');
  expect(revealed.reveal).toMatchObject({ kind: 'shot', penalty: true, goal });
  return play(ctx, revealed, { type: 'continue', side: 'A' }, { type: 'continue', side: 'B' });
}

/** Kick pairs by (first kicker scores?, second kicker scores?). */
function shootout(s: MatchState, rounds: [boolean, boolean][]): MatchState {
  return rounds.reduce((acc, [g1, g2]) => kick(kick(acc, g1), g2), s);
}

describe('pre-built knockout match', () => {
  it('skips the transfer phase and deals the first duel', () => {
    const s = knockoutMatch();
    expect(s.phase).toBe('duel');
    expect(s.knockout).toBe(true);
    expect(s.sides.A.hand).toHaveLength(ctx.balance.handSize);
    expect(s.sides.B.hand).toHaveLength(ctx.balance.handSize);
    expect(s.sides.A.squad).toEqual(squad);
    expect(s.sides.A.deck.length + s.sides.A.hand.length).toBe(52);
  });

  it('is deterministic for a seed', () => {
    expect(knockoutMatch(7)).toEqual(knockoutMatch(7));
    expect(knockoutMatch(7)).not.toEqual(knockoutMatch(8));
  });

  it('a normal (non-knockout) match is unchanged: no winner, no shootout', () => {
    const s = createMatch(ctx, { seed: 1, names });
    expect(s.knockout).toBe(false);
    expect(s.winner).toBeNull();
    expect(s.shootout).toBeNull();
  });
});

describe('full time in a knockout match', () => {
  it('goes straight to full time with a winner when one side leads', () => {
    const s = toEndOfRegulation(knockoutMatch(), 2, 1);
    expect(s.phase).toBe('fulltime');
    expect(s.winner).toBe('A');
    expect(s.shootout).toBeNull();
  });

  it('gives the win to B when B leads', () => {
    const s = toEndOfRegulation(knockoutMatch(), 0, 1);
    expect(s.phase).toBe('fulltime');
    expect(s.winner).toBe('B');
  });

  it('starts a penalty shootout when the score is level', () => {
    const s = toEndOfRegulation(knockoutMatch(), 1, 1);
    expect(s.phase).toBe('shot');
    expect(s.winner).toBeNull();
    expect(s.shootout).toEqual({ first: s.shot!.shooter, kicks: [] });
  });

  it('cannot start a rematch', () => {
    const s = toEndOfRegulation(knockoutMatch(), 3, 0);
    expect(reduce(ctx, s, { type: 'rematch', side: 'A' })).toBe(s);
  });
});

describe('penalty shootout', () => {
  const level = () => toEndOfRegulation(knockoutMatch(4), 1, 1);

  it('both sides kick once per round, the first kicker first', () => {
    const s0 = level();
    const first = s0.shootout!.first;
    const s1 = kick(s0, true);
    expect(s1.phase).toBe('shot');
    expect(s1.shot!.shooter).toBe(other(first));
    expect(s1.shootout!.kicks).toEqual([{ shooter: first, goal: true }]);
  });

  it('ends when the first kicker scores and the second misses', () => {
    const s0 = level();
    const first = s0.shootout!.first;
    const s = shootout(s0, [[true, false]]);
    expect(s.phase).toBe('fulltime');
    expect(s.winner).toBe(first);
  });

  it('ends when the first kicker misses and the second scores', () => {
    const s0 = level();
    const s = shootout(s0, [[false, true]]);
    expect(s.phase).toBe('fulltime');
    expect(s.winner).toBe(other(s0.shootout!.first));
  });

  it('continues when both score', () => {
    const s0 = level();
    const s = shootout(s0, [[true, true]]);
    expect(s.phase).toBe('shot');
    expect(s.winner).toBeNull();
    expect(s.shot!.shooter).toBe(s0.shootout!.first);
    expect(s.shootout!.kicks).toHaveLength(2);
  });

  it('continues when both miss, and keeps going until exactly one side scores', () => {
    const s0 = level();
    const mid = shootout(s0, [
      [false, false],
      [true, true],
      [false, false],
    ]);
    expect(mid.phase).toBe('shot');
    expect(mid.shootout!.kicks).toHaveLength(6);
    const end = shootout(mid, [[true, false]]);
    expect(end.phase).toBe('fulltime');
    expect(end.winner).toBe(s0.shootout!.first);
    expect(end.shootout!.kicks).toHaveLength(8);
  });

  it('never changes the regulation score', () => {
    const s0 = level();
    const s = shootout(s0, [
      [true, true],
      [true, false],
    ]);
    expect(s.sides.A.goals).toBe(1);
    expect(s.sides.B.goals).toBe(1);
  });

  it('a kick resolves at once when the 15s timer fires with one pick missing (random pick for the slow side)', () => {
    const s0 = level();
    const shooter = s0.shot!.shooter;
    let s = reduce(ctx, s0, { type: 'shotPick', side: shooter, zone: 'center', at: 1000 });
    expect(s.deadline).toBe(1000 + ctx.balance.shotTimerSeconds * 1000);
    s = reduce(ctx, s, { type: 'timeout', at: 99999 });
    expect(s.phase).toBe('reveal');
    expect(s.reveal).toMatchObject({ kind: 'shot', penalty: true });
  });

  it('every simulated shootout terminates with a winner', () => {
    for (let seed = 1; seed <= 200; seed++) {
      let s = toEndOfRegulation(knockoutMatch(seed), 1, 1);
      let guard = 0;
      while (s.phase === 'shot') {
        if (guard++ > 400) throw new Error('shootout never ended');
        const shooter = s.shot!.shooter as Side;
        const zones = ['left', 'center', 'right'] as const;
        const a = zones[(seed + guard) % 3];
        const b = zones[(seed * 7 + guard * 5) % 3];
        s = play(
          ctx,
          s,
          { type: 'shotPick', side: shooter, zone: a },
          { type: 'shotPick', side: other(shooter), zone: b },
          { type: 'continue', side: 'A' },
          { type: 'continue', side: 'B' },
        );
      }
      expect(s.phase).toBe('fulltime');
      expect(s.winner).not.toBeNull();
      // the winner scored exactly one more in the deciding round
      const kicks = s.shootout!.kicks;
      expect(kicks.length % 2).toBe(0);
      const [k1, k2] = kicks.slice(-2);
      expect(k1.goal).not.toBe(k2.goal);
    }
  });
});

describe('projection', () => {
  it('exposes knockout, shootout and winner to the players', () => {
    const s = shootout(toEndOfRegulation(knockoutMatch(4), 1, 1), [[true, false]]);
    const v = project(ctx, s, 'A', 0);
    expect(v.knockout).toBe(true);
    expect(v.winner).toBe(s.winner);
    expect(v.shootout?.kicks).toHaveLength(2);
  });
});
