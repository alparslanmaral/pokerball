import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type ClientView, POSITIONS } from '../src/engine';
import { memoryChannelPair } from '../src/net/protocol';
import { acceptGuest, joinHost } from '../src/net/session';
import { newRoomCode } from '../src/net/peer';
import { testCtx } from './fixtures';

const ctx = testCtx();
const tick = () => new Promise((r) => setTimeout(r, 0));

async function connect(hostHash = 'h1', guestHash = 'h1') {
  const [hostSide, guestSide] = memoryChannelPair();
  const host = acceptGuest(ctx, 'Hosty', hostSide, hostHash);
  const guest = joinHost('Guesty', guestSide, guestHash);
  return { host, guest, hostSide, guestSide };
}

describe('online handshake', () => {
  it('connects two clients with matching data and exchanges names', async () => {
    const { host, guest } = await connect();
    const [h, g] = await Promise.all([host, guest]);
    let hv!: ClientView;
    let gv!: ClientView;
    h.onView((v) => (hv = v));
    g.onView((v) => (gv = v));
    await tick();
    expect(hv.me).toBe('A');
    expect(gv.me).toBe('B');
    expect(gv.names).toEqual({ A: 'Hosty', B: 'Guesty' });
    h.close();
    g.close();
  });

  it('rejects a guest whose game data hash differs, with a clear message on both sides', async () => {
    const { host, guest } = await connect('hash-a', 'hash-b');
    const results = await Promise.allSettled([host, guest]);
    expect(results[0].status).toBe('rejected');
    expect(results[1].status).toBe('rejected');
    expect((results[1] as PromiseRejectedResult).reason.message).toMatch(/out of date.*refresh/i);
    expect((results[0] as PromiseRejectedResult).reason.message).toMatch(/refresh/i);
  });

  it('room codes are 5 characters from an unambiguous alphabet', () => {
    for (let i = 0; i < 50; i++) expect(newRoomCode()).toMatch(/^[A-HJ-KM-NP-Z2-9]{5}$/);
  });
});

describe('host-authoritative play', () => {
  it('guest intents drive the host engine and the guest only ever sees its own projection', async () => {
    const { host, guest } = await connect();
    const [h, g] = await Promise.all([host, guest]);
    let hv!: ClientView;
    let gv!: ClientView;
    h.onView((v) => (hv = v));
    g.onView((v) => (gv = v));
    await tick();

    // Both buy the cheapest offer of each position and ready up.
    for (const pos of POSITIONS) {
      h.send({ type: 'buy', playerId: hv.market[pos][0] });
      g.send({ type: 'buy', playerId: gv.market[pos][0] });
    }
    await tick();
    expect(Object.keys(gv.squad)).toHaveLength(4);
    h.send({ type: 'transferReady' });
    g.send({ type: 'transferReady' });
    await tick();
    expect(gv.phase).toBe('duel');
    expect(gv.hand).toHaveLength(8);
    expect(hv.hand).toHaveLength(8);
    expect(gv.hand).not.toEqual(hv.hand);

    // The guest's snapshot never contains the host's hand
    // (each player has their own deck, so the same card may legitimately be in both hands)
    // Apart from their own hand, no card id appears anywhere in a snapshot.
    expect(JSON.stringify({ ...gv, hand: [] })).not.toMatch(/"[2-9TJQKA][SHDC]"/);
    expect(JSON.stringify({ ...hv, hand: [] })).not.toMatch(/"[2-9TJQKA][SHDC]"/);

    // Guest locks in; host sees only the flag.
    g.send({ type: 'lock', cards: [gv.hand[0]] });
    await tick();
    expect(hv.oppLocked).toBe(true);
    expect(gv.myLock?.cards).toEqual([gv.hand[0]]);
    expect(hv.timerMs).not.toBeNull();

    h.close();
    g.close();
  });

  it('ignores forged intents (timeout, other side, unknown types)', async () => {
    const [hostSide, guestSide] = memoryChannelPair();
    const hostP = acceptGuest(ctx, 'Hosty', hostSide, 'x');
    const guestP = joinHost('Guesty', guestSide, 'x');
    const [h, g] = await Promise.all([hostP, guestP]);
    await tick();
    const before = h.host.snapshot.seq;
    guestSide.send({ t: 'intent', intent: { type: 'timeout' } as never });
    await tick();
    expect(h.host.snapshot.seq).toBe(before); // unknown intent types are dropped
    // A forged `side` is overwritten by the host: the purchase is attributed to the guest (and rejected there).
    guestSide.send({ t: 'intent', intent: { type: 'buy', side: 'A', playerId: h.host.snapshot.sides.A.market.GK[0] } as never });
    await tick();
    expect(h.host.snapshot.sides.A.squad).toEqual({});
    expect(h.host.snapshot.phase).toBe('transfer');
    h.close();
    g.close();
  });
});

describe('disconnects', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('tells the host when the guest leaves, and vice versa', async () => {
    const { host, guest } = await connect();
    const [h, g] = await Promise.all([host, guest]);
    const hostClosed = vi.fn();
    const guestClosed = vi.fn();
    h.onClosed(hostClosed);
    g.onClosed(guestClosed);
    g.close();
    await vi.advanceTimersByTimeAsync(10);
    expect(hostClosed).toHaveBeenCalledTimes(1);
    expect(hostClosed.mock.calls[0][0]).toMatch(/Guesty/);
    h.close();
  });

  it('detects a silent connection loss through the heartbeat', async () => {
    const { host, guest, guestSide } = await connect();
    const [h, g] = await Promise.all([host, guest]);
    const hostClosed = vi.fn();
    h.onClosed(hostClosed);
    guestSide.dropped = true; // the network dies without a close event
    await vi.advanceTimersByTimeAsync(20000);
    expect(hostClosed).toHaveBeenCalledTimes(1);
    expect(hostClosed.mock.calls[0][0]).toMatch(/disconnected/i);
    g.close();
  });

  it('a healthy idle connection survives well past the dead-timeout', async () => {
    const { host, guest } = await connect();
    const [h, g] = await Promise.all([host, guest]);
    const closed = vi.fn();
    h.onClosed(closed);
    g.onClosed(closed);
    await vi.advanceTimersByTimeAsync(60000);
    expect(closed).not.toHaveBeenCalled();
    h.close();
    g.close();
  });
});
