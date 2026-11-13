import { dbVersionHash } from '../data';
import type { ClientView, GameContext, Intent } from '../engine';
import { GameHost } from './host';
import { Heartbeat } from './heartbeat';
import { type Channel, PROTOCOL_VERSION, isIntent } from './protocol';
import { TournamentGuestTransport } from './tournament';
import type { GameTransport } from './transport';

abstract class BaseTransport implements GameTransport {
  protected viewCbs = new Set<(v: ClientView) => void>();
  protected closedCbs = new Set<(reason: string) => void>();
  protected last: ClientView | null = null;
  protected done = false;
  protected beat: Heartbeat;

  constructor(protected channel: Channel) {
    this.beat = new Heartbeat(channel, () => this.fail('Your opponent disconnected (connection lost).'));
  }

  abstract send(intent: Intent): void;

  onView(cb: (view: ClientView) => void): () => void {
    this.viewCbs.add(cb);
    if (this.last) cb(this.last);
    return () => this.viewCbs.delete(cb);
  }

  onClosed(cb: (reason: string) => void): () => void {
    this.closedCbs.add(cb);
    return () => this.closedCbs.delete(cb);
  }

  protected emitView(v: ClientView): void {
    this.last = v;
    this.viewCbs.forEach((cb) => cb(v));
  }

  protected fail(reason: string): void {
    if (this.done) return;
    this.done = true;
    this.beat.stop();
    this.cleanup();
    this.closedCbs.forEach((cb) => cb(reason));
  }

  protected cleanup(): void {}

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
    this.cleanup();
  }
}

/** Host side: runs the authoritative engine; the guest is player B. */
export class PeerHostTransport extends BaseTransport {
  /** The authoritative engine (exposed for tests and debugging). */
  readonly host: GameHost;
  private detachA: () => void;
  private detachB: () => void;

  constructor(ctx: GameContext, channel: Channel, names: { host: string; guest: string }) {
    super(channel);
    this.host = new GameHost({ ctx, names: { A: names.host, B: names.guest } });
    this.detachA = this.host.attach('A', (v) => this.emitView(v));
    this.detachB = this.host.attach('B', (v) => channel.send({ t: 'view', view: v }));
    channel.onMessage((m) => {
      this.beat.seen();
      if (m.t === 'intent' && isIntent(m.intent)) this.host.submit('B', m.intent);
      else if (m.t === 'bye') this.fail(`${names.guest} left the match.`);
    });
    channel.onClose(() => this.fail(`${names.guest} disconnected.`));
    this.beat.start();
  }

  send(intent: Intent): void {
    this.host.submit('A', intent);
  }

  protected cleanup(): void {
    this.detachA();
    this.detachB();
    this.host.close();
  }
}

/** Guest side: sends intents, renders the snapshots the host projects for player B. */
export class PeerGuestTransport extends BaseTransport {
  constructor(channel: Channel, hostName: string) {
    super(channel);
    channel.onMessage((m) => {
      this.beat.seen();
      if (m.t === 'view') this.emitView(m.view);
      else if (m.t === 'bye') this.fail(`${hostName} left the match.`);
    });
    channel.onClose(() => this.fail(`${hostName} disconnected.`));
    this.beat.start();
  }

  send(intent: Intent): void {
    if (!this.done) this.channel.send({ t: 'intent', intent });
  }
}

/**
 * Host: waits for the guest's hello on a fresh channel. Resolves with the transport once the data
 * versions match; rejects the guest (and the promise) otherwise.
 */
export function acceptGuest(ctx: GameContext, hostName: string, channel: Channel, hash = dbVersionHash): Promise<PeerHostTransport> {
  return new Promise((resolve, reject) => {
    channel.onClose(() => reject(new Error('The guest disconnected before the match started.')));
    channel.onMessage((m) => {
      if (m.t !== 'hello') return;
      if (m.v !== PROTOCOL_VERSION) {
        channel.send({ t: 'reject', reason: 'protocol', message: 'Incompatible game version. Please refresh the page.' });
        channel.close();
        reject(new Error('The guest runs an incompatible game version.'));
      } else if (m.hash !== hash) {
        channel.send({
          t: 'reject',
          reason: 'version',
          message: 'Game data is out of date. Please refresh the page (Ctrl/Cmd+Shift+R) and join again.',
        });
        channel.close();
        reject(new Error(`${m.username || 'The guest'} has different game data (their page is out of date or yours is). Ask them to refresh.`));
      } else {
        channel.send({ t: 'welcome', username: hostName });
        resolve(new PeerHostTransport(ctx, channel, { host: hostName, guest: m.username || 'Guest' }));
      }
    });
  });
}

/** Guest: sends hello and waits for welcome/reject. The host's welcome says whether this is a match or a tournament room. */
export function joinAny(username: string, channel: Channel, hash = dbVersionHash): Promise<PeerGuestTransport | TournamentGuestTransport> {
  return new Promise((resolve, reject) => {
    channel.onClose(() => reject(new Error('The host closed the room.')));
    channel.onMessage((m) => {
      if (m.t === 'welcome') {
        resolve(m.mode === 'tournament' ? new TournamentGuestTransport(channel, m.username) : new PeerGuestTransport(channel, m.username));
      } else if (m.t === 'reject') {
        channel.close();
        reject(new Error(m.message));
      }
    });
    channel.send({ t: 'hello', v: PROTOCOL_VERSION, username, hash });
  });
}

/** Join a 1v1 match room (rejects if the room turns out to be a tournament). */
export async function joinHost(username: string, channel: Channel, hash = dbVersionHash): Promise<PeerGuestTransport> {
  const t = await joinAny(username, channel, hash);
  if (!(t instanceof PeerGuestTransport)) {
    t.close();
    throw new Error('This room is a tournament, not a 1v1 match.');
  }
  return t;
}
