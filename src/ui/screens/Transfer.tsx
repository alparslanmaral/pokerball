import { useState } from 'react';
import { POSITIONS, canBuy } from '../../engine';
import type { ClientView, GameContext, Intent, Position } from '../../engine';
import { PlayerCard } from '../components/PlayerCard';

const POS_NAME: Record<Position, string> = { GK: 'Goalkeeper', DEF: 'Defender', MID: 'Midfielder', FWD: 'Forward' };

interface Props {
  view: ClientView;
  ctx: GameContext;
  send: (i: Intent) => void;
}

export function Transfer({ view, ctx, send }: Props) {
  const [tab, setTab] = useState<Position>('GK');
  const squadFull = POSITIONS.every((p) => view.market[p].length === 0 || view.squad[p]);
  const oppName = view.names[view.me === 'A' ? 'B' : 'A'];

  return (
    <div className="screen transfer">
      <header className="screen-head">
        <h2>Transfer market</h2>
        <div className="budget">
          <span className="muted">Budget</span> <strong>${view.budgetLeft}</strong>{' '}
          <span className="muted">left of ${ctx.balance.budget}</span>
        </div>
      </header>
      <p className="muted lead">
        Sign one player for every position. Your market is private and different from {oppName}&apos;s. You can change
        your mind until you press Ready.
      </p>

      <div className="tabs" role="tablist">
        {POSITIONS.map((p) => {
          const id = view.squad[p];
          return (
            <button
              key={p}
              role="tab"
              aria-selected={tab === p}
              className={`tab ${tab === p ? 'active' : ''} ${id ? 'filled' : ''}`}
              onClick={() => setTab(p)}
            >
              <span className="tab-pos">{p}</span>
              <span className="tab-sub">{id ? `${ctx.players[id].lastName} · $${ctx.players[id].price}` : POS_NAME[p]}</span>
              {id && <span className="check">✓</span>}
            </button>
          );
        })}
      </div>

      <div className="offers">
        {view.market[tab].map((id) => {
          const p = ctx.players[id];
          const owned = view.squad[tab] === id;
          const affordable = owned || canBuy(ctx, view.market, view.squad, id);
          return (
            <PlayerCard
              key={id}
              player={p}
              ctx={ctx}
              selected={owned}
              disabled={view.meTransferReady || (!affordable && !owned)}
              tag={owned ? 'Signed' : !affordable ? 'Would leave too little for the other positions' : undefined}
              onClick={() => (owned ? send({ type: 'unbuy', position: tab }) : send({ type: 'buy', playerId: id }))}
              footer={
                !view.meTransferReady && (
                  <button className={`btn small ${owned ? 'ghost' : ''}`} disabled={!affordable && !owned}>
                    {owned ? 'Release' : 'Sign'}
                  </button>
                )
              }
            />
          );
        })}
        {view.market[tab].length === 0 && <p className="muted">No players available for this position.</p>}
      </div>

      <footer className="screen-foot">
        <div className="status">
          {view.meTransferReady ? (
            <span>
              Waiting for {oppName}… {view.oppTransferReady ? '(ready)' : '(still shopping)'}
            </span>
          ) : (
            <span className="muted">
              {squadFull ? 'Squad complete.' : 'Fill all four positions to continue.'} {oppName} is{' '}
              {view.oppTransferReady ? 'ready' : 'shopping'}.
            </span>
          )}
        </div>
        <button
          className="btn primary big"
          disabled={!squadFull || view.meTransferReady}
          onClick={() => send({ type: 'transferReady' })}
        >
          {view.meTransferReady ? 'Ready ✓' : 'Ready'}
        </button>
      </footer>
    </div>
  );
}
