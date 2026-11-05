import type { ClientView, GameContext, Intent } from '../engine';
import { GameHost } from './host';
import type { GameTransport } from './transport';

/** Single player: the engine and the AI opponent both run in this browser. */
export class LocalAITransport implements GameTransport {
  private host: GameHost;
  private views = new Set<(v: ClientView) => void>();
  private last: ClientView | null = null;
  private detach: () => void;

  constructor(ctx: GameContext, username: string) {
    this.host = new GameHost({ ctx, names: { A: username, B: 'AI Coach' }, aiSides: ['B'] });
    this.detach = this.host.attach('A', (v) => {
      this.last = v;
      this.views.forEach((cb) => cb(v));
    });
  }

  send(intent: Intent): void {
    this.host.submit('A', intent);
  }

  onView(cb: (view: ClientView) => void): () => void {
    this.views.add(cb);
    if (this.last) cb(this.last);
    return () => this.views.delete(cb);
  }

  onClosed(): () => void {
    return () => {};
  }

  close(): void {
    this.detach();
    this.host.close();
  }
}
