import { other } from '../../engine';
import type { ClientView, Intent } from '../../engine';
import type { Stats } from '../stats';

export function Halftime({ view, send }: { view: ClientView; send: (i: Intent) => void }) {
  const opp = other(view.me);
  return (
    <div className="screen center-screen">
      <div className="panel big-panel">
        <h2>Halftime</h2>
        <div className="big-score">
          <span>{view.names[view.me]}</span>
          <strong>
            {view.goals[view.me]} – {view.goals[opp]}
          </strong>
          <span>{view.names[opp]}</span>
        </div>
        <p className="muted">
          Both decks are restored to 52 cards and the ball goes back to midfield. Squads stay the same for the second
          half.
        </p>
        <button className="btn primary big" disabled={view.meContinued} onClick={() => send({ type: 'continue' })}>
          {view.meContinued ? `Waiting for ${view.names[opp]}…` : 'Start second half'}
        </button>
      </div>
    </div>
  );
}

export function Fulltime({
  view,
  stats,
  send,
  onExit,
  opponentLeft,
}: {
  view: ClientView;
  stats: Stats;
  send: (i: Intent) => void;
  onExit: () => void;
  opponentLeft?: string | null;
}) {
  const opp = other(view.me);
  const mine = view.goals[view.me];
  const theirs = view.goals[opp];
  const result = mine > theirs ? 'Victory!' : mine < theirs ? 'Defeat' : 'Draw';
  const cls = mine > theirs ? 'good' : mine < theirs ? 'bad' : '';
  return (
    <div className="screen center-screen">
      <div className="panel big-panel">
        <h2>Full time</h2>
        <div className={`result ${cls}`}>{result}</div>
        <div className="big-score">
          <span>{view.names[view.me]}</span>
          <strong>
            {mine} – {theirs}
          </strong>
          <span>{view.names[opp]}</span>
        </div>
        <StatsTable stats={stats} title="Your record on this browser" />
        <div className="row-buttons">
          <button className="btn primary big" disabled={view.meRematch || !!opponentLeft} onClick={() => send({ type: 'rematch' })}>
            {view.meRematch ? (view.oppRematch ? 'Starting…' : `Waiting for ${view.names[opp]}…`) : 'Rematch'}
          </button>
          <button className="btn" onClick={onExit}>
            Back to lobby
          </button>
        </div>
        {opponentLeft && <p className="muted">{opponentLeft} No rematch is possible.</p>}
        {view.oppRematch && !view.meRematch && <p className="muted">{view.names[opp]} wants a rematch.</p>}
      </div>
    </div>
  );
}

export function StatsTable({ stats, title }: { stats: Stats; title: string }) {
  return (
    <div className="stats">
      <div className="muted stats-title">{title}</div>
      <div className="stats-grid">
        <Cell label="Played" v={stats.played} />
        <Cell label="Won" v={stats.wins} />
        <Cell label="Drawn" v={stats.draws} />
        <Cell label="Lost" v={stats.losses} />
        <Cell label="Goals for" v={stats.goalsFor} />
        <Cell label="Goals against" v={stats.goalsAgainst} />
      </div>
    </div>
  );
}

function Cell({ label, v }: { label: string; v: number }) {
  return (
    <div className="stat-cell">
      <strong>{v}</strong>
      <span>{label}</span>
    </div>
  );
}
