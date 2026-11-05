import { chipValue, fullDeck, parseCard } from './cards';
import { budgetLeft, canBuy, generateMarket, squadComplete } from './market';
import { Rng } from './rng';
import { scoreHand } from './scoring';
import { traitModifiers } from './traits';
import type {
  Action,
  CardId,
  DuelReveal,
  GameContext,
  Market,
  MatchState,
  Position,
  Side,
  SideState,
  Squad,
  Trait,
} from './types';
import { ZONES, other } from './types';

// ---------------------------------------------------------------------------
// Pitch helpers

/** Which of a team's players is "active" at a node. Node is seen from Team A's side. */
export function activePosition(side: Side, node: number): Position {
  if (node === 0) return 'MID';
  const attacking = (side === 'A' && node === 1) || (side === 'B' && node === -1);
  return attacking ? 'FWD' : 'DEF';
}

export function playerTrait(ctx: GameContext, squad: Squad, position: Position): Trait | null {
  const id = squad[position];
  return id ? (ctx.players[id]?.trait ?? null) : null;
}

export function activeTrait(ctx: GameContext, squad: Squad, side: Side, node: number): Trait | null {
  return playerTrait(ctx, squad, activePosition(side, node));
}

/** Hand size and discard allowance for a side's duel at a node. */
export function duelAllowance(ctx: GameContext, squad: Squad, side: Side, node: number) {
  const mods = traitModifiers(activeTrait(ctx, squad, side, node));
  return {
    handSize: ctx.balance.handSize + mods.extraHandSize,
    discards: ctx.balance.discards + mods.extraDiscards,
  };
}

// ---------------------------------------------------------------------------
// Construction

function newSide(name: string, market: Market): SideState {
  return {
    name,
    market,
    squad: {},
    transferReady: false,
    deck: [],
    played: [],
    hand: [],
    discarded: [],
    discardsLeft: 0,
    lock: null,
    shotPick: null,
    continued: false,
    rematch: false,
    goals: 0,
  };
}

export function createMatch(ctx: GameContext, opts: { seed: number; names: Record<Side, string> }): MatchState {
  const rng = new Rng(opts.seed);
  const marketA = generateMarket(ctx, rng);
  const marketB = generateMarket(ctx, rng);
  return {
    phase: 'transfer',
    half: 1,
    node: 0,
    resolvedInHalf: 0,
    resolvedTotal: 0,
    sides: { A: newSide(opts.names.A, marketA), B: newSide(opts.names.B, marketB) },
    shot: null,
    reveal: null,
    deadline: null,
    seq: 0,
    rng: rng.s,
  };
}

// ---------------------------------------------------------------------------
// Deck handling

/** Draw up to n cards. If the deck runs short, the played pile is shuffled back in. */
function draw(s: SideState, n: number, rng: Rng): CardId[] {
  if (s.deck.length < n && s.played.length > 0) {
    s.deck = rng.shuffle([...s.deck, ...s.played]);
    s.played = [];
  }
  return s.deck.splice(0, Math.min(n, s.deck.length));
}

function restoreDecks(draft: MatchState, rng: Rng): void {
  for (const side of ['A', 'B'] as const) {
    const s = draft.sides[side];
    s.deck = rng.shuffle(fullDeck());
    s.played = [];
    s.hand = [];
    s.discarded = [];
    s.lock = null;
  }
}

function startDuel(ctx: GameContext, draft: MatchState, rng: Rng): void {
  draft.phase = 'duel';
  draft.reveal = null;
  draft.deadline = null;
  for (const side of ['A', 'B'] as const) {
    const s = draft.sides[side];
    const allow = duelAllowance(ctx, s.squad, side, draft.node);
    s.continued = false;
    s.lock = null;
    s.discarded = [];
    s.discardsLeft = allow.discards;
    s.hand = draw(s, allow.handSize, rng);
  }
}

/** Played cards leave the deck for the half; everything else goes back in. */
function endDuelDecks(draft: MatchState, rng: Rng): void {
  for (const side of ['A', 'B'] as const) {
    const s = draft.sides[side];
    const played = s.lock!.cards;
    const back = s.hand.filter((c) => !played.includes(c)).concat(s.discarded);
    s.played.push(...played);
    s.deck = rng.shuffle([...s.deck, ...back]);
    s.hand = [];
    s.discarded = [];
  }
}

export function bestChipCard(ctx: GameContext, hand: CardId[]): CardId {
  return hand.reduce((best, id) => {
    const a = parseCard(best);
    const b = parseCard(id);
    const ca = chipValue(a, ctx.balance);
    const cb = chipValue(b, ctx.balance);
    return cb > ca || (cb === ca && b.rank > a.rank) ? id : best;
  });
}

// ---------------------------------------------------------------------------
// Reducer

/**
 * Pure state transition. Returns the *same object* if the action was rejected, otherwise a new state.
 * Randomness comes from the RNG state embedded in MatchState (deterministic for a given seed + actions).
 */
export function reduce(ctx: GameContext, state: MatchState, action: Action): MatchState {
  const draft = structuredClone(state);
  const rng = new Rng(draft.rng);
  if (!handle(ctx, draft, action, rng)) return state;
  draft.rng = rng.s;
  draft.seq = state.seq + 1;
  return draft;
}

function handle(ctx: GameContext, d: MatchState, a: Action, rng: Rng): boolean {
  const { balance } = ctx;
  switch (a.type) {
    case 'buy': {
      const s = d.sides[a.side];
      if (d.phase !== 'transfer' || s.transferReady) return false;
      if (!canBuy(ctx, s.market, s.squad, a.playerId)) return false;
      s.squad[ctx.players[a.playerId].position] = a.playerId;
      return true;
    }
    case 'unbuy': {
      const s = d.sides[a.side];
      if (d.phase !== 'transfer' || s.transferReady || !s.squad[a.position]) return false;
      delete s.squad[a.position];
      return true;
    }
    case 'transferReady': {
      const s = d.sides[a.side];
      if (d.phase !== 'transfer' || s.transferReady) return false;
      if (!squadComplete(s.market, s.squad) || budgetLeft(ctx, s.squad) < 0) return false;
      s.transferReady = true;
      if (d.sides.A.transferReady && d.sides.B.transferReady) {
        restoreDecks(d, rng);
        d.half = 1;
        d.node = 0;
        startDuel(ctx, d, rng);
      }
      return true;
    }
    case 'discard': {
      const s = d.sides[a.side];
      if (d.phase !== 'duel' || s.lock) return false;
      const cards = a.cards;
      if (cards.length < 1 || cards.length > s.discardsLeft) return false;
      if (new Set(cards).size !== cards.length || !cards.every((c) => s.hand.includes(c))) return false;
      // Replace in place so the hand keeps its layout. Replacements never include this duel's discards.
      const fresh = draw(s, cards.length, rng);
      let i = 0;
      s.hand = s.hand.flatMap((c) => (cards.includes(c) ? (i < fresh.length ? [fresh[i++]] : []) : [c]));
      s.discarded.push(...cards);
      s.discardsLeft -= cards.length;
      return true;
    }
    case 'lock': {
      const s = d.sides[a.side];
      if (d.phase !== 'duel' || s.lock) return false;
      const cards = a.cards;
      if (cards.length < balance.minPlay || cards.length > balance.maxPlay) return false;
      if (new Set(cards).size !== cards.length || !cards.every((c) => s.hand.includes(c))) return false;
      s.lock = { cards: cards.slice(), auto: false };
      afterLock(ctx, d, a.at, rng);
      return true;
    }
    case 'shotPick': {
      const s = d.sides[a.side];
      if (d.phase !== 'shot' || s.shotPick || !ZONES.includes(a.zone)) return false;
      s.shotPick = a.zone;
      if (d.sides.A.shotPick && d.sides.B.shotPick) resolveShot(ctx, d);
      else d.deadline = (a.at ?? 0) + balance.shotTimerSeconds * 1000;
      return true;
    }
    case 'timeout': {
      if (d.phase === 'duel') {
        if (d.deadline === null) return false;
        for (const side of ['A', 'B'] as const) {
          const s = d.sides[side];
          if (!s.lock) s.lock = { cards: [bestChipCard(ctx, s.hand)], auto: true };
        }
        resolveDuel(ctx, d, rng);
        return true;
      }
      if (d.phase === 'shot') {
        if (d.deadline === null) return false;
        for (const side of ['A', 'B'] as const) {
          const s = d.sides[side];
          if (!s.shotPick) s.shotPick = rng.pick(ZONES);
        }
        resolveShot(ctx, d);
        return true;
      }
      if (d.phase === 'reveal' || d.phase === 'halftime') {
        d.sides.A.continued = d.sides.B.continued = true;
        advance(ctx, d, rng);
        return true;
      }
      return false;
    }
    case 'continue': {
      if (d.phase !== 'reveal' && d.phase !== 'halftime') return false;
      const s = d.sides[a.side];
      if (s.continued) return false;
      s.continued = true;
      if (d.sides.A.continued && d.sides.B.continued) advance(ctx, d, rng);
      return true;
    }
    case 'rematch': {
      if (d.phase !== 'fulltime') return false;
      const s = d.sides[a.side];
      if (s.rematch) return false;
      s.rematch = true;
      if (d.sides.A.rematch && d.sides.B.rematch) {
        const fresh = createMatch(ctx, {
          seed: rng.int(0x7fffffff),
          names: { A: d.sides.A.name, B: d.sides.B.name },
        });
        fresh.seq = d.seq;
        Object.assign(d, fresh);
      }
      return true;
    }
  }
}

function afterLock(ctx: GameContext, d: MatchState, at: number | undefined, rng: Rng): void {
  if (d.sides.A.lock && d.sides.B.lock) resolveDuel(ctx, d, rng);
  else d.deadline = (at ?? 0) + ctx.balance.readyTimerSeconds * 1000;
}

function resolveDuel(ctx: GameContext, d: MatchState, rng: Rng): void {
  const node = d.node;
  const results = {} as DuelReveal['hands'];
  for (const side of ['A', 'B'] as const) {
    const s = d.sides[side];
    const lock = s.lock!;
    results[side] = {
      cards: lock.cards.slice(),
      auto: lock.auto,
      result: scoreHand(ctx.balance, {
        cards: lock.cards,
        activeTrait: activeTrait(ctx, s.squad, side, node),
        keeperTrait: playerTrait(ctx, s.squad, 'GK'),
        discardsLeft: s.discardsLeft,
      }),
    };
  }
  const sa = results.A.result.score;
  const sb = results.B.result.score;
  const winner: Side | 'tie' = sa === sb ? 'tie' : sa > sb ? 'A' : 'B';

  endDuelDecks(d, rng);
  for (const side of ['A', 'B'] as const) d.sides[side].lock = null;

  let outcome: DuelReveal['outcome'] = 'tie';
  let nodeAfter = node;
  if (winner !== 'tie') {
    d.resolvedInHalf++;
    d.resolvedTotal++;
    const dir = winner === 'A' ? 1 : -1;
    if (node === dir) {
      outcome = 'shot';
      d.shot = { shooter: winner };
    } else {
      outcome = 'advance';
      nodeAfter = node + dir;
    }
  }
  d.node = nodeAfter;
  d.reveal = { kind: 'duel', nodeBefore: node, nodeAfter, hands: results, winner, outcome };
  d.phase = 'reveal';
  d.deadline = null;
  d.sides.A.continued = d.sides.B.continued = false;
}

function resolveShot(ctx: GameContext, d: MatchState): void {
  void ctx;
  const shooter = d.shot!.shooter;
  const picks = { A: d.sides.A.shotPick!, B: d.sides.B.shotPick! };
  const goal = picks[shooter] !== picks[other(shooter)];
  if (goal) d.sides[shooter].goals++;
  d.reveal = { kind: 'shot', shooter, picks, goal };
  d.shot = null;
  d.node = 0;
  d.phase = 'reveal';
  d.deadline = null;
  for (const side of ['A', 'B'] as const) {
    d.sides[side].shotPick = null;
    d.sides[side].continued = false;
  }
}

/** Move on after a reveal or the halftime screen. */
function advance(ctx: GameContext, d: MatchState, rng: Rng): void {
  d.sides.A.continued = d.sides.B.continued = false;
  if (d.phase === 'halftime') {
    d.half = 2;
    d.node = 0;
    d.resolvedInHalf = 0;
    restoreDecks(d, rng);
    startDuel(ctx, d, rng);
    return;
  }
  // phase === 'reveal'
  if (d.shot) {
    d.reveal = null;
    d.phase = 'shot';
    d.deadline = null;
    return;
  }
  if (d.resolvedInHalf >= ctx.balance.duelsPerHalf) {
    d.reveal = null;
    d.node = 0;
    d.phase = d.half === 1 ? 'halftime' : 'fulltime';
    return;
  }
  startDuel(ctx, d, rng);
}
