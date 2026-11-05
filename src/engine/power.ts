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
}

/** Average score with a trait vs. without any trait, over the same random hands (common random numbers). */
export function measureTrait(
  ctx: GameContext,
  trait: Trait,
  position: Position,
  samples = 1500,
  seed = 12345,
): PowerStats {
  let base = 0;
  let withTrait = 0;
  const isKeeper = position === 'GK';
  for (let i = 0; i < samples; i++) {
    const s = seed + i * 7919;
    base += simulateDuelScore(ctx, new Rng(s), null, null);
    withTrait += simulateDuelScore(ctx, new Rng(s), isKeeper ? null : trait, isKeeper ? trait : null);
  }
  base /= samples;
  withTrait /= samples;
  return { baseline: base, withTrait, uplift: withTrait / base - 1 };
}

/**
 * Usage-weighted power: uplift while the player is active, scaled by how often that position
 * is involved in a duel (keepers count in every duel).
 */
export function powerScore(ctx: GameContext, player: Pick<Player, 'trait' | 'position'>, samples = 1500): number {
  const stats = measureTrait(ctx, player.trait, player.position, samples);
  const tpl = ctx.catalog.find((t) => t.id === player.trait.type);
  return stats.uplift * (ctx.balance.usageWeights[player.position] ?? 1) * (tpl?.powerWeight ?? 1);
}

/** Maps a power score linearly onto the price range from balance.json. */
export function suggestPrice(balance: Balance, power: number): number {
  const { minPrice, maxPrice, powerAtMinPrice, powerAtMaxPrice } = balance.pricing;
  const t = (power - powerAtMinPrice) / (powerAtMaxPrice - powerAtMinPrice);
  return Math.round(minPrice + Math.max(0, Math.min(1, t)) * (maxPrice - minPrice));
}
