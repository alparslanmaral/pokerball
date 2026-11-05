import type { Balance, GameContext, Player, TraitTemplate } from '../engine/types';
import balanceJson from './balance.json';
import playersJson from './players.json';
import traitsJson from './traits.json';

export const balance = balanceJson as unknown as Balance;
export const catalog = traitsJson as unknown as TraitTemplate[];
export const playerList = playersJson as unknown as Player[];

export function makeContext(
  players: Player[] = playerList,
  b: Balance = balance,
  c: TraitTemplate[] = catalog,
): GameContext {
  return { balance: b, catalog: c, players: Object.fromEntries(players.map((p) => [p.id, p])) };
}

export const ctx: GameContext = makeContext();

/** Stable stringify (sorted keys) so the hash does not depend on key order. */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object')
    return `{${Object.keys(v as object)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  return JSON.stringify(v);
}

/** FNV-1a hash of the bundled game data. Both peers must agree on it before a match. */
export function hashData(players: Player[], b: Balance, c: TraitTemplate[]): string {
  const text = stable({ players, balance: b, catalog: c });
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export const dbVersionHash = hashData(playerList, balance, catalog);
