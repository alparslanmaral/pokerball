import type { ClientView, Intent, TIntent, TournamentView } from '../engine';

export type ConnectionStatus = 'connecting' | 'open' | 'closed';

/**
 * What the UI talks to. The same UI runs against every implementation:
 *  - LocalAITransport: engine + AI run in this browser.
 *  - PeerTransport:    engine runs on the room creator's machine (host-authoritative).
 */
export interface GameTransport {
  /** Send a player intent (select/discard/lock/buy/shot pick/continue...). */
  send(intent: Intent): void;
  /** Subscribe to state snapshots (already projected for this player). Returns an unsubscribe fn. */
  onView(cb: (view: ClientView) => void): () => void;
  /** Subscribe to fatal events such as an opponent disconnect. */
  onClosed(cb: (reason: string) => void): () => void;
  close(): void;
}

/** Tournament counterpart of GameTransport: the UI talks to the tournament host (local or remote). */
export interface TournamentTransport {
  readonly kind: 'tournament';
  send(intent: TIntent): void;
  onView(cb: (view: TournamentView) => void): () => void;
  onClosed(cb: (reason: string) => void): () => void;
  close(): void;
}

export function isTournamentTransport(t: GameTransport | TournamentTransport): t is TournamentTransport {
  return (t as TournamentTransport).kind === 'tournament';
}
