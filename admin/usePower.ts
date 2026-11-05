import { useEffect, useRef, useState } from 'react';
import type { Balance, PowerStats, Position, Trait, TraitTemplate } from '../src/engine';

export interface PowerResult {
  stats: PowerStats;
  power: number;
}

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, (r: PowerResult) => void>();
const cache = new Map<string, PowerResult>();

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./powerWorker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<{ id: number } & PowerResult>) => {
      pending.get(e.data.id)?.(e.data);
      pending.delete(e.data.id);
    };
  }
  return worker;
}

export function measurePower(
  balance: Balance,
  catalog: TraitTemplate[],
  trait: Trait,
  position: Position,
  samples: number,
): Promise<PowerResult> {
  // powerWeight lives in the catalog, so it is part of the cache key.
  const tpl = catalog.find((t) => t.id === trait.type);
  const key = `${samples}|${position}|${tpl?.powerWeight}|${JSON.stringify(trait)}|${JSON.stringify(balance.priceWeights)}`;
  const hit = cache.get(key);
  if (hit) return Promise.resolve(hit);
  return new Promise((resolve) => {
    const id = nextId++;
    pending.set(id, (r) => {
      cache.set(key, r);
      resolve(r);
    });
    getWorker().postMessage({ id, balance, catalog, trait, position, samples });
  });
}

/** Debounced power measurement of one player's trait (runs in a Web Worker). */
export function usePower(
  balance: Balance | null,
  catalog: TraitTemplate[],
  trait: Trait | null,
  position: Position | null,
  samples = 1500,
): { result: PowerResult | null; loading: boolean } {
  const [result, setResult] = useState<PowerResult | null>(null);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);
  const sig = trait && position ? `${position}|${JSON.stringify(trait)}` : '';
  useEffect(() => {
    if (!balance || !trait || !position) return;
    const mine = ++seq.current;
    setLoading(true);
    const t = setTimeout(() => {
      measurePower(balance, catalog, trait, position, samples).then((r) => {
        if (mine === seq.current) {
          setResult(r);
          setLoading(false);
        }
      });
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, balance, catalog, samples]);
  return { result, loading };
}
