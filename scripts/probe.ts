/**
 * Quick trait probe: prints the active-duel uplift of candidate traits.
 *   npx tsx scripts/probe.ts '<json array of [position, type, params]>' [samples]
 */
import { balance, ctx } from '../src/data';
import { measureTrait, powerFromStats } from '../src/engine/power';
import { describeTrait } from '../src/engine/traits';
import type { Position } from '../src/engine/types';

const list = JSON.parse(process.argv[2]) as [Position, string, Record<string, unknown>][];
const samples = Number(process.argv[3] ?? 800);
for (const [pos, type, params] of list) {
  const trait = { type, params };
  const st = measureTrait(ctx, trait, pos, samples);
  const pw = powerFromStats(ctx, pos, type, st);
  console.log(
    `${pos} uplift ${(st.uplift * 100).toFixed(0).padStart(4)}%  winProb ${(st.winProb * 100).toFixed(1)}%  power=${pw.toFixed(3)}  ${describeTrait(trait, ctx.catalog, balance)}`,
  );
}
