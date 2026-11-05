import { bestPlay, chooseDiscards } from './ai';
import { fullDeck } from './cards';
import { Rng } from './rng';
import { traitModifiers } from './traits';
import type { Balance, CardId, GameContext, Player, Position, Trait } from './types';

/** Simulates one duel hand with the AI strategy (discards + best subset) and returns the score. */
export function simulateDuelScore(
  ctx: GameContext,
  rng: Rng,
  activeTrait: Trait | null,
  keeperTrait: Trait | null,
): number {
  const mods = traitModifiers(activeTrait);
  const deck = rng.shuffle(fullDeck());
  let hand: CardId[] = deck.splice(0, ctx.balance.handSize + mods.extraHandSize);
  let discardsLeft = ctx.balance.discards + mods.extraDiscards;
  for (;;) {
    const setup = { activeTrait, keeperTrait, discardsLeft };
    const best = bestPlay(ctx, hand, setup);
    const toss = chooseDiscards(ctx, hand, best.result, discardsLeft);
    if (!toss.length) return best.result.score;
    const fresh = deck.splice(0, toss.length);
    let i = 0;
    hand = hand.flatMap((c) => (toss.includes(c) ? (i < fresh.length ? [fresh[i++]] : []) : [c]));
    discardsLeft -= toss.length;
  }
}

export interface PowerStats {
  baseline: number;
  withTrait: number;
  /** Relative uplift of the average duel score, e.g. 0.25 = +25%. */
  uplift: number;
  /** Probability that a duel hand with the trait beats a trait-less opponent hand (ties count half). */
  winProb: number;
}

/**
 * Samples duel scores with and without the trait over the same random hands, then compares every
 * with-trait score against every (other) trait-less score to get an exact win probability.
 */
export function measureTrait(
  ctx: GameContext,
  trait: Trait,
  position: Position,
  samples = 1500,
  seed = 12345,
): PowerStats {
  const isKeeper = position === 'GK';
  const base: number[] = [];
  const withT: number[] = [];
  for (let i = 0; i < samples; i++) {
    const s = seed + i * 7919;
    base.push(simulateDuelScore(ctx, new Rng(s), null, null));
    withT.push(simulateDuelScore(ctx, new Rng(s), isKeeper ? null : trait, isKeeper ? trait : null));
  }
  const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
  const sorted = base.slice().sort((a, b) => a - b);
  const lower = (v: number) => {
    let lo = 0;
    let hi = sorted.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid] < v) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  const upper = (v: number) => {
    let lo = 0;
    let hi = sorted.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid] <= v) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  let score = 0;
  withT.forEach((w, i) => {
    const below = lower(w);
    const ties = upper(w) - below;
    score += below + ties * 0.5;
    // Remove the pair (w_i, base_i): same cards, not an independent opponent.
    score -= base[i] < w ? 1 : base[i] === w ? 0.5 : 0;
  });
  const winProb = score / (samples * (samples - 1));
  const b = sum(base) / samples;
  const w = sum(withT) / samples;
  return { baseline: b, withTrait: w, uplift: w / b - 1, winProb };
}

/**
 * Power score = how much more often a duel is won thanks to the trait (0 = nothing, 1 = always),
 * while the player is active, scaled by the position's price weight (keepers count in every duel).
 */
export function powerFromStats(ctx: GameContext, position: Position, traitType: string, stats: PowerStats): number {
  const tpl = ctx.catalog.find((t) => t.id === traitType);
  return Math.max(0, 2 * (stats.winProb - 0.5)) * (ctx.balance.priceWeights[position] ?? 1) * (tpl?.powerWeight ?? 1);
}

export function powerScore(ctx: GameContext, player: Pick<Player, 'trait' | 'position'>, samples = 1500): number {
  return powerFromStats(ctx, player.position, player.trait.type, measureTrait(ctx, player.trait, player.position, samples));
}

/** Maps a power score linearly onto the price range from balance.json. */
export function suggestPrice(balance: Balance, power: number): number {
  const { minPrice, maxPrice, powerAtMinPrice, powerAtMaxPrice } = balance.pricing;
  const t = (power - powerAtMinPrice) / (powerAtMaxPrice - powerAtMinPrice);
  return Math.round(minPrice + Math.max(0, Math.min(1, t)) * (maxPrice - minPrice));
}
