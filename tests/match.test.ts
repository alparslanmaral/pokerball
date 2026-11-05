import { describe, expect, it } from 'vitest';
import { aiNextAction } from '../src/engine/ai';
import { fullDeck } from '../src/engine/cards';
import { activePosition, createMatch, reduce } from '../src/engine/match';
import { Rng } from '../src/engine/rng';
import { project } from '../src/engine/view';
import type { MatchState } from '../src/engine/types';
import { WIN_A, cards, play, startedMatch, testCtx, withHands } from './fixtures';

const ctx = testCtx();
const fresh = () => createMatch(ctx, { seed: 42, names: { A: 'Alice', B: 'Bob' } });
const duel = () => startedMatch(ctx, fresh());

/** Both sides lock. */
function lockBoth(s: MatchState, a: string, b: string): MatchState {
  return play(ctx, s, { type: 'lock', side: 'A', cards: cards(a) }, { type: 'lock', side: 'B', cards: cards(b) });
}
const cont = (s: MatchState) => play(ctx, s, { type: 'continue', side: 'A' }, { type: 'continue', side: 'B' });

describe('transfer phase', () => {
  it('cannot ready before the squad is complete, and starts the match once both are ready', () => {
    let s = fresh();
    expect(reduce(ctx, s, { type: 'transferReady', side: 'A' })).toBe(s);
    s = startedMatch(ctx, s);
    expect(s.phase).toBe('duel');
    expect(s.sides.A.hand).toHaveLength(8);
    expect(s.sides.B.hand).toHaveLength(8);
  });

  it('keeps each team\'s market private in its projection', () => {
    const s = fresh();
    const v = project(ctx, s, 'A', 0);
    expect(v.market).toEqual(s.sides.A.market);
    expect(v.oppSquad).toBeNull();
  });

  it('allows changing selections until ready', () => {
    let s = fresh();
    const [cheap, pricey] = [s.sides.A.market.GK[0], s.sides.A.market.GK[1]];
    s = reduce(ctx, s, { type: 'buy', side: 'A', playerId: cheap });
    s = reduce(ctx, s, { type: 'buy', side: 'A', playerId: pricey });
    expect(s.sides.A.squad.GK).toBe(pricey);
    s = reduce(ctx, s, { type: 'unbuy', side: 'A', position: 'GK' });
    expect(s.sides.A.squad.GK).toBeUndefined();
  });
});

describe('deck lifecycle', () => {
  it('deals 8 cards from a 52-card deck per side', () => {
    const s = duel();
    for (const side of ['A', 'B'] as const) {
      expect(s.sides[side].hand).toHaveLength(8);
      expect(s.sides[side].deck).toHaveLength(44);
      expect(s.sides[side].discardsLeft).toBe(3);
    }
  });

  it('removes played cards for the rest of the half; unplayed cards return', () => {
    let s = withHands(duel(), WIN_A.a, WIN_A.b);
    s = lockBoth(s, '2S 5S 8S JS KS', '2H');
    const a = s.sides.A;
    expect(a.played.sort()).toEqual(cards('2S 5S 8S JS KS').sort());
    expect(a.deck).toHaveLength(52 - 5);
    expect(a.deck).toContain('3D'); // unplayed hand card went back
    expect(a.deck).not.toContain('KS');
    expect(s.sides.B.deck).toHaveLength(51);
    // All 52 cards are accounted for
    expect([...a.deck, ...a.played].sort()).toEqual(fullDeck().sort());
  });

  it('discarded cards cannot be redrawn within the same duel but return afterwards', () => {
    let s = duel();
    const start = s.sides.A.hand.slice();
    const toss = start.slice(0, 3);
    s = reduce(ctx, s, { type: 'discard', side: 'A', cards: toss });
    expect(s.sides.A.discardsLeft).toBe(0);
    expect(s.sides.A.hand).toHaveLength(8);
    for (const c of toss) expect(s.sides.A.hand).not.toContain(c);
    expect(s.sides.A.discarded.sort()).toEqual(toss.slice().sort());
    // kept cards stay in their slots
    expect(s.sides.A.hand.slice(3)).toEqual(start.slice(3));
    // no discards left: a further discard is rejected
    expect(reduce(ctx, s, { type: 'discard', side: 'A', cards: [s.sides.A.hand[0]] })).toBe(s);

    s = lockBoth(s, s.sides.A.hand[0], s.sides.B.hand[0]);
    for (const c of toss) expect(s.sides.A.deck).toContain(c);
  });

  it('allows discarding one card at a time', () => {
    let s = duel();
    s = reduce(ctx, s, { type: 'discard', side: 'A', cards: [s.sides.A.hand[0]] });
    s = reduce(ctx, s, { type: 'discard', side: 'A', cards: [s.sides.A.hand[1]] });
    expect(s.sides.A.discardsLeft).toBe(1);
  });

  it('rejects invalid plays (0 or >5 cards, cards not in hand, after lock)', () => {
    const s = duel();
    expect(reduce(ctx, s, { type: 'lock', side: 'A', cards: [] })).toBe(s);
    expect(reduce(ctx, s, { type: 'lock', side: 'A', cards: s.sides.A.hand.slice(0, 6) })).toBe(s);
    expect(reduce(ctx, s, { type: 'lock', side: 'A', cards: ['XX'] })).toBe(s);
    const locked = reduce(ctx, s, { type: 'lock', side: 'A', cards: [s.sides.A.hand[0]] });
    expect(reduce(ctx, locked, { type: 'lock', side: 'A', cards: [s.sides.A.hand[1]] })).toBe(locked);
    expect(reduce(ctx, locked, { type: 'discard', side: 'A', cards: [s.sides.A.hand[1]] })).toBe(locked);
  });

  it('reshuffles the played pile into the deck when the deck runs short', () => {
    let s = duel();
    const c = structuredClone(s);
    // Simulate a long half: only 5 cards left in the deck, the rest in the played pile.
    const all = fullDeck().filter((x) => !c.sides.A.hand.includes(x));
    c.sides.A.deck = all.slice(0, 5);
    c.sides.A.played = all.slice(5);
    s = lockBoth(c, c.sides.A.hand[0], c.sides.B.hand[0]);
    s = cont(s);
    if (s.phase === 'duel') {
      expect(s.sides.A.hand).toHaveLength(8);
      const total = s.sides.A.hand.length + s.sides.A.deck.length + s.sides.A.played.length;
      expect(total).toBe(52);
    }
  });

  it('restores full 52-card decks at halftime', () => {
    let s = duel();
    const rng = new Rng(5);
    let guard = 0;
    while (s.phase !== 'halftime' && guard++ < 500) {
      const side = rng.pick(['A', 'B'] as const);
      const act = aiNextAction(ctx, s, side, rng);
      if (act) s = reduce(ctx, s, act);
      else for (const o of ['A', 'B'] as const) { const x = aiNextAction(ctx, s, o, rng); if (x) s = reduce(ctx, s, x); }
    }
    expect(s.phase).toBe('halftime');
    s = cont(s);
    expect(s.half).toBe(2);
    expect(s.phase).toBe('duel');
    for (const side of ['A', 'B'] as const) {
      expect(s.sides[side].played).toEqual([]);
      expect(s.sides[side].deck).toHaveLength(52 - 8);
    }
  });
});

describe('pitch', () => {
  it('maps nodes to the matched players', () => {
    expect(activePosition('A', 0)).toBe('MID');
    expect(activePosition('B', 0)).toBe('MID');
    expect(activePosition('A', 1)).toBe('FWD');
    expect(activePosition('B', 1)).toBe('DEF');
    expect(activePosition('A', -1)).toBe('DEF');
    expect(activePosition('B', -1)).toBe('FWD');
  });

  it('the winner pushes the ball one step; the loser pushes it back', () => {
    let s = withHands(duel(), WIN_A.a, WIN_A.b);
    s = lockBoth(s, '2S 5S 8S JS KS', '2H');
    expect(s.phase).toBe('reveal');
    expect(s.reveal?.kind === 'duel' && s.reveal.winner).toBe('A');
    expect(s.node).toBe(1);
    expect(s.resolvedInHalf).toBe(1);
    s = cont(s);
    expect(s.phase).toBe('duel');
    s = withHands(s, WIN_A.b, WIN_A.a);
    s = lockBoth(s, '2H', '2S 5S 8S JS KS');
    expect(s.node).toBe(0);
  });

  it('ties replay the same node and do not count', () => {
    let s = withHands(duel(), '2S 3D 4D 6C 9D 9H TC JC', '2H 3C 4C 6H 9C 9S TD JD');
    // identical high cards (J = 10 chips) score equally
    s = lockBoth(s, 'JC', 'JD');
    expect(s.reveal?.kind === 'duel' && s.reveal.winner).toBe('tie');
    expect(s.node).toBe(0);
    expect(s.resolvedInHalf).toBe(0);
    // played cards stay out of the deck
    expect(s.sides.A.played).toEqual(['JC']);
    s = cont(s);
    expect(s.phase).toBe('duel');
    expect(s.sides.A.deck.length + s.sides.A.hand.length).toBe(51);
  });

  it('winning at the final node triggers a shot instead of moving the ball', () => {
    let s = duel();
    // A wins twice in a row
    for (let i = 0; i < 2; i++) {
      s = withHands(s, WIN_A.a, WIN_A.b);
      s = lockBoth(s, '2S 5S 8S JS KS', '2H');
      if (i === 0) s = cont(s);
    }
    expect(s.reveal?.kind === 'duel' && s.reveal.outcome).toBe('shot');
    expect(s.shot).toEqual({ shooter: 'A' });
    expect(s.node).toBe(1);
    s = cont(s);
    expect(s.phase).toBe('shot');
  });

  it('B scores a shot from the other end', () => {
    let s = duel();
    for (let i = 0; i < 2; i++) {
      s = withHands(s, WIN_A.b, WIN_A.a);
      s = lockBoth(s, '2H', '2S 5S 8S JS KS');
      if (i === 0) s = cont(s);
    }
    expect(s.shot).toEqual({ shooter: 'B' });
    expect(s.node).toBe(-1);
  });
});

describe('shot phase', () => {
  function toShot(): MatchState {
    let s = duel();
    for (let i = 0; i < 2; i++) {
      s = withHands(s, WIN_A.a, WIN_A.b);
      s = lockBoth(s, '2S 5S 8S JS KS', '2H');
      s = cont(s);
    }
    return s;
  }

  it('different zones = goal, same zone = save; ball returns to midfield either way', () => {
    let s = toShot();
    expect(s.phase).toBe('shot');
    s = play(ctx, s, { type: 'shotPick', side: 'A', zone: 'left' }, { type: 'shotPick', side: 'B', zone: 'right' });
    expect(s.reveal).toMatchObject({ kind: 'shot', goal: true, shooter: 'A' });
    expect(s.sides.A.goals).toBe(1);
    expect(s.node).toBe(0);

    s = toShot();
    s = play(ctx, s, { type: 'shotPick', side: 'A', zone: 'center' }, { type: 'shotPick', side: 'B', zone: 'center' });
    expect(s.reveal).toMatchObject({ kind: 'shot', goal: false });
    expect(s.sides.A.goals).toBe(0);
    expect(s.node).toBe(0);
  });

  it('hides the opponent\'s pick until both have chosen', () => {
    let s = toShot();
    s = reduce(ctx, s, { type: 'shotPick', side: 'A', zone: 'left' });
    const v = project(ctx, s, 'B', 0);
    expect(v.oppShotPicked).toBe(true);
    expect(JSON.stringify(v)).not.toContain('"left"');
    expect(v.timerMs).not.toBeNull();
  });

  it('picks a random zone on timeout', () => {
    let s = toShot();
    s = reduce(ctx, s, { type: 'shotPick', side: 'A', zone: 'left', at: 1000 });
    expect(s.deadline).toBe(1000 + 15000);
    s = reduce(ctx, s, { type: 'timeout', at: 16000 });
    expect(s.reveal?.kind).toBe('shot');
  });

  it('the half ends after the pending shot finishes', () => {
    let s = duel();
    const c = structuredClone(s);
    c.resolvedInHalf = 7; // next win is the 8th duel
    c.node = 1;
    s = withHands(c, WIN_A.a, WIN_A.b);
    s = lockBoth(s, '2S 5S 8S JS KS', '2H');
    expect(s.resolvedInHalf).toBe(8);
    s = cont(s);
    expect(s.phase).toBe('shot');
    s = play(ctx, s, { type: 'shotPick', side: 'A', zone: 'left' }, { type: 'shotPick', side: 'B', zone: 'left' });
    s = cont(s);
    expect(s.phase).toBe('halftime');
  });
});

describe('duel timing', () => {
  it('after one side locks, the other has 15s; on timeout it auto-plays its highest chip card', () => {
    let s = withHands(duel(), WIN_A.a, '2H 3C 4D 6H 9C TD AC 7S');
    s = reduce(ctx, s, { type: 'lock', side: 'A', cards: cards('2S 5S 8S JS KS'), at: 5000 });
    expect(s.deadline).toBe(20000);
    expect(project(ctx, s, 'B', 8000).timerMs).toBe(12000);
    expect(s.phase).toBe('duel');
    s = reduce(ctx, s, { type: 'timeout', at: 20000 });
    expect(s.phase).toBe('reveal');
    const r = s.reveal as any;
    expect(r.hands.B.auto).toBe(true);
    expect(r.hands.B.cards).toEqual(['AC']);
    expect(r.hands.B.result.score).toBe(16);
  });

  it('timeout is ignored while nobody has locked', () => {
    const s = duel();
    expect(reduce(ctx, s, { type: 'timeout', at: 99999 })).toBe(s);
  });

  it('never reveals the opponent\'s hand or lock during a duel', () => {
    let s = duel();
    s = reduce(ctx, s, { type: 'lock', side: 'A', cards: [s.sides.A.hand[0]] });
    const v = project(ctx, s, 'B', 0);
    expect(v.oppLocked).toBe(true);
    const json = JSON.stringify(v);
    expect(json).not.toContain(s.sides.A.hand[3] + '"');
    expect(v.reveal).toBeNull();
  });
});

describe('full match', () => {
  function playOut(seed: number): MatchState {
    let s = createMatch(ctx, { seed, names: { A: 'Alice', B: 'Bob' } });
    const rng = new Rng(seed * 31 + 1);
    let guard = 0;
    while (s.phase !== 'fulltime' && guard++ < 5000) {
      let progressed = false;
      for (const side of ['A', 'B'] as const) {
        const act = aiNextAction(ctx, s, side, rng);
        if (act) {
          s = reduce(ctx, s, act);
          progressed = true;
        }
      }
      if (!progressed) throw new Error('stuck in phase ' + s.phase);
    }
    return s;
  }

  it('always finishes: 2 halves x 8 resolved duels', () => {
    for (let seed = 1; seed <= 15; seed++) {
      const s = playOut(seed);
      expect(s.phase).toBe('fulltime');
      expect(s.resolvedTotal).toBe(16);
      expect(s.half).toBe(2);
    }
  });

  it('is deterministic for a given seed', () => {
    expect(playOut(7)).toEqual(playOut(7));
    expect(playOut(7).sides.A.goals + playOut(7).sides.B.goals).toBeGreaterThanOrEqual(0);
  });

  it('rematch returns to transfer with a fresh market and reset scores', () => {
    let s = structuredClone(playOut(3));
    s.sides.A.rematch = s.sides.B.rematch = false; // the AI helper may already have voted
    const oldMarket = s.sides.A.market;
    s = play(ctx, s, { type: 'rematch', side: 'A' });
    expect(s.phase).toBe('fulltime');
    s = play(ctx, s, { type: 'rematch', side: 'B' });
    expect(s.phase).toBe('transfer');
    expect(s.sides.A.goals).toBe(0);
    expect(s.sides.A.squad).toEqual({});
    expect(s.sides.A.name).toBe('Alice');
    expect(s.sides.A.market).not.toEqual(oldMarket);
  });
});
