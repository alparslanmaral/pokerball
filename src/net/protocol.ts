import type { ClientView, Intent } from '../engine';

/** Wire protocol between the room creator (host, authoritative) and the guest. */
export type Msg =
  | { t: 'hello'; v: number; username: string; hash: string }
  | { t: 'welcome'; username: string }
  | { t: 'reject'; reason: 'version' | 'full' | 'protocol'; message: string }
  | { t: 'intent'; intent: Intent }
  | { t: 'view'; view: ClientView }
  | { t: 'ping' }
  | { t: 'bye' };

export const PROTOCOL_VERSION = 1;

/** Minimal duplex message channel: implemented by PeerJS in the browser and by memory pairs in tests. */
export interface Channel {
  send(msg: Msg): void;
  onMessage(cb: (msg: Msg) => void): void;
  onClose(cb: () => void): void;
  close(): void;
}

/** Intent types a guest is allowed to send (anything else is ignored by the host). */
export const INTENT_TYPES = ['buy', 'unbuy', 'transferReady', 'discard', 'lock', 'shotPick', 'continue', 'rematch'] as const;

export function isIntent(x: unknown): x is Intent {
  return !!x && typeof x === 'object' && (INTENT_TYPES as readonly string[]).includes((x as { type?: string }).type ?? '');
}

interface MemoryChannel extends Channel {
  dropped: boolean;
  peer: MemoryChannel | null;
  msgCb: (m: Msg) => void;
  closeCb: () => void;
}

/** In-memory channel pair for tests. Messages are JSON round-tripped like a real connection. */
export function memoryChannelPair(): [MemoryChannel, MemoryChannel] {
  const make = (): MemoryChannel => {
    const ch: MemoryChannel = {
      dropped: false,
      peer: null,
      msgCb: () => {},
      closeCb: () => {},
      send(msg) {
        if (ch.dropped || !ch.peer || ch.peer.dropped) return;
        const copy = JSON.parse(JSON.stringify(msg)) as Msg;
        queueMicrotask(() => ch.peer?.msgCb(copy));
      },
      onMessage(cb) {
        ch.msgCb = cb;
      },
      onClose(cb) {
        ch.closeCb = cb;
      },
      close() {
        if (ch.dropped) return;
        ch.dropped = true;
        queueMicrotask(() => ch.peer?.closeCb());
      },
    };
    return ch;
  };
  const a = make();
  const b = make();
  a.peer = b;
  b.peer = a;
  return [a, b];
}
