import { budgetLeft } from './market';
import { activeTrait, playerTrait } from './match';
import { scoreHand } from './scoring';
import type { CardId, GameContext, Lock, Market, MatchState, Phase, Reveal, ScoreResult, Side, Squad, Zone } from './types';
import { other } from './types';

/**
 * What one player is allowed to see. The opponent's hand, deck contents, market, lock contents and
 * shot pick are never included; the opponent's played hand is revealed only through `reveal`.
 */
export interface ClientView {
  me: Side;
  phase: Phase;
  half: 1 | 2;
  node: number;
  resolvedInHalf: number;
  resolvedTotal: number;
  duelsPerHalf: number;
  seq: number;
  names: Record<Side, string>;
  goals: Record<Side, number>;
  market: Market;
  squad: Squad;
  /** null until the transfer phase is over. */
  oppSquad: Squad | null;
  budgetLeft: number;
  meTransferReady: boolean;
  oppTransferReady: boolean;
  hand: CardId[];
  discardsLeft: number;
  deckCount: number;
  oppDeckCount: number;
  myLock: Lock | null;
  oppLocked: boolean;
  shooter: Side | null;
  myShotPick: Zone | null;
  oppShotPicked: boolean;
  reveal: Reveal | null;
  /** Remaining time of the running ready/shot countdown, if any. */
  timerMs: number | null;
  meContinued: boolean;
  oppContinued: boolean;
  meRematch: boolean;
  oppRematch: boolean;
}

export function project(ctx: GameContext, state: MatchState, me: Side, now: number): ClientView {
  const opp = other(me);
  const m = state.sides[me];
  const o = state.sides[opp];
  const started = state.phase !== 'transfer';
  return {
    me,
    phase: state.phase,
    half: state.half,
    node: state.node,
    resolvedInHalf: state.resolvedInHalf,
    resolvedTotal: state.resolvedTotal,
    duelsPerHalf: ctx.balance.duelsPerHalf,
    seq: state.seq,
    names: { A: state.sides.A.name, B: state.sides.B.name },
    goals: { A: state.sides.A.goals, B: state.sides.B.goals },
    market: m.market,
    squad: m.squad,
    oppSquad: started ? o.squad : null,
    budgetLeft: budgetLeft(ctx, m.squad),
    meTransferReady: m.transferReady,
    oppTransferReady: o.transferReady,
    hand: m.hand,
    discardsLeft: m.discardsLeft,
    deckCount: m.deck.length,
    oppDeckCount: o.deck.length,
    myLock: m.lock,
    oppLocked: !!o.lock,
    shooter: state.shot?.shooter ?? (state.reveal?.kind === 'shot' ? state.reveal.shooter : null),
    myShotPick: m.shotPick,
    oppShotPicked: !!o.shotPick,
    reveal: state.reveal,
    timerMs: state.deadline !== null && (state.phase === 'duel' || state.phase === 'shot') ? Math.max(0, state.deadline - now) : null,
    meContinued: m.continued,
    oppContinued: o.continued,
    meRematch: m.rematch,
    oppRematch: o.rematch,
  };
}

/** Live preview of a selection for the local player (never shown to the opponent). */
export function previewSelection(ctx: GameContext, view: ClientView, cards: CardId[]): ScoreResult | null {
  if (cards.length < ctx.balance.minPlay || cards.length > ctx.balance.maxPlay) return null;
  return scoreHand(ctx.balance, {
    cards,
    activeTrait: activeTrait(ctx, view.squad, view.me, view.node),
    keeperTrait: playerTrait(ctx, view.squad, 'GK'),
    discardsLeft: view.discardsLeft,
  });
}
