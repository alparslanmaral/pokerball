import Peer, { type DataConnection } from 'peerjs';
import type { GameContext } from '../engine';
import type { Channel, Msg } from './protocol';
import { acceptGuest, joinHost } from './session';
import type { GameTransport } from './transport';

/**
 * PeerJS (WebRTC) glue. Uses the public PeerJS broker for signalling and public STUN servers only:
 * there is no TURN relay, so some strict networks (corporate / carrier-grade NAT) cannot connect.
 */
const PEER_CONFIG = {
  config: {
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:global.stun.twilio.com:3478' }],
  },
  debug: 0,
};

const ID_PREFIX = 'pokerpitch-';
// No 0/O/1/I to avoid reading mistakes.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const JOIN_TIMEOUT_MS = 20000;
const OPEN_TIMEOUT_MS = 15000;

export function newRoomCode(random: () => number = Math.random): string {
  return Array.from({ length: 5 }, () => ALPHABET[Math.floor(random() * ALPHABET.length)]).join('');
}

export interface RoomHandle {
  code: string;
  /** Resolves once the room is registered with the broker; only then can a guest find it. */
  opened: Promise<void>;
  /** Resolves with the transport once a guest has joined and the handshake succeeded. */
  ready: Promise<GameTransport>;
  cancel(): void;
}

function wrap(conn: DataConnection): Channel {
  return {
    send: (msg: Msg) => conn.send(msg),
    onMessage: (cb) => conn.on('data', (d) => cb(d as Msg)),
    onClose: (cb) => {
      conn.on('close', cb);
      conn.on('error', cb);
    },
    close: () => conn.close(),
  };
}

function describeError(err: { type?: string; message?: string }, code?: string): string {
  switch (err.type) {
    case 'unavailable-id':
      return 'That room code is already in use. Please try again.';
    case 'peer-unavailable':
      return `Room "${code}" was not found. Check the code, and make sure the host is still waiting.`;
    case 'network':
    case 'server-error':
    case 'socket-error':
    case 'socket-closed':
      return 'Could not reach the matchmaking server. Check your internet connection and try again.';
    case 'webrtc':
      return 'The peer-to-peer connection failed. Some networks block WebRTC and no relay server is configured.';
    default:
      return err.message ?? 'Connection error.';
  }
}

/** Closing the transport also tears down the PeerJS peer. */
function withPeerCleanup<T extends GameTransport>(transport: T, peer: Peer): T {
  const close = transport.close.bind(transport);
  transport.close = () => {
    close();
    peer.destroy();
  };
  return transport;
}

export function createRoom(ctx: GameContext, username: string): RoomHandle {
  const code = newRoomCode();
  const peer = new Peer(ID_PREFIX + code, PEER_CONFIG);
  let settled = false;
  let guestTaken = false;
  let rejectReady: (e: Error) => void = () => {};
  const opened = new Promise<void>((resolve) => peer.on('open', () => resolve()));
  opened.catch(() => {});
  // The public broker can be slow or unreachable: fail loudly instead of waiting forever.
  const openTimer = setTimeout(() => {
    if (settled) return;
    settled = true;
    peer.destroy();
    rejectReady(new Error('Could not reach the matchmaking server (PeerJS). Check your connection and try again.'));
  }, OPEN_TIMEOUT_MS);
  peer.on('open', () => clearTimeout(openTimer));

  const ready = new Promise<GameTransport>((resolve, reject) => {
    rejectReady = reject;
    peer.on('error', (err) => {
      if (settled) return;
      settled = true;
      peer.destroy();
      reject(new Error(describeError(err)));
    });
    peer.on('connection', (conn) => {
      if (guestTaken) {
        conn.on('open', () => {
          conn.send({ t: 'reject', reason: 'full', message: 'This room is already full.' } satisfies Msg);
          setTimeout(() => conn.close(), 300);
        });
        return;
      }
      guestTaken = true;
      acceptGuest(ctx, username, wrap(conn)).then(
        (t) => {
          settled = true;
          resolve(withPeerCleanup(t, peer));
        },
        (e: Error) => {
          settled = true;
          peer.destroy();
          reject(e);
        },
      );
    });
  });

  return {
    code,
    opened,
    ready,
    cancel: () => {
      if (!settled) {
        settled = true;
        rejectReady(new Error('Room closed.'));
      }
      peer.destroy();
    },
  };
}

export function joinRoom(
  _ctx: GameContext,
  code: string,
  username: string,
): { ready: Promise<GameTransport>; cancel(): void } {
  const peer = new Peer(PEER_CONFIG);
  let settled = false;
  let rejectReady: (e: Error) => void = () => {};

  const ready = new Promise<GameTransport>((resolve, reject) => {
    rejectReady = reject;
    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      peer.destroy();
      reject(new Error(message));
    };
    const timer = setTimeout(
      () => fail('Could not connect. Some networks block peer-to-peer connections (no relay server is configured).'),
      JOIN_TIMEOUT_MS,
    );
    peer.on('error', (err) => fail(describeError(err, code)));
    peer.on('open', () => {
      const conn = peer.connect(ID_PREFIX + code, { reliable: true, serialization: 'json' });
      conn.on('error', (e) => fail(describeError(e as { type?: string; message?: string }, code)));
      conn.on('open', () => {
        joinHost(username, wrap(conn)).then(
          (t) => {
            clearTimeout(timer);
            settled = true;
            resolve(withPeerCleanup(t, peer));
          },
          (e: Error) => {
            clearTimeout(timer);
            fail(e.message);
          },
        );
      });
    });
  });

  return {
    ready,
    cancel: () => {
      if (!settled) {
        settled = true;
        rejectReady(new Error('Cancelled.'));
      }
      peer.destroy();
    },
  };
}
