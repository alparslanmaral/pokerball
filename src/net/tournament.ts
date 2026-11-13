import { dbVersionHash } from '../data';
import {
  type ClientView,
  type GameContext,
  MAX_PLAYERS,
  MIN_PLAYERS,
  type Market,
  type Squad,
  type TIntent,
  type TStage,
  type Tournament,
  type TournamentView,
  Rng,
  budgetLeft,
  canBuy,
  createTournament,
  currentRound,
  dropPlayer,
  drawRound,
  generateMarket,
  isOver,
  isTIntent,
  randomSeed,
  reportResult,
  roundComplete,
  squadComplete,
} from '../engine';
import type { MatchState } from '../engine';
import { Heartbeat } from './heartbeat';
import { GameHost } from './host';
import { type Channel, PROTOCOL_VERSION } from './protocol';
import type { TournamentTransport } from './transport';

/** Pairings are shown for this long before the very first round starts. */
export const FIRST_ROUND_DELAY_MS = 8000;
/** After a round: finished full-time screens close by themselves after this long... */
export const ACK_DELAY_MS = 8000;
/** ...and the next round's matches start after this long. */
export const NEXT_ROUND_DELAY_MS = 16000;

type HostStage = 'lobby' | 'transfer' | 'running' | 'finished';

interface Participant {
  id: string;
  name: string;
  isHost: boolean;
  channel: Channel | null;
  beat: Heartbeat | null;
  connected: boolean;
  market: Market;
  squad: Squad;
  ready: boolean;
  matchId: number | null;
  /** Latest projection of this player's match (kept after full time until they acknowledge it). */
  matchView: ClientView | null;
  acked: boolean;
  notice: string | null;
  sink: ((v: TournamentView) => void) | null;
}

interface LiveMatch {
  host: GameHost;
  a: string;
  b: string;
  done: boolean;
  detach: (() => void)[];
}

/**
 * Authoritative tournament host. It lives on the room creator's machine, owns the bracket, runs one GameHost per
 * pairing (all matches of a round in parallel) and sends every participant its own projection. The room creator
 * is participant "p0" and plays through a local sink; guests are reached over a Channel.
 */
export class TournamentHost {
  private stage: HostStage = 'lobby';
  private parts = new Map<string, Participant>();
  private order: string[] = [];
  private t: Tournament = createTournament([]);
  private matches = new Map<number, LiveMatch>();
  private rng = new Rng(randomSeed());
  private startAt: number | null = null;
  private roundStarted = false;
  private roundTimer: ReturnType<typeof setTimeout> | null = null;
  private ackTimer: ReturnType<typeof setTimeout> | null = null;
  private nextGuest = 1;
  private closed = false;
  private closedCbs = new Set<(reason: string) => void>();

  constructor(
    private ctx: GameContext,
    readonly hostName: string,
  ) {
    this.addParticipant('p0', hostName, true, null);
  }

  // -- membership -----------------------------------------------------------

  get acceptingGuests(): boolean {
    return !this.closed && this.stage === 'lobby' && this.parts.size < MAX_PLAYERS;
  }

  get started(): boolean {
    return this.stage !== 'lobby';
  }

  get connectedCount(): number {
    return [...this.parts.values()].filter((p) => p.connected).length;
  }

  private addParticipant(id: string, name: string, isHost: boolean, channel: Channel | null): Participant {
    const p: Participant = {
      id,
      name: name.trim().slice(0, 20) || 'Player',
      isHost,
      channel,
      beat: null,
      connected: true,
      market: { GK: [], DEF: [], MID: [], FWD: [] },
      squad: {},
      ready: false,
      matchId: null,
      matchView: null,
      acked: false,
      notice: null,
      sink: null,
    };
    this.parts.set(id, p);
    this.order.push(id);
    return p;
  }

  /** A guest whose handshake succeeded joins the lobby. */
  addGuest(channel: Channel, name: string): string {
    const id = `p${this.nextGuest++}`;
    const p = this.addParticipant(id, name, false, channel);
    const beat = new Heartbeat(channel, () => this.drop(id));
    p.beat = beat;
    channel.onMessage((m) => {
      beat.seen();
      if (m.t === 'tintent' && isTIntent(m.intent)) this.submit(id, m.intent);
      else if (m.t === 'bye') this.drop(id);
    });
    channel.onClose(() => this.drop(id));
    beat.start();
    this.emitAll();
    return id;
  }

  /** The room creator's own view (participant p0). */
  attachLocal(sink: (v: TournamentView) => void): () => void {
    const p = this.parts.get('p0')!;
    p.sink = sink;
    sink(this.view(p));
    return () => {
      if (p.sink === sink) p.sink = null;
    };
  }

  onClosed(cb: (reason: string) => void): () => void {
    this.closedCbs.add(cb);
    return () => this.closedCbs.delete(cb);
  }

  // -- intents ----------------------------------------------------------------

  submit(pid: string, i: TIntent): void {
    const p = this.parts.get(pid);
    if (!p || this.closed || !p.connected) return;
    switch (i.type) {
      case 'start':
        if (p.isHost && this.stage === 'lobby' && this.connectedCount >= MIN_PLAYERS) this.startTransfer();
        return;
      case 'buy': {
        if (this.stage !== 'transfer' || p.ready || !canBuy(this.ctx, p.market, p.squad, i.playerId)) return;
        p.squad = { ...p.squad, [this.ctx.players[i.playerId].position]: i.playerId };
        this.emit(p);
        return;
      }
      case 'unbuy': {
        if (this.stage !== 'transfer' || p.ready || !p.squad[i.position]) return;
        const next = { ...p.squad };
        delete next[i.position];
        p.squad = next;
        this.emit(p);
        return;
      }
      case 'transferReady':
        if (this.stage !== 'transfer' || p.ready) return;
        if (!squadComplete(p.market, p.squad) || budgetLeft(this.ctx, p.squad) < 0) return;
        p.ready = true;
        this.emitAll();
        this.checkTransferDone();
        return;
      case 'match': {
        const m = p.matchId === null ? undefined : this.matches.get(p.matchId);
        if (!m || m.done) return;
        m.host.submit(m.a === pid ? 'A' : 'B', i.intent);
        return;
      }
      case 'ack': {
        const m = p.matchId === null ? undefined : this.matches.get(p.matchId);
        if (!m?.done || p.acked) return;
        p.acked = true;
        this.emit(p);
        return;
      }
    }
  }

  // -- stages -----------------------------------------------------------------

  private startTransfer(): void {
    this.stage = 'transfer';
    const ids = this.order.filter((id) => this.parts.get(id)!.connected);
    for (const id of ids) {
      const p = this.parts.get(id)!;
      p.market = generateMarket(this.ctx, this.rng);
      p.squad = {};
      p.ready = false;
    }
    this.t = createTournament(ids.map((id) => ({ id, name: this.parts.get(id)!.name })));
    this.emitAll();
  }

  private checkTransferDone(): void {
    if (this.stage !== 'transfer') return;
    const live = [...this.parts.values()].filter((p) => p.connected);
    if (live.length < MIN_PLAYERS) {
      this.cancel('The tournament was cancelled: not enough players are left.');
      return;
    }
    if (!live.every((p) => p.ready)) return;
    this.stage = 'running';
    this.t = drawRound(this.t, this.rng);
    this.scheduleRound(FIRST_ROUND_DELAY_MS, false);
  }

  private cancel(message: string): void {
    this.stage = 'finished';
    for (const p of this.parts.values()) p.notice = message;
    this.emitAll();
  }

  private scheduleRound(delayMs: number, forceAck: boolean): void {
    this.clearTimers();
    this.roundStarted = false;
    this.startAt = Date.now() + delayMs;
    this.roundTimer = setTimeout(() => this.startRound(), delayMs);
    if (forceAck) this.ackTimer = setTimeout(() => this.ackAll(), ACK_DELAY_MS);
    this.emitAll();
  }

  private ackAll(): void {
    for (const p of this.parts.values()) if (p.matchView && !p.acked) p.acked = true;
    this.emitAll();
  }

  private startRound(): void {
    if (this.closed || this.stage !== 'running') return;
    this.startAt = null;
    this.roundStarted = true;
    for (const p of this.parts.values()) {
      p.matchId = null;
      p.matchView = null;
      p.acked = false;
      p.notice = null;
    }
    for (const m of currentRound(this.t)) {
      if (m.b === null || m.winner !== null) continue;
      const pa = this.parts.get(m.a);
      const pb = this.parts.get(m.b);
      if (!pa || !pb) continue;
      const host = new GameHost({
        ctx: this.ctx,
        names: { A: pa.name, B: pb.name },
        squads: { A: pa.squad, B: pb.squad },
        knockout: true,
        onChange: (st) => this.onMatchChange(m.id, st),
      });
      const live: LiveMatch = { host, a: pa.id, b: pb.id, done: false, detach: [] };
      this.matches.set(m.id, live);
      pa.matchId = pb.matchId = m.id;
      live.detach.push(
        host.attach('A', (v) => this.onMatchView(pa, v)),
        host.attach('B', (v) => this.onMatchView(pb, v)),
      );
    }
    this.emitAll();
    this.checkRoundDone();
  }

  private onMatchView(p: Participant, v: ClientView): void {
    p.matchView = v;
    this.emit(p);
  }

  private onMatchChange(matchId: number, st: MatchState): void {
    const live = this.matches.get(matchId);
    if (!live || live.done || st.phase !== 'fulltime' || !st.winner) return;
    live.done = true;
    live.detach.forEach((d) => d());
    live.host.close();
    const so = st.shootout;
    const pens: [number, number] | undefined = so
      ? [so.kicks.filter((k) => k.shooter === 'A' && k.goal).length, so.kicks.filter((k) => k.shooter === 'B' && k.goal).length]
      : undefined;
    this.t = reportResult(this.t, matchId, st.winner === 'A' ? live.a : live.b, {
      goals: [st.sides.A.goals, st.sides.B.goals],
      pens,
    });
    this.checkRoundDone();
  }

  /** When every match of the running round is decided: draw the next round, or crown the champion. */
  private checkRoundDone(): void {
    if (!this.roundStarted || this.stage !== 'running' || !roundComplete(this.t)) return;
    this.roundStarted = false;
    this.t = drawRound(this.t, this.rng);
    if (isOver(this.t)) {
      this.stage = 'finished';
      this.clearTimers();
      this.ackTimer = setTimeout(() => this.ackAll(), ACK_DELAY_MS);
      this.emitAll();
      return;
    }
    this.scheduleRound(NEXT_ROUND_DELAY_MS, true);
  }

  // -- disconnects ------------------------------------------------------------

  private drop(pid: string): void {
    const p = this.parts.get(pid);
    if (!p || !p.connected || p.isHost || this.closed) return;
    p.connected = false;
    p.beat?.stop();
    try {
      p.channel?.close();
    } catch {
      /* already gone */
    }

    if (this.stage === 'lobby') {
      this.parts.delete(pid);
      this.order = this.order.filter((id) => id !== pid);
      this.emitAll();
      return;
    }
    const { tournament, forfeited } = dropPlayer(this.t, pid);
    this.t = tournament;
    if (this.stage === 'transfer') {
      this.emitAll();
      this.checkTransferDone();
      return;
    }
    if (forfeited) {
      const live = this.matches.get(forfeited.id);
      if (live && !live.done) {
        live.done = true;
        live.detach.forEach((d) => d());
        live.host.close();
      }
      const oppId = forfeited.a === pid ? forfeited.b : forfeited.a;
      const opp = oppId ? this.parts.get(oppId) : undefined;
      if (opp) {
        opp.matchView = null;
        opp.acked = true;
        opp.notice = `${p.name} disconnected, so you advance.`;
      }
    }
    this.emitAll();
    this.checkRoundDone();
  }

  // -- projections ------------------------------------------------------------

  private stageOf(p: Participant): TStage {
    if (this.stage === 'lobby') return 'lobby';
    if (this.stage === 'transfer') return 'transfer';
    if (p.matchView && !p.acked) return 'match';
    return this.stage === 'finished' ? 'finished' : 'bracket';
  }

  view(p: Participant): TournamentView {
    const stage = this.stageOf(p);
    const round = currentRound(this.t);
    const me = this.t.players.find((x) => x.id === p.id);
    return {
      me: p.id,
      isHost: p.isHost,
      stage,
      players: this.order.map((id) => {
        const q = this.parts.get(id)!;
        const tp = this.t.players.find((x) => x.id === id);
        return { id, name: q.name, alive: this.stage === 'lobby' ? true : !!tp?.alive, connected: q.connected, ready: q.ready };
      }),
      maxPlayers: MAX_PLAYERS,
      minPlayers: MIN_PLAYERS,
      market: p.market,
      squad: p.squad,
      budgetLeft: budgetLeft(this.ctx, p.squad),
      meReady: p.ready,
      rounds: this.t.rounds,
      champion: this.t.champion,
      startsInMs: this.startAt === null ? null : Math.max(0, this.startAt - Date.now()),
      meAlive: me?.alive ?? true,
      myMatch: round.find((m) => m.a === p.id || m.b === p.id) ?? null,
      match: stage === 'match' ? p.matchView : null,
      notice: p.notice,
    };
  }

  private emit(p: Participant): void {
    if (this.closed || !p.connected) return;
    const v = this.view(p);
    if (p.channel) {
      try {
        p.channel.send({ t: 'tview', view: v });
      } catch {
        /* the heartbeat will notice a dead channel */
      }
    } else p.sink?.(v);
  }

  private emitAll(): void {
    for (const p of this.parts.values()) this.emit(p);
  }

  // -- shutdown ---------------------------------------------------------------

  private clearTimers(): void {
    if (this.roundTimer) clearTimeout(this.roundTimer);
    if (this.ackTimer) clearTimeout(this.ackTimer);
    this.roundTimer = this.ackTimer = null;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.clearTimers();
    for (const live of this.matches.values()) {
      live.detach.forEach((d) => d());
      live.host.close();
    }
    for (const p of this.parts.values()) {
      p.beat?.stop();
      if (p.channel) {
        try {
          p.channel.send({ t: 'bye' });
        } catch {
          /* gone */
        }
        p.channel.close();
      }
    }
    this.closedCbs.forEach((cb) => cb('closed'));
  }

  /** Test/debug access. */
  get snapshot(): { stage: HostStage; tournament: Tournament; matches: Map<number, LiveMatch> } {
    return { stage: this.stage, tournament: this.t, matches: this.matches };
  }
}

/** Room creator's transport: talks to its own TournamentHost directly. */
export class TournamentHostTransport implements TournamentTransport {
  readonly kind = 'tournament' as const;
  private views = new Set<(v: TournamentView) => void>();
  private last: TournamentView | null = null;
  private detach: () => void;
  /** Filled in by the PeerJS glue. */
  roomCode = '';

  constructor(readonly host: TournamentHost) {
    this.detach = host.attachLocal((v) => {
      this.last = v;
      this.views.forEach((cb) => cb(v));
    });
  }

  send(intent: TIntent): void {
    this.host.submit('p0', intent);
  }

  onView(cb: (v: TournamentView) => void): () => void {
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

/** Guest transport: sends intents to the host and renders the views it projects for this player. */
export class TournamentGuestTransport implements TournamentTransport {
  readonly kind = 'tournament' as const;
  private views = new Set<(v: TournamentView) => void>();
  private closedCbs = new Set<(reason: string) => void>();
  private last: TournamentView | null = null;
  private done = false;
  private beat: Heartbeat;

  constructor(
    private channel: Channel,
    hostName: string,
  ) {
    this.beat = new Heartbeat(channel, () => this.fail(`${hostName} disconnected (connection lost).`));
    channel.onMessage((m) => {
      this.beat.seen();
      if (m.t === 'tview') {
        this.last = m.view;
        this.views.forEach((cb) => cb(m.view));
      } else if (m.t === 'bye') this.fail(`${hostName} closed the tournament.`);
    });
    channel.onClose(() => this.fail(`${hostName} disconnected.`));
    this.beat.start();
  }

  send(intent: TIntent): void {
    if (!this.done) this.channel.send({ t: 'tintent', intent });
  }

  onView(cb: (v: TournamentView) => void): () => void {
    this.views.add(cb);
    if (this.last) cb(this.last);
    return () => this.views.delete(cb);
  }

  onClosed(cb: (reason: string) => void): () => void {
    this.closedCbs.add(cb);
    return () => this.closedCbs.delete(cb);
  }

  private fail(reason: string): void {
    if (this.done) return;
    this.done = true;
    this.beat.stop();
    this.closedCbs.forEach((cb) => cb(reason));
  }

  close(): void {
    if (this.done) return;
    this.done = true;
    this.beat.stop();
    try {
      this.channel.send({ t: 'bye' });
    } catch {
      /* channel already gone */
    }
    this.channel.close();
  }
}

/** Host side of the handshake for a guest that wants to join a tournament room. */
export function acceptTournamentGuest(host: TournamentHost, channel: Channel, hash = dbVersionHash): void {
  let handled = false;
  channel.onMessage((m) => {
    if (handled || m.t !== 'hello') return;
    handled = true;
    if (m.v !== PROTOCOL_VERSION) {
      channel.send({ t: 'reject', reason: 'protocol', message: 'Incompatible game version. Please refresh the page.' });
      channel.close();
    } else if (m.hash !== hash) {
      channel.send({
        t: 'reject',
        reason: 'version',
        message: 'Game data is out of date. Please refresh the page (Ctrl/Cmd+Shift+R) and join again.',
      });
      channel.close();
    } else if (!host.acceptingGuests) {
      channel.send(
        host.started
          ? { t: 'reject', reason: 'started', message: 'This tournament has already started.' }
          : { t: 'reject', reason: 'full', message: 'This tournament is full.' },
      );
      setTimeout(() => channel.close(), 300);
    } else {
      channel.send({ t: 'welcome', username: host.hostName, mode: 'tournament' });
      host.addGuest(channel, m.username || 'Guest');
    }
  });
}
