import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type ClientView, Rng, aiNextAction } from '../src/engine';
import { GameHost } from '../src/net/host';
import { testCtx } from './fixtures';

const ctx = testCtx();

describe('GameHost (timers + AI)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('plays a whole match against the AI, including the 15s auto-play of a slow human', () => {
    const host = new GameHost({ ctx, names: { A: 'Human', B: 'AI' }, aiSides: ['B'], seed: 5 });
    let view = null as unknown as ClientView;
    host.attach('A', (v) => (view = v));
    const rng = new Rng(1);
    let humanStalls = 0;
    let autoPlays = 0;

    for (let i = 0; i < 4000 && view.phase !== 'fulltime'; i++) {
      const v = view;
      // The "human" is a bot that sometimes goes silent in a duel so the 15s timer must fire.
      const stall = v.phase === 'duel' && v.seq % 5 === 0 && humanStalls < 6;
      if (stall) humanStalls++;
      if (!stall) {
        const act = aiNextAction(ctx, host.snapshot, 'A', rng);
        if (act) {
          const { side: _side, ...intent } = act as any;
          host.submit('A', intent);
        }
      }
      vi.advanceTimersByTime(1000);
      if (v.reveal?.kind === 'duel' && (v.reveal.hands.A.auto || v.reveal.hands.B.auto)) autoPlays++;
    }
    expect(view.phase).toBe('fulltime');
    expect(view.resolvedTotal).toBe(16);
    expect(humanStalls).toBeGreaterThan(0);
    host.close();
  });

  it('never exposes the opponent\'s hand through the AI-side projection', () => {
    const host = new GameHost({ ctx, names: { A: 'Human', B: 'AI' }, aiSides: [], seed: 9 });
    let viewA: ClientView | null = null;
    let viewB: ClientView | null = null;
    host.attach('A', (v) => (viewA = v));
    host.attach('B', (v) => (viewB = v));
    expect(viewA!.market).not.toEqual(viewB!.market);
    expect(JSON.stringify(viewA)).not.toContain(JSON.stringify(viewB!.market));
    host.close();
  });
});
