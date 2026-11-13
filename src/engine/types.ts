// Core engine types. The engine is framework-free: no DOM, no network imports.

export type Side = 'A' | 'B';
export type Position = 'GK' | 'DEF' | 'MID' | 'FWD';
export type Zone = 'left' | 'center' | 'right';
export type Suit = 'S' | 'H' | 'D' | 'C';

export const POSITIONS: Position[] = ['GK', 'DEF', 'MID', 'FWD'];
export const ZONES: Zone[] = ['left', 'center', 'right'];
export const SIDES: Side[] = ['A', 'B'];

export const HAND_IDS = [
  'high_card',
  'pair',
  'two_pair',
  'three_of_a_kind',
  'straight',
  'flush',
  'full_house',
  'four_of_a_kind',
  'straight_flush',
] as const;
export type HandId = (typeof HAND_IDS)[number];

/** A card is identified by a 2-char string, e.g. "AS", "TH", "2C". */
export type CardId = string;

export interface Card {
  id: CardId;
  rank: number; // 2..14 (14 = Ace)
  suit: Suit;
}

export interface Trait {
  type: string;
  params: Record<string, any>;
}

export interface Player {
  id: string;
  firstName: string;
  lastName: string;
  position: Position;
  price: number;
  image?: string;
  trait: Trait;
}

export interface HandBase {
  label: string;
  chips: number;
  mult: number;
}

export interface PriceBand {
  id: string;
  min: number;
  max: number;
}

export interface Balance {
  cards: { faceCardChips: number; aceChips: number };
  hands: Record<HandId, HandBase>;
  handSize: number;
  discards: number;
  minPlay: number;
  maxPlay: number;
  duelsPerHalf: number;
  readyTimerSeconds: number;
  shotTimerSeconds: number;
  revealFailsafeSeconds: number;
  budget: number;
  offersPerPosition: number;
  cheapestSumCap: number;
  priceBands: PriceBand[];
  pricing: { minPrice: number; maxPrice: number; powerAtMinPrice: number; powerAtMaxPrice: number };
  priceWeights: Record<Position, number>;
}

export type ParamDef =
  | { type: 'number'; min: number; max: number; step: number; default: number }
  | { type: 'enum'; options: string[]; default: string }
  | { type: 'hands'; minCount: number; maxCount: number; default: HandId[] }
  | {
      type: 'bonuses';
      count: number;
      bounds: Record<HandId, { chips: { min: number; max: number }; mult: { min: number; max: number } }>;
      default: KeeperBonus[];
    };

export interface KeeperBonus {
  hand: HandId;
  chips: number;
  mult: number;
}

export interface TraitTemplate {
  id: string;
  label: string;
  description: string;
  enabled: boolean;
  allowedPositions: Position[];
  powerWeight: number;
  params: Record<string, ParamDef>;
}

/** Everything the engine needs to know about game data. Injected, never imported. */
export interface GameContext {
  balance: Balance;
  catalog: TraitTemplate[];
  players: Record<string, Player>;
}

export type Squad = Partial<Record<Position, string>>;
export type Market = Record<Position, string[]>;

export interface ScoreBreakdownEntry {
  source: string;
  chips: number;
  mult: number;
  xmult: number;
}

export interface ScoreResult {
  hand: HandId;
  scoring: CardId[];
  chips: number;
  mult: number;
  score: number;
  breakdown: ScoreBreakdownEntry[];
}

export interface Lock {
  cards: CardId[];
  auto: boolean;
}

export interface SideState {
  name: string;
  market: Market;
  squad: Squad;
  transferReady: boolean;
  deck: CardId[];
  played: CardId[];
  hand: CardId[];
  discarded: CardId[];
  discardsLeft: number;
  lock: Lock | null;
  shotPick: Zone | null;
  continued: boolean;
  rematch: boolean;
  goals: number;
}

export interface DuelReveal {
  kind: 'duel';
  /** Unique per reveal (UI animation key). */
  id: number;
  nodeBefore: number;
  nodeAfter: number;
  hands: Record<Side, { cards: CardId[]; auto: boolean; result: ScoreResult }>;
  winner: Side | 'tie';
  outcome: 'tie' | 'advance' | 'shot';
}

export interface ShotReveal {
  kind: 'shot';
  id: number;
  shooter: Side;
  picks: Record<Side, Zone>;
  goal: boolean;
  /** True for a kick of a penalty shootout (it does not change the match score). */
  penalty?: boolean;
}

export interface ShootoutKick {
  shooter: Side;
  goal: boolean;
}

/**
 * Knockout tie-breaker. Both sides take one kick per round (`first` goes first). The shootout ends after a
 * round in which exactly one side scored; if both scored or both missed, another round is played.
 */
export interface Shootout {
  first: Side;
  kicks: ShootoutKick[];
}

export type Reveal = DuelReveal | ShotReveal;

export type Phase = 'transfer' | 'duel' | 'shot' | 'reveal' | 'halftime' | 'fulltime';

export interface MatchState {
  phase: Phase;
  half: 1 | 2;
  node: number; // -1, 0, +1 (from Team A's side)
  resolvedInHalf: number;
  resolvedTotal: number;
  sides: Record<Side, SideState>;
  shot: { shooter: Side } | null;
  /** Knockout matches (tournament): a drawn match goes to a penalty shootout and never ends level. */
  knockout: boolean;
  shootout: Shootout | null;
  /** Set at full time of a knockout match only. */
  winner: Side | null;
  reveal: Reveal | null;
  /** Timestamp (ms, host clock) at which an auto-resolution fires. */
  deadline: number | null;
  /** Incremented on every accepted action. */
  seq: number;
  /** Serialized RNG state (mulberry32). */
  rng: number;
}

export type Action =
  | { type: 'buy'; side: Side; playerId: string }
  | { type: 'unbuy'; side: Side; position: Position }
  | { type: 'transferReady'; side: Side }
  | { type: 'discard'; side: Side; cards: CardId[] }
  | { type: 'lock'; side: Side; cards: CardId[]; at?: number }
  | { type: 'shotPick'; side: Side; zone: Zone; at?: number }
  | { type: 'continue'; side: Side }
  | { type: 'rematch'; side: Side }
  | { type: 'timeout'; at?: number };

/** Player intents are actions without the side (the host fills it in). */
export type Intent =
  | { type: 'buy'; playerId: string }
  | { type: 'unbuy'; position: Position }
  | { type: 'transferReady' }
  | { type: 'discard'; cards: CardId[] }
  | { type: 'lock'; cards: CardId[] }
  | { type: 'shotPick'; zone: Zone }
  | { type: 'continue' }
  | { type: 'rematch' };

export function other(side: Side): Side {
  return side === 'A' ? 'B' : 'A';
}
