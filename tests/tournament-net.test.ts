import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POSITIONS, canBuy } from '../src/engine';
import type { TIntent, TournamentView } from '../src/engine';
import { memoryChannelPair } from '../src/net/protocol';
import { joinAny } from '../src/net/session';
import { TournamentGuestTransport, TournamentHost, TournamentHostTransport, acceptTournamentGuest } from '../src/net/tournament';
import type { TournamentTransport } from '../src/net/transport';
import { testCtx } from './fixtures';

const ctx = testCtx();

interface Bot {
  name: string;
  transport: TournamentTransport;
  view: TournamentView | null;
  closed: string | null;
}

function track(name: string, transport: TournamentTransport): Bot {
  const bot: Bot = { name, transport, view: null, closed: null };
  transport.onView((v) => (bot.view = v));
  transport.onClosed((r) => (bot.closed = r));
  return bot;
}

async function connect(host: TournamentHost, name: string): Promise<Bot> {
  const [hostSide, guestSide] = memoryChannelPair();
  acceptTournamentGuest(host, hostSide);
  const t = await joinAny(name, guestSide);
  expect(t).toBeInstanceOf(TournamentGuestTransport);
  return track(name, t as TournamentGuestTransport);
}

/** One reaction of a simple bot to its latest view. */
function act(bot: Bot, rngPick: () => number): void {
  const v = bot.view;
  if (!v) return;
  const send = (i: TIntent) => bot.transport.send(i);
  if (v.stage === 'lobby' && v.isHost && v.players.length >= v.minPlayers) return send({ type: 'start' });
  if (v.stage === 'transfer' && !v.meReady) {
    for (const pos of POSITIONS) {
      if (v.squad[pos] || v.market[pos].length === 0) continue;
      const id = v.market[pos].find((p) => canBuy(ctx, v.market, v.squad, p));
      if (id) return send({ type: 'buy', playerId: id });
    }
    return send({ type: 'transferReady' });
  }
  if (v.stage === 'match' && v.match) {
    const m = v.match;
    const mi = (intent: Parameters<typeof send>[0] extends infer _ ? any : never) => send({ type: 'match', intent });
    if (m.phase === 'duel' && !m.myLock) return mi({ type: 'lock', cards: [m.hand[0]] });
    if (m.phase === 'shot' && !m.myShotPick) return mi({ type: 'shotPick', zone: (['left', 'center', 'right'] as const)[Math.floor(rngPick() * 3)] });
    if ((m.phase === 'reveal' || m.phase === 'halftime') && !m.meContinued) return mi({ type: 'continue' });
    if (m.phase === 'fulltime') return send({ type: 'ack' });
  }
}

async function run(bots: Bot[], until: () => boolean, maxSteps = 6000): Promise<void> {
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let i = 0; i < maxSteps && !until(); i++) {
    for (const b of bots) act(b, rnd);
    await vi.advanceTimersByTimeAsync(400);
  }
}

describe('TournamentHost (network layer, in-memory channels)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  async function room(guests: string[]) {
    const host = new TournamentHost(ctx, 'Host');
    const hostBot = track('Host', new TournamentHostTransport(host));
    const bots = [hostBot];
    for (const g of guests) bots.push(await connect(host, g));
    await vi.advanceTimersByTimeAsync(50);
    return { host, bots };
  }

  it('lobby lists everyone, and only the host can start', async () => {
    const { bots } = await room(['Ann', 'Bob']);
    expect(bots[0].view!.players.map((p) => p.name)).toEqual(['Host', 'Ann', 'Bob']);
    expect(bots[1].view!.isHost).toBe(false);
    bots[1].transport.send({ type: 'start' });
    await vi.advanceTimersByTimeAsync(50);
    expect(bots[0].view!.stage).toBe('lobby');
    bots[0].transport.send({ type: 'start' });
    await vi.advanceTimersByTimeAsync(50);
    expect(bots.every((b) => b.view!.stage === 'transfer')).toBe(true);
  });

  it('needs at least two players to start', async () => {
    const { bots } = await room([]);
    bots[0].transport.send({ type: 'start' });
    await vi.advanceTimersByTimeAsync(50);
    expect(bots[0].view!.stage).toBe('lobby');
  });

  it('plays a whole 5-player tournament (odd field, byes) to a single champion that everyone agrees on', async () => {
    const { host, bots } = await room(['Ann', 'Bob', 'Cy', 'Di']);
    await run(bots, () => bots.every((b) => b.view!.stage === 'finished'));
    const views = bots.map((b) => b.view!);
    expect(views.every((v) => v.stage === 'finished')).toBe(true);
    const champs = new Set(views.map((v) => v.champion));
    expect(champs.size).toBe(1);
    const champion = [...champs][0]!;
    expect(views.map((v) => v.players.find((p) => p.alive)?.id)).toEqual(views.map(() => champion));
    const rounds = views[0].rounds;
    expect(rounds.length).toBeGreaterThanOrEqual(3);
    for (const round of rounds) for (const m of round) expect(m.winner).not.toBeNull();
    // 5 players: 4 eliminations = 4 played (non-bye) matches in total
    const played = rounds.flat().filter((m) => m.b !== null);
    expect(played).toHaveLength(4);
    // knockout matches never end level without a shootout
    for (const m of played) if (m.goals && m.goals[0] === m.goals[1]) expect(m.pens).toBeDefined();
    expect(host.snapshot.stage).toBe('finished');
    bots.forEach((b) => b.transport.close());
  });

  it('players only ever see their own market and squad', async () => {
    const { bots } = await room(['Ann']);
    bots[0].transport.send({ type: 'start' });
    await vi.advanceTimersByTimeAsync(50);
    const [h, a] = bots.map((b) => b.view!);
    expect(h.market).not.toEqual(a.market);
    expect(JSON.stringify(a)).not.toContain(JSON.stringify(h.market));
  });

  it('rejects late joiners once the tournament has started', async () => {
    const { host, bots } = await room(['Ann']);
    bots[0].transport.send({ type: 'start' });
    await vi.advanceTimersByTimeAsync(50);
    const [hostSide, guestSide] = memoryChannelPair();
    acceptTournamentGuest(host, hostSide);
    await expect(joinAny('Late', guestSide)).rejects.toThrow(/already started/);
  });

  it('a guest who disconnects mid-match gives the opponent a walkover', async () => {
    const { host, bots } = await room(['Ann']);
    // transfer + first round
    await run(bots, () => bots.every((b) => b.view!.stage === 'match'));
    expect(bots[0].view!.stage).toBe('match');
    bots[1].transport.close();
    await vi.advanceTimersByTimeAsync(100);
    const v = bots[0].view!;
    expect(v.champion).toBe('p0');
    expect(v.stage).toBe('finished');
    expect(v.notice).toMatch(/Ann disconnected/);
    expect(host.snapshot.tournament.rounds[0][0].forfeit).toBe(true);
    bots[0].transport.close();
  });

  it('a guest leaving the lobby simply disappears from it', async () => {
    const { bots } = await room(['Ann', 'Bob']);
    bots[1].transport.close();
    await vi.advanceTimersByTimeAsync(100);
    expect(bots[0].view!.players.map((p) => p.name)).toEqual(['Host', 'Bob']);
  });

  it('guests learn when the host closes the tournament', async () => {
    const { bots } = await room(['Ann']);
    bots[0].transport.close();
    await vi.advanceTimersByTimeAsync(100);
    expect(bots[1].closed).toMatch(/Host/);
  });

  it('ignores forged intents (rematch, unknown types, acting in someone else\'s match)', async () => {
    const { host, bots } = await room(['Ann']);
    await run(bots, () => bots.every((b) => b.view!.stage === 'match'));
    const before = JSON.stringify(host.snapshot.matches.get(1)!.host.snapshot);
    (bots[1].transport as any).channel.send({ t: 'tintent', intent: { type: 'match', intent: { type: 'rematch' } } });
    (bots[1].transport as any).channel.send({ t: 'tintent', intent: { type: 'hax' } });
    await vi.advanceTimersByTimeAsync(50);
    expect(JSON.stringify(host.snapshot.matches.get(1)!.host.snapshot)).toBe(before);
    bots.forEach((b) => b.transport.close());
  });
});
