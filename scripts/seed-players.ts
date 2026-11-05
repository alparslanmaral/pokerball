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
  // ---- Goalkeepers -------------------------------------------------------------------------
  ['GK', 'Tomas', 'Kralik', kb(['high_card', 10, 0], ['pair', 10, 1])],
  ['GK', 'Ivo', 'Brandt', kb(['high_card', 8, 1], ['two_pair', 10, 0])],
  ['GK', 'Marek', 'Sorel', kb(['pair', 15, 1], ['two_pair', 15, 1])],
  ['GK', 'Luca', 'Verhaeg', kb(['pair', 10, 2], ['three_of_a_kind', 15, 1])],
  ['GK', 'Oskar', 'Hallin', kb(['three_of_a_kind', 25, 2], ['straight', 20, 2])],
  ['GK', 'Dario', 'Fenwick', kb(['two_pair', 20, 2], ['flush', 25, 2])],
  ['GK', 'Anton', 'Valk', kb(['full_house', 40, 3], ['four_of_a_kind', 60, 4])],
  ['GK', 'Nico', 'Baraldi', kb(['straight', 40, 4], ['straight_flush', 80, 6])],

  // ---- Defenders ---------------------------------------------------------------------------
  ['DEF', 'Bruno', 'Castell', t('chips_per_scoring_face', { chips: 8 })],
  ['DEF', 'Pavel', 'Nordin', t('chips_per_scoring_suit', { suit: 'clubs', chips: 10 })],
  ['DEF', 'Emil', 'Rossetti', t('mult_per_scoring_rank_group', { group: 'even', mult: 1 })],
  ['DEF', 'Hugo', 'Lindqvist', t('chips_on_hand_type', { hands: ['pair', 'two_pair'], chips: 25 })],
  ['DEF', 'Ravi', 'Okonkwo', t('mult_on_hand_type', { hands: ['pair', 'three_of_a_kind'], mult: 4 })],
  ['DEF', 'Felix', 'Marchetti', t('extra_discards', { amount: 1 })],
  ['DEF', 'Stefan', 'Draganov', t('mult_per_scoring_suit', { suit: 'spades', mult: 2 })],
  ['DEF', 'Viktor', 'Almeida', t('xmult_on_hand_type', { hands: ['pair', 'two_pair', 'three_of_a_kind'], xmult: 1.5 })],

  // ---- Midfielders -------------------------------------------------------------------------
  ['MID', 'Jonas', 'Ekberg', t('chips_per_scoring_ace', { chips: 20 })],
  ['MID', 'Mateo', 'Quiroga', t('chips_per_scoring_face', { chips: 10 })],
  ['MID', 'Leon', 'Petrov', t('mult_per_scoring_suit', { suit: 'hearts', mult: 1 })],
  ['MID', 'Kai', 'Brenner', t('mult_per_unused_discard', { mult: 1 })],
  ['MID', 'Arda', 'Yilmaz', t('mult_on_hand_type', { hands: ['pair', 'two_pair'], mult: 4 })],
  ['MID', 'Sven', 'Aldridge', t('extra_hand_size', { amount: 1 })],
  ['MID', 'Remy', 'Duclos', t('mult_if_cards_played_at_most', { n: 2, mult: 4 })],
  ['MID', 'Zane', 'Whitlock', t('xmult_on_hand_type', { hands: ['pair', 'two_pair', 'three_of_a_kind'], xmult: 1.5 })],

  // ---- Forwards ----------------------------------------------------------------------------
  ['FWD', 'Dante', 'Moretti', t('chips_per_scoring_ace', { chips: 20 })],
  ['FWD', 'Niko', 'Savic', t('chips_per_scoring_suit', { suit: 'diamonds', chips: 10 })],
  ['FWD', 'Teo', 'Barros', t('mult_per_scoring_rank_group', { group: 'odd', mult: 1 })],
  ['FWD', 'Ilan', 'Kessler', t('chips_on_hand_type', { hands: ['straight', 'flush'], chips: 60 })],
  ['FWD', 'Mika', 'Tanaka', t('mult_on_hand_type', { hands: ['two_pair', 'three_of_a_kind'], mult: 5 })],
  ['FWD', 'Rafa', 'Delgado', t('mult_per_scoring_suit', { suit: 'hearts', mult: 2 })],
  ['FWD', 'Jakob', 'Strand', t('mult_if_cards_played_at_most', { n: 2, mult: 5 })],
  ['FWD', 'Axel', 'Ferreira', t('xmult_on_hand_type', { hands: ['flush', 'straight', 'full_house'], xmult: 1.8 })],
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
