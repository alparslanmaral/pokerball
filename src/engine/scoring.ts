import { chipValue, parseCard } from './cards';
import { evaluateHand } from './hands';
import { traitEffect } from './traits';
import type { Balance, CardId, ScoreBreakdownEntry, ScoreResult, Trait } from './types';

export interface ScoreInput {
  cards: CardId[];
  /** Trait of the active (position-matched) player of this team. */
  activeTrait?: Trait | null;
  /** Trait of this team's goalkeeper (passive hand bonuses). */
  keeperTrait?: Trait | null;
  discardsLeft: number;
}

/**
 * Balatro-style scoring:
 *   chips = hand chips + scoring-card chips + trait/keeper chips
 *   mult  = hand mult  + additive mult bonuses, then * xmult bonuses
 *   score = chips * mult
 */
export function scoreHand(balance: Balance, input: ScoreInput): ScoreResult {
  const { hand, scoring } = evaluateHand(input.cards, balance);
  const base = balance.hands[hand];
  const scoringCards = scoring.map(parseCard);
  const breakdown: ScoreBreakdownEntry[] = [{ source: 'hand', chips: base.chips, mult: base.mult, xmult: 1 }];

  let chips = base.chips;
  let mult = base.mult;
  let xmult = 1;

  const cardChips = scoringCards.reduce((s, c) => s + chipValue(c, balance), 0);
  chips += cardChips;
  breakdown.push({ source: 'cards', chips: cardChips, mult: 0, xmult: 1 });

  const effectInput = { hand, scoring: scoringCards, playedCount: input.cards.length, discardsLeft: input.discardsLeft };
  for (const [source, trait] of [
    ['keeper', input.keeperTrait],
    ['trait', input.activeTrait],
  ] as const) {
    const e = traitEffect(trait, effectInput);
    if (e.chips || e.mult || e.xmult) {
      chips += e.chips ?? 0;
      mult += e.mult ?? 0;
      xmult *= e.xmult ?? 1;
      breakdown.push({ source, chips: e.chips ?? 0, mult: e.mult ?? 0, xmult: e.xmult ?? 1 });
    }
  }

  const finalMult = mult * xmult;
  const score = Math.round(chips * finalMult * 100) / 100;
  return { hand, scoring, chips, mult: Math.round(finalMult * 100) / 100, score, breakdown };
}
