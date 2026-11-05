import { SUIT_GLYPH, isEvenRank, isFace, isOddRank, parseCard } from './cards';
import type {
  Balance,
  Card,
  GameContext,
  HandId,
  KeeperBonus,
  ParamDef,
  Player,
  Position,
  Trait,
  TraitTemplate,
} from './types';
import { HAND_IDS } from './types';

export interface EffectInput {
  hand: HandId;
  scoring: Card[];
  playedCount: number;
  discardsLeft: number;
}

export interface Effect {
  chips?: number;
  mult?: number;
  xmult?: number;
}

const SUIT_BY_NAME: Record<string, string> = { spades: 'S', hearts: 'H', diamonds: 'D', clubs: 'C' };

const count = (cards: Card[], pred: (c: Card) => boolean) => cards.filter(pred).length;

type EffectFn = (p: Record<string, any>, e: EffectInput) => Effect;

/** Scoring effect of each trait template. Triggers apply to scoring cards only. */
const EFFECTS: Record<string, EffectFn> = {
  chips_per_scoring_face: (p, e) => ({ chips: p.chips * count(e.scoring, isFace) }),
  chips_per_scoring_ace: (p, e) => ({ chips: p.chips * count(e.scoring, (c) => c.rank === 14) }),
  chips_per_scoring_suit: (p, e) => ({ chips: p.chips * count(e.scoring, (c) => c.suit === SUIT_BY_NAME[p.suit]) }),
  mult_per_scoring_suit: (p, e) => ({ mult: p.mult * count(e.scoring, (c) => c.suit === SUIT_BY_NAME[p.suit]) }),
  mult_per_scoring_rank_group: (p, e) => ({
    mult: p.mult * count(e.scoring, p.group === 'even' ? isEvenRank : isOddRank),
  }),
  chips_on_hand_type: (p, e) => ((p.hands as HandId[]).includes(e.hand) ? { chips: p.chips } : {}),
  mult_on_hand_type: (p, e) => ((p.hands as HandId[]).includes(e.hand) ? { mult: p.mult } : {}),
  xmult_on_hand_type: (p, e) => ((p.hands as HandId[]).includes(e.hand) ? { xmult: p.xmult } : {}),
  mult_per_unused_discard: (p, e) => ({ mult: p.mult * e.discardsLeft }),
  mult_if_cards_played_at_most: (p, e) => (e.playedCount <= p.n ? { mult: p.mult } : {}),
  extra_discards: () => ({}),
  extra_hand_size: () => ({}),
  keeper_hand_bonus: (p, e) => {
    const b = (p.bonuses as KeeperBonus[]).find((x) => x.hand === e.hand);
    return b ? { chips: b.chips, mult: b.mult } : {};
  },
};

export function traitEffect(trait: Trait | null | undefined, input: EffectInput): Effect {
  if (!trait) return {};
  const fn = EFFECTS[trait.type];
  return fn ? fn(trait.params, input) : {};
}

/** Per-duel hand-size / discard modifiers granted by a trait of an *active* player. */
export function traitModifiers(trait: Trait | null | undefined): { extraDiscards: number; extraHandSize: number } {
  if (!trait) return { extraDiscards: 0, extraHandSize: 0 };
  return {
    extraDiscards: trait.type === 'extra_discards' ? Number(trait.params.amount) || 0 : 0,
    extraHandSize: trait.type === 'extra_hand_size' ? Number(trait.params.amount) || 0 : 0,
  };
}

export function findTemplate(catalog: TraitTemplate[], type: string): TraitTemplate | undefined {
  return catalog.find((t) => t.id === type);
}

// ---------------------------------------------------------------------------
// Description

function formatSuit(name: string): string {
  const letter = SUIT_BY_NAME[name];
  return letter ? `${SUIT_GLYPH[letter as keyof typeof SUIT_GLYPH]} ${name.replace(/s$/, '')}` : name;
}

function formatHands(hands: HandId[], balance: Balance): string {
  const labels = hands.map((h) => balance.hands[h]?.label ?? h);
  if (labels.length <= 1) return labels.join('');
  return labels.slice(0, -1).join(', ') + ' or ' + labels[labels.length - 1];
}

function formatBonuses(bonuses: KeeperBonus[], balance: Balance): string {
  return bonuses
    .map((b) => {
      const parts: string[] = [];
      if (b.chips) parts.push(`+${b.chips} chips`);
      if (b.mult) parts.push(`+${b.mult} mult`);
      return `${balance.hands[b.hand]?.label ?? b.hand} ${parts.join(' ')}`;
    })
    .join('; ');
}

export function describeTrait(trait: Trait, catalog: TraitTemplate[], balance: Balance): string {
  const tpl = findTemplate(catalog, trait.type);
  if (!tpl) return `Unknown trait (${trait.type})`;
  return tpl.description.replace(/\{(\w+)\}/g, (_, key: string) => {
    const v = trait.params[key];
    if (v === undefined) return `{${key}}`;
    const def = tpl.params[key];
    if (def?.type === 'hands') return formatHands(v as HandId[], balance);
    if (def?.type === 'bonuses') return formatBonuses(v as KeeperBonus[], balance);
    if (key === 'suit') return formatSuit(String(v));
    return String(v);
  });
}

export function describePlayerTrait(player: Player, ctx: GameContext): string {
  return describeTrait(player.trait, ctx.catalog, ctx.balance);
}

export function traitLabel(trait: Trait, catalog: TraitTemplate[]): string {
  return findTemplate(catalog, trait.type)?.label ?? trait.type;
}

// ---------------------------------------------------------------------------
// Validation

function validateParam(key: string, def: ParamDef, v: unknown, errors: string[]): void {
  switch (def.type) {
    case 'number': {
      if (typeof v !== 'number' || !Number.isFinite(v)) errors.push(`${key}: must be a number`);
      else if (v < def.min - 1e-9 || v > def.max + 1e-9) errors.push(`${key}: ${v} is outside ${def.min}..${def.max}`);
      break;
    }
    case 'enum':
      if (!def.options.includes(v as string)) errors.push(`${key}: must be one of ${def.options.join(', ')}`);
      break;
    case 'hands': {
      if (!Array.isArray(v)) {
        errors.push(`${key}: must be a list of hands`);
        break;
      }
      if (v.length < def.minCount || v.length > def.maxCount)
        errors.push(`${key}: choose ${def.minCount}-${def.maxCount} hands`);
      if (new Set(v).size !== v.length) errors.push(`${key}: duplicate hands`);
      if (v.some((h) => !(HAND_IDS as readonly string[]).includes(h))) errors.push(`${key}: unknown hand type`);
      break;
    }
    case 'bonuses': {
      if (!Array.isArray(v)) {
        errors.push(`${key}: must be a list of bonuses`);
        break;
      }
      const hands = v.map((b) => b?.hand);
      if (v.length !== def.count) errors.push(`keeper needs exactly ${def.count} hand bonuses`);
      if (new Set(hands).size !== hands.length) errors.push('keeper hands must be distinct');
      for (const b of v) {
        const bounds = def.bounds[b?.hand as HandId];
        if (!bounds) {
          errors.push(`unknown keeper hand "${b?.hand}"`);
          continue;
        }
        if (typeof b.chips !== 'number' || b.chips < bounds.chips.min || b.chips > bounds.chips.max)
          errors.push(`${b.hand}: chips must be ${bounds.chips.min}..${bounds.chips.max}`);
        if (typeof b.mult !== 'number' || b.mult < bounds.mult.min || b.mult > bounds.mult.max)
          errors.push(`${b.hand}: mult must be ${bounds.mult.min}..${bounds.mult.max}`);
      }
      break;
    }
  }
}

/** Returns a list of error messages (empty = valid). */
export function validateTrait(trait: Trait, position: Position, catalog: TraitTemplate[]): string[] {
  const errors: string[] = [];
  const tpl = findTemplate(catalog, trait.type);
  if (!tpl) return [`unknown trait template "${trait.type}"`];
  if (!tpl.allowedPositions.includes(position)) errors.push(`trait "${tpl.label}" is not allowed for ${position}`);
  for (const [key, def] of Object.entries(tpl.params)) {
    if (!(key in trait.params)) errors.push(`${key}: missing`);
    else validateParam(key, def, trait.params[key], errors);
  }
  return errors;
}

export function defaultTraitFor(tpl: TraitTemplate): Trait {
  const params: Record<string, any> = {};
  for (const [k, def] of Object.entries(tpl.params)) params[k] = structuredClone(def.default);
  return { type: tpl.id, params };
}

export { parseCard };
