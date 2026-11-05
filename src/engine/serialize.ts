import type { Player, TraitTemplate } from './types';
import { POSITIONS } from './types';

/**
 * Stable JSON writers for the data files: fixed key order and 2-space indent, so git diffs stay clean
 * no matter how the admin editor happens to build its objects.
 */

function orderParams(params: Record<string, unknown>, tpl?: TraitTemplate): Record<string, unknown> {
  const keys = tpl ? Object.keys(tpl.params) : Object.keys(params);
  const out: Record<string, unknown> = {};
  for (const k of keys) if (k in params) out[k] = orderValue(params[k]);
  for (const k of Object.keys(params)) if (!(k in out)) out[k] = orderValue(params[k]);
  return out;
}

function orderValue(v: unknown): unknown {
  if (Array.isArray(v)) return v.map((x) => (x && typeof x === 'object' ? orderBonus(x as Record<string, unknown>) : x));
  return v;
}

function orderBonus(b: Record<string, unknown>): Record<string, unknown> {
  if ('hand' in b) return { hand: b.hand, chips: b.chips, mult: b.mult };
  return b;
}

export function normalizePlayer(p: Player, catalog: TraitTemplate[]): Record<string, unknown> {
  const tpl = catalog.find((t) => t.id === p.trait.type);
  const out: Record<string, unknown> = {
    id: p.id,
    firstName: p.firstName,
    lastName: p.lastName,
    position: p.position,
    price: p.price,
  };
  if (p.image) out.image = p.image;
  out.trait = { type: p.trait.type, params: orderParams(p.trait.params, tpl) };
  return out;
}

export function serializePlayers(players: Player[], catalog: TraitTemplate[]): string {
  const sorted = players
    .slice()
    .sort((a, b) => POSITIONS.indexOf(a.position) - POSITIONS.indexOf(b.position) || a.id.localeCompare(b.id));
  return JSON.stringify(
    sorted.map((p) => normalizePlayer(p, catalog)),
    null,
    2,
  ) + '\n';
}

function orderParamDef(def: Record<string, any>): Record<string, unknown> {
  const order = ['type', 'min', 'max', 'step', 'options', 'minCount', 'maxCount', 'count', 'bounds', 'default'];
  const out: Record<string, unknown> = {};
  for (const k of order) if (k in def) out[k] = def[k];
  for (const k of Object.keys(def)) if (!(k in out)) out[k] = def[k];
  return out;
}

export function serializeTraits(catalog: TraitTemplate[]): string {
  const out = catalog.map((t) => ({
    id: t.id,
    label: t.label,
    description: t.description,
    enabled: t.enabled,
    allowedPositions: t.allowedPositions,
    powerWeight: t.powerWeight,
    params: Object.fromEntries(Object.entries(t.params).map(([k, d]) => [k, orderParamDef(d as Record<string, any>)])),
  }));
  return JSON.stringify(out, null, 2) + '\n';
}
