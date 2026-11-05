import { POSITIONS } from '../../engine';
import type { GameContext, Squad } from '../../engine';
import { PlayerCard } from './PlayerCard';

export function SquadModal({
  title,
  squad,
  ctx,
  onClose,
}: {
  title: string;
  squad: Squad | null;
  ctx: GameContext;
  onClose: () => void;
}) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h3>{title}</h3>
          <button className="btn ghost small" onClick={onClose}>
            Close
          </button>
        </header>
        {squad ? (
          <div className="squad-grid">
            {POSITIONS.map((pos) => {
              const id = squad[pos];
              return id ? (
                <PlayerCard key={pos} player={ctx.players[id]} ctx={ctx} />
              ) : (
                <div key={pos} className="muted">
                  No {pos}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="muted">Squads are revealed once the transfer phase is over.</p>
        )}
      </div>
    </div>
  );
}
