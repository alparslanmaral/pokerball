import type { Channel } from './protocol';

const PING_MS = 3000;
const DEAD_MS = 12000;

/** Sends pings and reports silence; shared by both ends. */
export class Heartbeat {
  private last = Date.now();
  private timers: ReturnType<typeof setInterval>[] = [];

  constructor(
    private channel: Channel,
    private onDead: () => void,
  ) {}

  start(): void {
    this.last = Date.now();
    this.timers.push(
      setInterval(() => this.channel.send({ t: 'ping' }), PING_MS),
      setInterval(() => {
        if (Date.now() - this.last > DEAD_MS) this.onDead();
      }, PING_MS),
    );
  }

  seen(): void {
    this.last = Date.now();
  }

  stop(): void {
    this.timers.forEach(clearInterval);
    this.timers = [];
  }
}
