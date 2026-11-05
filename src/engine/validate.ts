import { bandIndexOf } from './market';
import { validateTrait } from './traits';
import type { GameContext, Player } from './types';
import { POSITIONS } from './types';

export interface ValidationReport {
  /** Errors block saving. */
  errors: { playerId: string; message: string }[];
  /** Warnings never block but must be visible. */
  warnings: string[];
}

export function validatePlayer(ctx: GameContext, p: Player): string[] {
  const errors: string[] = [];
  if (!p.id?.trim()) errors.push('missing id');
  if (!p.firstName?.trim()) errors.push('missing first name');
  if (!p.lastName?.trim()) errors.push('missing last name');
  if (!POSITIONS.includes(p.position)) errors.push('invalid position');
  if (!Number.isFinite(p.price) || p.price <= 0 || !Number.isInteger(p.price))
    errors.push('invalid price (positive whole number required)');
  else if (p.price > ctx.balance.budget) errors.push(`price exceeds the budget of $${ctx.balance.budget}`);
  errors.push(...validateTrait(p.trait, p.position, ctx.catalog));
  return errors;
}

export function validateDb(ctx: GameContext, list: Player[]): ValidationReport {
  const errors: ValidationReport['errors'] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();
  for (const p of list) {
    if (seen.has(p.id)) errors.push({ playerId: p.id, message: `duplicate id "${p.id}"` });
    seen.add(p.id);
    for (const m of validatePlayer(ctx, p)) errors.push({ playerId: p.id, message: m });
  }

  // Market feasibility warnings.
  const { balance } = ctx;
  let cheapestTotal = 0;
  for (const pos of POSITIONS) {
    const at = list.filter((p) => p.position === pos);
    if (at.length < balance.offersPerPosition)
      warnings.push(`${pos}: only ${at.length} player(s), markets need ${balance.offersPerPosition} offers.`);
    const bands = balance.priceBands.map(() => 0);
    for (const p of at) bands[bandIndexOf(balance, p.price)]++;
    bands.forEach((n, i) => {
      if (n === 0)
        warnings.push(`${pos}: price band "${balance.priceBands[i].id}" is empty (offers fall back to the nearest band).`);
    });
    if (at.length) {
      const cheapest = Math.min(...at.map((p) => p.price));
      cheapestTotal += cheapest;
      if (cheapest > balance.cheapestSumCap / 4 + 5)
        warnings.push(`${pos}: no cheap player available (cheapest is $${cheapest}).`);
    }
  }
  if (cheapestTotal > balance.cheapestSumCap)
    warnings.push(
      `Even the cheapest player of every position costs $${cheapestTotal} in total (cap is $${balance.cheapestSumCap}); the cheapest-offer sum cap cannot be guaranteed.`,
    );
  return { errors, warnings };
}
