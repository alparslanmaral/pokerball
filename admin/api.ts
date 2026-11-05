import type { Balance, Player, TraitTemplate } from '../src/engine';

export interface AdminData {
  players: Player[];
  traits: TraitTemplate[];
  balance: Balance;
  images: string[];
}

async function json<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = Array.isArray(body.errors) ? '\n' + body.errors.map((e: { playerId: string; message: string }) => `• ${e.playerId}: ${e.message}`).join('\n') : '';
    throw new Error((body.error ?? res.statusText) + detail);
  }
  return body as T;
}

export const loadData = (): Promise<AdminData> => fetch('/__admin/api/data').then((r) => json<AdminData>(r));

export const saveData = (players: Player[], traits: TraitTemplate[]): Promise<{ ok: true; warnings: string[] }> =>
  fetch('/__admin/api/data', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ players, traits }),
  }).then((r) => json(r));

export const uploadImage = (id: string, blob: Blob): Promise<unknown> =>
  fetch(`/__admin/api/image/${encodeURIComponent(id)}`, { method: 'PUT', body: blob }).then((r) => json(r));

export const deleteImage = (id: string): Promise<unknown> =>
  fetch(`/__admin/api/image/${encodeURIComponent(id)}`, { method: 'DELETE' }).then((r) => json(r));
