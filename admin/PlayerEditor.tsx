import { useRef, useState } from 'react';
import { POSITIONS, defaultTraitFor, suggestPrice, validatePlayer } from '../src/engine';
import type { Balance, GameContext, Player, Position } from '../src/engine';
import { PlayerCard } from '../src/ui/components/PlayerCard';
import { ImageCropper } from './ImageCropper';
import { TraitPicker } from './TraitPicker';
import { usePower } from './usePower';

interface Props {
  player: Player;
  ctx: GameContext;
  balance: Balance;
  isNew: boolean;
  /** Blob URL of an image chosen in this session but not saved yet. */
  pendingUrl?: string;
  onChange: (p: Player) => void;
  onImage: (blob: Blob | null) => void;
}

export function PlayerEditor({ player, ctx, balance, isNew, pendingUrl, onChange, onImage }: Props) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [cropFile, setCropFile] = useState<File | null>(null);
  const { result, loading } = usePower(balance, ctx.catalog, player.trait, player.position);
  const suggested = result ? suggestPrice(balance, result.power) : null;
  const errors = validatePlayer(ctx, player);
  const tpl = ctx.catalog.find((t) => t.id === player.trait.type);

  const set = (patch: Partial<Player>) => onChange({ ...player, ...patch });
  const changePosition = (position: Position) => {
    const allowed = ctx.catalog.find((t) => t.id === player.trait.type)?.allowedPositions.includes(position);
    if (allowed) return set({ position });
    const next = ctx.catalog.find((t) => t.enabled && t.allowedPositions.includes(position));
    set({ position, trait: next ? defaultTraitFor(next) : player.trait });
  };

  // The card preview shows an unsaved image if there is one.
  const previewPlayer: Player = pendingUrl ? { ...player, image: pendingUrl } : player;

  return (
    <div className="editor">
      <div className="editor-form">
        <h3>{isNew ? 'New player' : `Edit ${player.firstName} ${player.lastName}`}</h3>
        <div className="grid2">
          <label className="field">
            <span>First name</span>
            <input value={player.firstName} onChange={(e) => set({ firstName: e.target.value })} />
          </label>
          <label className="field">
            <span>Last name</span>
            <input value={player.lastName} onChange={(e) => set({ lastName: e.target.value })} />
          </label>
          <label className="field">
            <span>Position</span>
            <select value={player.position} onChange={(e) => changePosition(e.target.value as Position)}>
              {POSITIONS.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Id {isNew ? '' : '(fixed after creation)'}</span>
            <input
              value={player.id}
              disabled={!isNew}
              onChange={(e) => set({ id: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '') })}
            />
          </label>
        </div>

        <div className="field">
          <span>Price</span>
          <div className="price-row">
            <input type="number" min={1} step={1} value={player.price} onChange={(e) => set({ price: Math.round(Number(e.target.value)) })} />
            <div className="suggest">
              {loading && <span className="muted">measuring…</span>}
              {suggested !== null && (
                <>
                  <span>
                    Suggested <strong>${suggested}</strong>
                  </span>
                  <button className="btn tiny" disabled={suggested === player.price} onClick={() => set({ price: suggested })}>
                    Use
                  </button>
                  <span className="muted">
                    win chance {(result!.stats.winProb * 100).toFixed(0)}% · score +{(result!.stats.uplift * 100).toFixed(0)}% · power{' '}
                    {result!.power.toFixed(3)}
                  </span>
                </>
              )}
            </div>
          </div>
          {suggested !== null && Math.abs(suggested - player.price) >= 10 && (
            <div className="warn">
              Price differs from the suggestion by ${Math.abs(suggested - player.price)} ({player.price > suggested ? 'overpriced' : 'underpriced'}).
            </div>
          )}
        </div>

        <TraitPicker trait={player.trait} position={player.position} catalog={ctx.catalog} balance={balance} onChange={(trait) => set({ trait })} />
        {tpl && !tpl.enabled && <div className="warn">This trait template is disabled in the catalog.</div>}

        <div className="field">
          <span>Image</span>
          <div className="row-buttons left">
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) setCropFile(f);
                e.target.value = '';
              }}
            />
            <button className="btn" onClick={() => fileInput.current?.click()}>
              {player.image || pendingUrl ? 'Replace image…' : 'Upload image…'}
            </button>
            {(player.image || pendingUrl) && (
              <button className="btn ghost" onClick={() => onImage(null)}>
                Remove
              </button>
            )}
            <span className="muted">Saved as public/players/{player.id || '<id>'}.webp (512×512)</span>
          </div>
        </div>

        {errors.length > 0 && (
          <ul className="errors">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        )}
      </div>

      <div className="editor-preview">
        <div className="muted">Live card preview (exactly as in game)</div>
        <PlayerCard player={previewPlayer} ctx={ctx} />
        <div className="muted small-note">The generic portrait is used when no image is set.</div>
      </div>

      {cropFile && (
        <ImageCropper
          file={cropFile}
          onCancel={() => setCropFile(null)}
          onDone={(blob) => {
            onImage(blob);
            setCropFile(null);
          }}
        />
      )}
    </div>
  );
}
