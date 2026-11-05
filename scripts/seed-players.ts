/**
 * Generates src/data/players.json from the hand-written table below.
 * Prices are derived from the Monte Carlo power score (see engine/power.ts) so the placeholder
 * roster is balanced out of the box. Run: `npm run seed` (use `-- --dry` to only print).
 *
 * This is only used to bootstrap placeholder data; the real roster is edited in /admin.
 */
import { writeFileSync } from 'node:fs';
import { catalog, balance, makeContext } from '../src/data';
import { powerScore, suggestPrice } from '../src/engine/power';
import type { Player, Position, Trait } from '../src/engine/types';

type Seed = [Position, string, string, Trait];
const t = (type: string, params: Record<string, unknown>): Trait => ({ type, params });
const kb = (...b: [string, number, number][]) =>
  t('keeper_hand_bonus', { bonuses: b.map(([hand, chips, mult]) => ({ hand, chips, mult })) });

const SEEDS: Seed[] = [
  // ---- Goalkeepers (rookie, rookie, mid, mid, star, star, legend, legend) ---------------------
  ['GK', 'Tomas', 'Kralik', kb(['high_card', 10, 1], ['pair', 10, 0])],
  ['GK', 'Ivo', 'Brandt', kb(['four_of_a_kind', 60, 4], ['straight_flush', 100, 6])],
  ['GK', 'Marek', 'Sorel', kb(['three_of_a_kind', 15, 1], ['straight', 15, 1])],
  ['GK', 'Luca', 'Verhaeg', kb(['two_pair', 10, 0], ['full_house', 20, 1])],
  ['GK', 'Oskar', 'Hallin', kb(['pair', 10, 1], ['two_pair', 10, 0])],
  ['GK', 'Dario', 'Fenwick', kb(['pair', 15, 1], ['two_pair', 15, 1])],
  ['GK', 'Anton', 'Valk', kb(['two_pair', 20, 1], ['flush', 30, 2])],
  ['GK', 'Nico', 'Baraldi', kb(['pair', 25, 2], ['two_pair', 20, 1])],

  // ---- Defenders -----------------------------------------------------------------------------
  ['DEF', 'Felix', 'Marchetti', t('extra_discards', { amount: 1 })],
  ['DEF', 'Bruno', 'Castell', t('chips_per_scoring_ace', { chips: 20 })],
  ['DEF', 'Hugo', 'Lindqvist', t('chips_per_scoring_face', { chips: 8 })],
  ['DEF', 'Pavel', 'Nordin', t('chips_per_scoring_face', { chips: 15 })],
  ['DEF', 'Emil', 'Rossetti', t('mult_per_scoring_suit', { suit: 'spades', mult: 1 })],
  ['DEF', 'Ravi', 'Okonkwo', t('mult_per_unused_discard', { mult: 1 })],
  ['DEF', 'Stefan', 'Draganov', t('mult_per_scoring_suit', { suit: 'clubs', mult: 2 })],
  ['DEF', 'Viktor', 'Almeida', t('mult_per_scoring_rank_group', { group: 'even', mult: 2 })],

  // ---- Midfielders ---------------------------------------------------------------------------
  ['MID', 'Sven', 'Aldridge', t('extra_discards', { amount: 1 })],
  ['MID', 'Jonas', 'Ekberg', t('chips_per_scoring_ace', { chips: 20 })],
  ['MID', 'Mateo', 'Quiroga', t('chips_per_scoring_face', { chips: 8 })],
  ['MID', 'Remy', 'Duclos', t('extra_hand_size', { amount: 1 })],
  ['MID', 'Arda', 'Yilmaz', t('mult_on_hand_type', { hands: ['two_pair'], mult: 3 })],
  ['MID', 'Kai', 'Brenner', t('mult_if_cards_played_at_most', { n: 2, mult: 4 })],
  ['MID', 'Zane', 'Whitlock', t('mult_per_unused_discard', { mult: 2 })],
  ['MID', 'Leon', 'Petrov', t('mult_per_scoring_rank_group', { group: 'odd', mult: 2 })],

  // ---- Forwards ------------------------------------------------------------------------------
  ['FWD', 'Dante', 'Moretti', t('chips_per_scoring_ace', { chips: 20 })],
  ['FWD', 'Niko', 'Savic', t('extra_discards', { amount: 1 })],
  ['FWD', 'Teo', 'Barros', t('chips_per_scoring_face', { chips: 15 })],
  ['FWD', 'Jakob', 'Strand', t('extra_hand_size', { amount: 1 })],
  ['FWD', 'Rafa', 'Delgado', t('mult_if_cards_played_at_most', { n: 2, mult: 6 })],
  ['FWD', 'Ilan', 'Kessler', t('mult_on_hand_type', { hands: ['two_pair'], mult: 3 })],
  ['FWD', 'Axel', 'Ferreira', t('xmult_on_hand_type', { hands: ['two_pair', 'straight', 'flush'], xmult: 2.5 })],
  ['FWD', 'Mika', 'Tanaka', t('mult_on_hand_type', { hands: ['pair', 'two_pair'], mult: 6 })],
];

const dry = process.argv.includes('--dry');
const ctx = makeContext([]);
const counters: Record<string, number> = {};
const players: Player[] = [];
const rows: string[] = [];

for (const [position, firstName, lastName, trait] of SEEDS) {
  const n = (counters[position] = (counters[position] ?? 0) + 1);
  const id = `${position.toLowerCase()}-${String(n).padStart(3, '0')}`;
  const p: Player = { id, firstName, lastName, position, price: 0, trait };
  const power = powerScore(ctx, p, 2000);
  p.price = suggestPrice(balance, power);
  players.push(p);
  rows.push(`${id}  ${(firstName + ' ' + lastName).padEnd(20)} ${trait.type.padEnd(30)} power=${power.toFixed(3)} price=$${p.price}`);
}
console.log(rows.join('\n'));
void catalog;

if (!dry) {
  const out = players.map((p) => ({
    id: p.id,
    firstName: p.firstName,
    lastName: p.lastName,
    position: p.position,
    price: p.price,
    trait: { type: p.trait.type, params: p.trait.params },
  }));
  writeFileSync(new URL('../src/data/players.json', import.meta.url), JSON.stringify(out, null, 2) + '\n');
  console.log(`\nWrote ${out.length} players.`);
}
