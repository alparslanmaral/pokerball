import {
  type Action,
  type ClientView,
  type GameContext,
  type Intent,
  type MatchState,
  type Side,
  aiNextAction,
  createMatch,
  other,
  project,
  randomSeed,
  reduce,
  Rng,
} from '../engine';

type Sink = (view: ClientView) => void;

export interface HostOptions {
  ctx: GameContext;
  names: Record<Side, string>;
  seed?: number;
  /** Sides controlled by the built-in AI. */
  aiSides?: Side[];
  /** Min/max "thinking" delay of the AI in ms. */
  aiDelay?: [number, number];
}

/**
 * Authoritative game host: owns the MatchState, applies intents, runs timers and the AI,
 * and pushes per-player projections to its clients. Used by both single-player and online host.
 */
export class GameHost {
  private state: MatchState;
  private sinks: Partial<Record<Side, Sink>> = {};
  private timer: ReturnType<typeof setTimeout> | null = null;
  private aiTimers: ReturnType<typeof setTimeout>[] = [];
  private aiRng = new Rng(randomSeed());
  private closed = false;

  constructor(private opts: HostOptions) {
    this.state = createMatch(opts.ctx, { seed: opts.seed ?? randomSeed(), names: opts.names });
  }

  get snapshot(): MatchState {
    return this.state;
  }

  attach(side: Side, sink: Sink): () => void {
    this.sinks[side] = sink;
    sink(project(this.opts.ctx, this.state, side, Date.now()));
    this.scheduleAI();
    return () => {
      if (this.sinks[side] === sink) delete this.sinks[side];
    };
  }

  /** Apply an intent from a human player. */
  submit(side: Side, intent: Intent): void {
    if (this.closed) return;
    const action = { ...intent, side, at: Date.now() } as Action;
    this.apply(action);
  }

  close(): void {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.aiTimers.forEach(clearTimeout);
    this.sinks = {};
  }

  private apply(action: Action): void {
    const next = reduce(this.opts.ctx, this.state, action);
    if (next === this.state) return;
    this.state = next;
    this.afterChange();
  }

  private afterChange(): void {
    this.broadcast();
    this.armTimer();
    this.scheduleAI();
  }

  private broadcast(): void {
    const now = Date.now();
    for (const side of ['A', 'B'] as const) {
      const sink = this.sinks[side];
      if (sink) sink(project(this.opts.ctx, this.state, side, now));
    }
  }

  /** One engine-level timer: ready/shot deadlines and the reveal/halftime fail-safe. */
  private armTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const { phase, deadline, seq } = this.state;
    let delay: number | null = null;
    if ((phase === 'duel' || phase === 'shot') && deadline !== null) delay = deadline - Date.now();
    else if (phase === 'reveal') delay = this.opts.ctx.balance.revealFailsafeSeconds * 1000;
    else if (phase === 'halftime') delay = this.opts.ctx.balance.revealFailsafeSeconds * 2000;
    if (delay === null) return;
    this.timer = setTimeout(() => {
      if (this.state.seq === seq) this.apply({ type: 'timeout', at: Date.now() });
    }, Math.max(0, delay));
  }

  private scheduleAI(): void {
    const sides = this.opts.aiSides ?? [];
    if (!sides.length || this.closed) return;
    this.aiTimers.forEach(clearTimeout);
    this.aiTimers = [];
    const seq = this.state.seq;
    for (const side of sides) {
      const [lo, hi] = this.opts.aiDelay ?? [900, 2600];
      const phase = this.state.phase;
      // The AI waits for the human before auto-continuing, and reacts quickly to non-duel steps.
      const fast = phase === 'transfer' ? [500, 1200] : phase === 'reveal' || phase === 'halftime' ? [3500, 4500] : [lo, hi];
      const delay = fast[0] + this.aiRng.next() * (fast[1] - fast[0]);
      this.aiTimers.push(
        setTimeout(() => {
          if (this.closed) return;
          // Re-plan on the latest state; if state moved on, scheduleAI has already been re-run.
          if (this.state.seq !== seq) return;
          const action = aiNextAction(this.opts.ctx, this.state, side, this.aiRng);
          if (!action) return;
          this.apply({ ...action, at: Date.now() } as Action);
        }, delay),
      );
    }
  }

  /** The opposite side of a human-controlled one (convenience). */
  static opponent(side: Side): Side {
    return other(side);
  }
}
