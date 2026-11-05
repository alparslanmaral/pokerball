/** Rewrites players.json and traits.json in the exact format the admin editor writes (stable diffs). */
import { writeFileSync } from 'node:fs';
import { catalog, playerList } from '../src/data';
import { serializePlayers, serializeTraits } from '../src/engine/serialize';

writeFileSync(new URL('../src/data/players.json', import.meta.url), serializePlayers(playerList, catalog));
writeFileSync(new URL('../src/data/traits.json', import.meta.url), serializeTraits(catalog));
console.log('Formatted src/data/players.json and src/data/traits.json');
