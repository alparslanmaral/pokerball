import { describe, expect, it } from 'vitest';
import {
  Rng,
  alivePlayers,
  createTournament,
  currentRound,
  dropPlayer,
  drawRound,
  isOver,
  isTIntent,
  reportResult,
  roundComplete,
} from '../src/engine';

const field = (n: number) => createTournament(Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}` })));

/** Play a whole tournament, the first player of every pairing always wins. */
function playOut(n: number, seed = 1) {
  const rng = new Rng(seed);
  let t = drawRound(field(n), rng);
  let guard = 0;
  while (!isOver(t)) {
    if (guard++ > 50) throw new Error('stuck');
    for (const m of currentRound(t)) if (m.winner === null) t = reportResult(t, m.id, m.a);
    t = drawRound(t, rng);
  }
  return t;
}

describe('tournament draw', () => {
  it('pairs an even field without byes', () => {
    const t = drawRound(field(8), new Rng(3));
    const r = currentRound(t);
    expect(r).toHaveLength(4);
    expect(r.every((m) => m.b !== null && m.winner === null)).toBe(true);
    expect(new Set(r.flatMap((m) => [m.a, m.b])).size).toBe(8);
  });

  it('gives an odd field exactly one bye, who advances automatically', () => {
    const t = drawRound(field(5), new Rng(3));
    const r = currentRound(t);
    const byes = r.filter((m) => m.b === null);
    expect(byes).toHaveLength(1);
    expect(byes[0].winner).toBe(byes[0].a);
    expect(r).toHaveLength(3);
    expect(t.players.find((p) => p.id === byes[0].a)!.byes).toBe(1);
    expect(roundComplete(t)).toBe(false);
  });

  it('rotates byes: nobody gets a second bye while someone has had none', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const rng = new Rng(seed);
      let t = drawRound(field(5), rng);
      const firstBye = currentRound(t).find((m) => m.b === null)!.a;
      // players are eliminated by the first-listed-wins rule; the bye player of round 1 always survives
      for (const m of currentRound(t)) if (m.winner === null) t = reportResult(t, m.id, m.a);
      t = drawRound(t, rng);
      expect(alivePlayers(t)).toHaveLength(3);
      const bye = currentRound(t).find((m) => m.b === null)!.a;
      const untouched = alivePlayers(t).filter((p) => p.id !== bye && p.byes === 0);
      const byeCount = t.players.find((p) => p.id === bye)!.byes;
      // either the new bye player had none before (count is now 1), or every survivor already had one
      if (byeCount === 2) expect(untouched).toHaveLength(0);
      else expect(byeCount).toBe(1);
      expect(firstBye).toBeDefined();
    }
  });

  it('refuses to draw while a match is still undecided', () => {
    const t = drawRound(field(4), new Rng(1));
    expect(() => drawRound(t, new Rng(1))).toThrow();
  });
});

describe('tournament progression', () => {
  it.each([2, 3, 4, 5, 7, 8, 11, 16])('a field of %i ends with exactly one champion', (n) => {
    const t = playOut(n, n);
    expect(t.champion).not.toBeNull();
    expect(alivePlayers(t)).toHaveLength(1);
    expect(alivePlayers(t)[0].id).toBe(t.champion);
    // n players need at most ceil(log2 n) rounds when byes never repeat for odd fields (plus slack for odd rounds)
    expect(t.rounds.length).toBeLessThanOrEqual(Math.ceil(Math.log2(n)) + 1);
  });

  it('eliminates the loser and records the score', () => {
    let t = drawRound(field(2), new Rng(1));
    const m = currentRound(t)[0];
    t = reportResult(t, m.id, m.b!, { goals: [1, 1], pens: [3, 4] });
    expect(t.champion).toBe(m.b);
    expect(t.players.find((p) => p.id === m.a)!.alive).toBe(false);
    expect(currentRound(t)[0].pens).toEqual([3, 4]);
  });

  it('ignores a result for a finished match or a non-participant', () => {
    let t = drawRound(field(4), new Rng(1));
    const [m1] = currentRound(t);
    const after = reportResult(t, m1.id, m1.a);
    expect(reportResult(after, m1.id, m1.b!)).toBe(after);
    expect(reportResult(t, m1.id, 'nobody')).toBe(t);
  });
});

describe('disconnects', () => {
  it('gives the opponent a walkover and eliminates the leaver', () => {
    const t = drawRound(field(4), new Rng(1));
    const m = currentRound(t)[0];
    const { tournament, forfeited } = dropPlayer(t, m.a);
    expect(forfeited?.id).toBe(m.id);
    const done = currentRound(tournament).find((x) => x.id === m.id)!;
    expect(done.winner).toBe(m.b);
    expect(done.forfeit).toBe(true);
    expect(tournament.players.find((p) => p.id === m.a)!.alive).toBe(false);
  });

  it('crowns the last player standing if everyone else leaves', () => {
    let t = drawRound(field(3), new Rng(1));
    const keep = 'p0';
    for (const p of ['p1', 'p2']) t = dropPlayer(t, p).tournament;
    expect(alivePlayers(t).map((p) => p.id)).toEqual([keep]);
    // the bye or walkover round is complete, so the draw crowns the survivor
    expect(roundComplete(t)).toBe(true);
    t = drawRound(t, new Rng(1));
    expect(t.champion).toBe(keep);
  });

  it('removing a player who is not in a match (e.g. already out) changes nothing', () => {
    const t = drawRound(field(4), new Rng(1));
    const m = currentRound(t)[0];
    const lost = reportResult(t, m.id, m.a);
    const { tournament, forfeited } = dropPlayer(lost, m.b!);
    expect(forfeited).toBeNull();
    expect(tournament).toBe(lost);
  });
});

describe('tournament intents', () => {
  it('accepts the documented intents and rejects junk or a rematch', () => {
    expect(isTIntent({ type: 'start' })).toBe(true);
    expect(isTIntent({ type: 'buy', playerId: 'x' })).toBe(true);
    expect(isTIntent({ type: 'match', intent: { type: 'lock', cards: ['AS'] } })).toBe(true);
    expect(isTIntent({ type: 'match', intent: { type: 'rematch' } })).toBe(false);
    expect(isTIntent({ type: 'buy' })).toBe(false);
    expect(isTIntent({ type: 'drop table' })).toBe(false);
    expect(isTIntent(null)).toBe(false);
  });
});
