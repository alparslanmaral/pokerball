import { describePlayerTrait, traitLabel } from '../../engine';
import type { GameContext, Player } from '../../engine';

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function playerImageUrl(p: Pick<Player, 'image'>): string | null {
  if (!p.image) return null;
  if (/^(https?:|data:|blob:)/.test(p.image)) return p.image;
  return import.meta.env.BASE_URL + p.image.replace(/^\//, '');
}

/** Generic placeholder portrait: a coloured silhouette with initials. */
export function Portrait({ player, size = 96 }: { player: Pick<Player, 'id' | 'firstName' | 'lastName' | 'image' | 'position'>; size?: number }) {
  const url = playerImageUrl(player);
  if (url) return <img className="portrait" src={url} alt="" width={size} height={size} onError={(e) => ((e.target as HTMLImageElement).style.visibility = 'hidden')} />;
  const hue = hash(player.id) % 360;
  const initials = ((player.firstName[0] ?? '') + (player.lastName[0] ?? '')).toUpperCase();
  return (
    <svg className="portrait" width={size} height={size} viewBox="0 0 100 100" aria-hidden>
      <defs>
        <linearGradient id={`g${player.id}`} x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor={`hsl(${hue} 55% 42%)`} />
          <stop offset="1" stopColor={`hsl(${(hue + 40) % 360} 60% 24%)`} />
        </linearGradient>
      </defs>
      <rect width="100" height="100" rx="14" fill={`url(#g${player.id})`} />
      <circle cx="50" cy="38" r="17" fill="rgba(255,255,255,.22)" />
      <path d="M16 96c2-24 18-34 34-34s32 10 34 34z" fill="rgba(255,255,255,.22)" />
      <text x="50" y="92" textAnchor="middle" fontSize="20" fontWeight="700" fill="rgba(255,255,255,.85)">
        {initials}
      </text>
    </svg>
  );
}

interface Props {
  player: Player;
  ctx: GameContext;
  selected?: boolean;
  disabled?: boolean;
  compact?: boolean;
  onClick?: () => void;
  footer?: React.ReactNode;
  tag?: string;
}

/** The in-game card of a football player. The admin editor renders this same component as its live preview. */
export function PlayerCard({ player, ctx, selected, disabled, compact, onClick, footer, tag }: Props) {
  const cls = ['player-card', `pos-${player.position}`, selected ? 'selected' : '', disabled ? 'disabled' : '', compact ? 'compact' : '', onClick ? 'clickable' : ''].filter(Boolean).join(' ');
  return (
    <div className={cls} onClick={disabled ? undefined : onClick}>
      <div className="pc-head">
        <span className="pos-pill">{player.position}</span>
        <span className="price">${player.price}</span>
      </div>
      <Portrait player={player} size={compact ? 56 : 96} />
      <div className="pc-name">
        <span className="first">{player.firstName}</span> <strong>{player.lastName}</strong>
      </div>
      {tag && <div className="pc-tag">{tag}</div>}
      <div className="pc-trait">
        <div className="trait-label">{traitLabel(player.trait, ctx.catalog)}</div>
        <div className="trait-desc">{describePlayerTrait(player, ctx)}</div>
      </div>
      {footer}
    </div>
  );
}
