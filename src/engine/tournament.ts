// Pure single-elimination tournament logic. No DOM, no network: the host (src/net/tournament.ts) drives it.
//
// Every round the surviving players are drawn at random into pairs. With an odd number of survivors one player
// gets a bye (advances without playing); byes rotate so nobody gets a second one before everyone has had one.

import type { Rng } from './rng';
import type { ClientView } from './view';
import type { Intent, Market, Position, Squad } from './types';

export interface TPlayer {
  id: string;
  name: string;
  /** Still in the tournament (not eliminated, not disconnected). */
  alive: boolean;
  byes: number;
}

export interface TMatch {
  id: number;
  round: number; // 0-based
  a: string;
  /** null = bye: `a` advances automatically. */
  b: string | null;
  winner: string | null;
  /** Regulation score (a, b) once played. */
  goals?: [number, number];
  /** Penalty shootout tally (a, b) if the match was level after full time. */
  pens?: [number, number];
  /** The opponent disconnected, so the winner advanced by walkover. */
  forfeit?: boolean;
}

export interface Tournament {
  players: TPlayer[];
  rounds: TMatch[][];
  champion: string | null;
  nextMatchId: number;
}

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 16;

export function createTournament(players: { id: string; name: string }[]): Tournament {
  return {
    players: players.map((p) => ({ id: p.id, name: p.name, alive: true, byes: 0 })),
    rounds: [],
    champion: null,
    nextMatchId: 1,
  };
}

export const alivePlayers = (t: Tournament): TPlayer[] => t.players.filter((p) => p.alive);

export function currentRound(t: Tournament): TMatch[] {
  return t.rounds[t.rounds.length - 1] ?? [];
}

export function roundComplete(t: Tournament): boolean {
  const r = currentRound(t);
  return r.length > 0 && r.every((m) => m.winner !== null);
}

/** Nobody is left to play (champion decided, or everybody left). */
export function isOver(t: Tournament): boolean {
  return t.champion !== null || (t.rounds.length > 0 && alivePlayers(t).length === 0);
}

/**
 * Draw the next round. Call it when there is no round yet or the current one is complete.
 * With a single survivor that player becomes champion instead.
 */
export function drawRound(t: Tournament, rng: Rng): Tournament {
  if (t.rounds.length > 0 && !roundComplete(t)) throw new Error('The current round is not finished.');
  const next = structuredClone(t);
  const alive = alivePlayers(next);
  if (alive.length === 0) return next;
  if (alive.length === 1) {
    next.champion = alive[0].id;
    return next;
  }

  const pool = rng.shuffle(alive.map((p) => p.id));
  const round: TMatch[] = [];
  const roundIndex = next.rounds.length;
  const add = (a: string, b: string | null): TMatch => {
    const m: TMatch = { id: next.nextMatchId++, round: roundIndex, a, b, winner: b === null ? a : null };
    round.push(m);
    return m;
  };

  if (pool.length % 2 === 1) {
    const byes = (id: string) => next.players.find((p) => p.id === id)!.byes;
    const fewest = Math.min(...pool.map(byes));
    const candidates = pool.filter((id) => byes(id) === fewest);
    const byeId = rng.pick(candidates);
    pool.splice(pool.indexOf(byeId), 1);
    next.players.find((p) => p.id === byeId)!.byes++;
    add(byeId, null);
  }
  for (let i = 0; i < pool.length; i += 2) add(pool[i], pool[i + 1]);

  next.rounds.push(round);
  return next;
}

export interface MatchOutcome {
  goals?: [number, number];
  pens?: [number, number];
  forfeit?: boolean;
}

/** Record the winner of a match; the loser is eliminated. Declares the champion when only one player is left. */
export function reportResult(t: Tournament, matchId: number, winnerId: string, outcome: MatchOutcome = {}): Tournament {
  const next = structuredClone(t);
  const m = currentRound(next).find((x) => x.id === matchId);
  if (!m || m.winner !== null || m.b === null) return t;
  if (winnerId !== m.a && winnerId !== m.b) return t;
  const loser = winnerId === m.a ? m.b : m.a;
  m.winner = winnerId;
  if (outcome.goals) m.goals = outcome.goals;
  if (outcome.pens) m.pens = outcome.pens;
  if (outcome.forfeit) m.forfeit = true;
  const lp = next.players.find((p) => p.id === loser);
  if (lp) lp.alive = false;
  return settle(next);
}

/**
 * A player left (disconnected). They are out; if they were in an unfinished match their opponent advances by
 * walkover. Returns the match that was forfeited, if any.
 */
export function dropPlayer(t: Tournament, playerId: string): { tournament: Tournament; forfeited: TMatch | null } {
  const next = structuredClone(t);
  const p = next.players.find((x) => x.id === playerId);
  if (!p || !p.alive) return { tournament: t, forfeited: null };
  p.alive = false;
  const m = currentRound(next).find((x) => x.winner === null && x.b !== null && (x.a === playerId || x.b === playerId));
  if (m) {
    m.winner = m.a === playerId ? m.b : m.a;
    m.forfeit = true;
  }
  return { tournament: settle(next), forfeited: m ?? null };
}

/** A finished round with exactly one survivor ends the tournament. */
function settle(t: Tournament): Tournament {
  if (roundComplete(t)) {
    const alive = alivePlayers(t);
    if (alive.length === 1) t.champion = alive[0].id;
  }
  return t;
}

export const nameOf = (t: Tournament, id: string | null): string =>
  id === null ? '—' : (t.players.find((p) => p.id === id)?.name ?? '?');

/** Number of rounds a field of n players needs (for display only). */
export function roundsNeeded(n: number): number {
  return n <= 1 ? 0 : Math.ceil(Math.log2(n));
}

// ---------------------------------------------------------------------------
// Wire types shared by the host, the guests and the UI

/** What a tournament participant can ask the host to do. */
export type TIntent =
  | { type: 'start' } // host only: close the lobby and open the transfer market
  | { type: 'buy'; playerId: string }
  | { type: 'unbuy'; position: Position }
  | { type: 'transferReady' }
  | { type: 'match'; intent: Intent } // forwarded to this player's current match
  | { type: 'ack' }; // leave the full-time screen of a finished match

export type TStage = 'lobby' | 'transfer' | 'bracket' | 'match' | 'finished';

export interface TPlayerView {
  id: string;
  name: string;
  alive: boolean;
  connected: boolean;
  /** Transfer phase: squad confirmed. */
  ready: boolean;
}

export interface TournamentView {
  me: string;
  isHost: boolean;
  stage: TStage;
  players: TPlayerView[];
  maxPlayers: number;
  minPlayers: number;
  // Transfer (one squad for the whole tournament)
  market: Market;
  squad: Squad;
  budgetLeft: number;
  meReady: boolean;
  // Bracket
  rounds: TMatch[][];
  champion: string | null;
  /** Remaining time until the next round's matches start (host clock difference, no clock sync needed). */
  startsInMs: number | null;
  meAlive: boolean;
  /** My match of the current round, if any (bye matches have b === null). */
  myMatch: TMatch | null;
  /** The live match, projected for me; null when I am not playing right now. */
  match: ClientView | null;
  notice: string | null;
}

export function isTIntent(x: unknown): x is TIntent {
  if (!x || typeof x !== 'object') return false;
  const t = (x as { type?: unknown }).type;
  if (t === 'start' || t === 'transferReady' || t === 'ack') return true;
  if (t === 'buy') return typeof (x as { playerId?: unknown }).playerId === 'string';
  if (t === 'unbuy') return typeof (x as { position?: unknown }).position === 'string';
  if (t === 'match') {
    const inner = (x as { intent?: { type?: unknown } }).intent;
    return !!inner && typeof inner === 'object' && typeof inner.type === 'string' && inner.type !== 'rematch';
  }
  return false;
}
