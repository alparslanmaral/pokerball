/// <reference lib="webworker" />
import { measureTrait, powerFromStats } from '../src/engine/power';
import type { Balance, Position, Trait, TraitTemplate } from '../src/engine/types';

interface Req {
  id: number;
  balance: Balance;
  catalog: TraitTemplate[];
  trait: Trait;
  position: Position;
  samples: number;
}

self.onmessage = (e: MessageEvent<Req>) => {
  const { id, balance, catalog, trait, position, samples } = e.data;
  const ctx = { balance, catalog, players: {} };
  const stats = measureTrait(ctx, trait, position, samples);
  const power = powerFromStats(ctx, position, trait.type, stats);
  (self as unknown as Worker).postMessage({ id, stats, power });
};
