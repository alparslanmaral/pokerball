import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import type { Balance, Player, TraitTemplate } from '../src/engine/types.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PLAYERS = resolve(root, 'src/data/players.json');
const TRAITS = resolve(root, 'src/data/traits.json');
const BALANCE = resolve(root, 'src/data/balance.json');
const IMAGES = resolve(root, 'public/players');

const LOCAL_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const SAFE_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/i;

function isLocalRequest(req: IncomingMessage): boolean {
  if (!LOCAL_ADDRESSES.has(req.socket.remoteAddress ?? '')) return false;
  // Defend against DNS-rebinding: the Host (and Origin, if any) must be a loopback name too.
  const hostOk = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(req.headers.host ?? '');
  const origin = req.headers.origin;
  const originOk = !origin || /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin);
  return hostOk && originOk;
}

function readBody(req: IncomingMessage, limit = 12 * 1024 * 1024): Promise<Buffer> {
  return new Promise((ok, fail) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        fail(new Error('Request body too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => ok(Buffer.concat(chunks)));
    req.on('error', fail);
  });
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;

/**
 * Dev-only editor backend. `apply: 'serve'` means the plugin does not exist in `vite build`, and the
 * admin UI lives in /admin which is not part of the production bundle either.
 * Only requests from localhost are accepted.
 */
export function adminPlugin(): Plugin {
  return {
    name: 'poker-pitch-admin',
    apply: 'serve',
    configureServer(server) {
      // `/admin` -> `/admin/` so the dev server serves admin/index.html with correct relative URLs.
      server.middlewares.use((req, res, next) => {
        if (req.url === '/admin') {
          res.statusCode = 302;
          res.setHeader('Location', '/admin/');
          res.end();
          return;
        }
        next();
      });

      server.middlewares.use('/__admin/api', async (req, res) => {
        try {
          if (!isLocalRequest(req)) return send(res, 403, { error: 'The admin API only accepts localhost requests.' });
          const url = new URL(req.url ?? '/', 'http://localhost');
          const path = url.pathname;
          const method = req.method ?? 'GET';

          if (method === 'GET' && path === '/data') {
            return send(res, 200, {
              players: readJson<Player[]>(PLAYERS),
              traits: readJson<TraitTemplate[]>(TRAITS),
              balance: readJson<Balance>(BALANCE),
              images: readdirSync(IMAGES).filter((f) => f.endsWith('.webp')),
            });
          }

          if (method === 'PUT' && path === '/data') {
            const body = JSON.parse((await readBody(req)).toString('utf8')) as { players: Player[]; traits: TraitTemplate[] };
            if (!Array.isArray(body.players) || !Array.isArray(body.traits)) return send(res, 400, { error: 'Bad payload' });
            const balance = readJson<Balance>(BALANCE);
            const ctx = {
              balance,
              catalog: body.traits,
              players: Object.fromEntries(body.players.map((p) => [p.id, p])),
            };
            for (const p of body.players) if (!SAFE_ID.test(p.id ?? '')) return send(res, 400, { error: `Unsafe player id "${p.id}"` });
            // Engine modules are loaded through Vite's own pipeline (keeps this config file dependency-free).
            const { validateDb } = (await server.ssrLoadModule('/src/engine/validate.ts')) as typeof import('../src/engine/validate.ts');
            const { serializePlayers, serializeTraits } = (await server.ssrLoadModule('/src/engine/serialize.ts')) as typeof import('../src/engine/serialize.ts');
            const report = validateDb(ctx, body.players);
            if (report.errors.length) return send(res, 400, { error: 'Validation failed', errors: report.errors });
            writeFileSync(TRAITS, serializeTraits(body.traits));
            writeFileSync(PLAYERS, serializePlayers(body.players, body.traits));
            return send(res, 200, { ok: true, warnings: report.warnings });
          }

          const img = /^\/image\/([^/]+)$/.exec(path);
          if (img) {
            const id = decodeURIComponent(img[1]);
            if (!SAFE_ID.test(id)) return send(res, 400, { error: 'Unsafe image id' });
            const file = resolve(IMAGES, `${id}.webp`);
            if (method === 'PUT') {
              const buf = await readBody(req);
              if (buf.length < 12 || buf.subarray(0, 4).toString('ascii') !== 'RIFF' || buf.subarray(8, 12).toString('ascii') !== 'WEBP')
                return send(res, 400, { error: 'Expected a WebP image' });
              mkdirSync(IMAGES, { recursive: true });
              writeFileSync(file, buf);
              return send(res, 200, { ok: true, path: `players/${id}.webp` });
            }
            if (method === 'DELETE') {
              rmSync(file, { force: true });
              return send(res, 200, { ok: true });
            }
          }
          send(res, 404, { error: 'Not found' });
        } catch (e) {
          send(res, 500, { error: (e as Error).message });
        }
      });
    },
  };
}
