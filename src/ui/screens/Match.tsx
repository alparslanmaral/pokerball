import { useEffect, useMemo, useState } from 'react';
import { activePosition, describePlayerTrait, other, parseCard, previewSelection } from '../../engine';
import type { CardId, ClientView, GameContext, Intent, Position, Zone } from '../../engine';
import { CardFace } from '../components/CardFace';
import { PlayerCard } from '../components/PlayerCard';
import { SquadModal } from '../components/SquadModal';
import { useCountdown } from '../hooks';
import { RevealOverlay } from './Reveal';

interface Props {
  view: ClientView;
  ctx: GameContext;
  send: (i: Intent) => void;
  /** Local-clock timestamp at which the running countdown ends. */
  deadlineAt: number | null;
}

/** Ball position as seen by the local player: -1 = my defence, +1 = my attack. */
export function myNode(view: ClientView, node = view.node): number {
  return view.me === 'A' ? node : -node;
}

export function Match({ view, ctx, send, deadlineAt }: Props) {
  const [modal, setModal] = useState<'me' | 'opp' | null>(null);
  const me = view.me;
  const opp = other(me);

  return (
    <div className="screen match">
      <Scoreboard view={view} onOpenSquad={setModal} />
      <Pitch view={view} />
      <Arena view={view} ctx={ctx} />
      {view.phase === 'duel' && <HandArea view={view} ctx={ctx} send={send} deadlineAt={deadlineAt} />}
      {view.phase === 'shot' && <ShotArea view={view} ctx={ctx} send={send} deadlineAt={deadlineAt} />}
      {view.phase === 'reveal' && <RevealOverlay view={view} ctx={ctx} send={send} />}
      {modal === 'opp' && (
        <SquadModal title={`${view.names[opp]}'s squad`} squad={view.oppSquad} ctx={ctx} onClose={() => setModal(null)} />
      )}
      {modal === 'me' && (
        <SquadModal title={`${view.names[me]} (you) — your squad`} squad={view.squad} ctx={ctx} onClose={() => setModal(null)} />
      )}
    </div>
  );
}

function Scoreboard({ view, onOpenSquad }: { view: ClientView; onOpenSquad: (m: 'me' | 'opp') => void }) {
  const me = view.me;
  const opp = other(me);
  return (
    <header className="scoreboard">
      <button className="team me" onClick={() => onOpenSquad('me')} title="View your squad">
        <span className="team-name">{view.names[me]}</span>
        <span className="team-hint">your squad ▸</span>
      </button>
      <div className="score">
        <span className="goals">{view.goals[me]}</span>
        <span className="dash">–</span>
        <span className="goals">{view.goals[opp]}</span>
        <div className="meta">
          Half {view.half} · Duel {Math.min(view.resolvedInHalf + (view.phase === 'duel' ? 1 : 0), view.duelsPerHalf)}/
          {view.duelsPerHalf}
        </div>
      </div>
      <button className="team opp" onClick={() => onOpenSquad('opp')} title="View their squad">
        <span className="team-name">{view.names[opp]}</span>
        <span className="team-hint">◂ their squad</span>
      </button>
    </header>
  );
}

const NODE_LABEL: Record<number, string> = { [-1]: 'Your DEF vs their FWD', 0: 'MID vs MID', 1: 'Your FWD vs their DEF' };

function Pitch({ view }: { view: ClientView }) {
  const n = myNode(view);
  const left = n === -1 ? 16 : n === 0 ? 50 : 84;
  const active = view.phase === 'shot' ? (view.shooter === view.me ? 1 : -1) : n;
  return (
    <div className="pitch" aria-label="Pitch">
      <div className="goalpost left">YOUR GOAL</div>
      <div className="goalpost right">THEIR GOAL</div>
      <div className="midline" />
      {[-1, 0, 1].map((k) => (
        <div key={k} className={`node ${active === k ? 'active' : ''}`} style={{ left: `${k === -1 ? 16 : k === 0 ? 50 : 84}%` }}>
          <span className="node-dot" />
          <span className="node-label">{NODE_LABEL[k]}</span>
        </div>
      ))}
      <div className="ball" style={{ left: `${left}%` }}>
        ⚽
      </div>
    </div>
  );
}

function Arena({ view, ctx }: { view: ClientView; ctx: GameContext }) {
  const me = view.me;
  const opp = other(me);
  const inShot = view.phase === 'shot' || (view.phase === 'reveal' && view.reveal?.kind === 'shot');
  // Position-matched players at the node (during a shot: the shooter's forward against the keeper).
  const shooter = view.shooter;
  const posOf = (side: typeof me): Position => {
    if (inShot && shooter) return side === shooter ? 'FWD' : 'GK';
    const nodeForCard = view.phase === 'reveal' && view.reveal?.kind === 'duel' ? view.reveal.nodeBefore : view.node;
    return activePosition(side, nodeForCard);
  };
  const mine = view.squad[posOf(me)];
  const theirs = view.oppSquad?.[posOf(opp)];
  const myKeeper = view.squad.GK ? ctx.players[view.squad.GK] : null;

  return (
    <div className="arena">
      <div className="arena-side">
        <div className="arena-title">{inShot && shooter ? (shooter === me ? 'Your shooter' : 'Your keeper') : `Your ${posOf(me)}`}</div>
        {mine ? <PlayerCard player={ctx.players[mine]} ctx={ctx} compact /> : <div className="muted">—</div>}
        {myKeeper && posOf(me) !== 'GK' && (
          <div className="keeper-note" title="Your goalkeeper's passive bonuses apply to every duel">
            <strong>🧤 {myKeeper.lastName}</strong>
            <span>{describePlayerTrait(myKeeper, ctx)}</span>
          </div>
        )}
      </div>
      <div className="arena-mid">
        <div className="vs">VS</div>
      </div>
      <div className="arena-side right">
        <div className="arena-title">{inShot && shooter ? (shooter === opp ? 'Their shooter' : 'Their keeper') : `Their ${posOf(opp)}`}</div>
        {theirs ? <PlayerCard player={ctx.players[theirs]} ctx={ctx} compact /> : <div className="muted">—</div>}
      </div>
    </div>
  );
}

type SortMode = 'deal' | 'rank' | 'suit';

function HandArea({ view, ctx, send, deadlineAt }: Props) {
  const [selected, setSelected] = useState<CardId[]>([]);
  const [sort, setSort] = useState<SortMode>('deal');
  const left = useCountdown(deadlineAt);
  const locked = !!view.myLock;

  // Drop selections that are no longer in hand (after a discard) and reset between duels.
  useEffect(() => {
    setSelected((sel) => sel.filter((c) => view.hand.includes(c)));
  }, [view.hand]);
  useEffect(() => {
    if (view.phase !== 'duel') setSelected([]);
  }, [view.phase]);

  const shown = useMemo(() => {
    const h = view.hand.slice();
    if (sort === 'rank') h.sort((a, b) => parseCard(b).rank - parseCard(a).rank);
    if (sort === 'suit') h.sort((a, b) => parseCard(a).suit.localeCompare(parseCard(b).suit) || parseCard(b).rank - parseCard(a).rank);
    return h;
  }, [view.hand, sort]);

  const played = locked ? view.myLock!.cards : selected;
  const preview = previewSelection(ctx, view, played);
  const max = ctx.balance.maxPlay;
  const toggle = (id: CardId) => {
    if (locked) return;
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : s.length < max ? [...s, id] : s));
  };
  const oppName = view.names[other(view.me)];
  const canDiscard = !locked && selected.length > 0 && selected.length <= view.discardsLeft;

  let status: React.ReactNode = <span className="muted">Pick 1–5 cards. Only the cards that form the hand score.</span>;
  if (locked && !view.oppLocked) status = <span>Locked in. Waiting for {oppName}…</span>;
  else if (!locked && view.oppLocked)
    status = (
      <span className={left !== null && left < 5000 ? 'urgent' : ''}>
        {oppName} is ready — you have <strong>{Math.ceil((left ?? 0) / 1000)}s</strong> (then your highest card is auto-played)
      </span>
    );

  return (
    <section className="hand-area">
      <div className="hand-status">
        <div className="chips-row">
          <span className="stat-chip">Deck {view.deckCount}</span>
          <span className="stat-chip">Discards {view.discardsLeft}</span>
          <span className={`stat-chip ${view.oppLocked ? 'ok' : ''}`}>
            {oppName}: {view.oppLocked ? 'ready ✓' : 'thinking…'}
          </span>
          {left !== null && view.oppLocked !== locked && (
            <span className={`stat-chip ${left < 5000 ? 'bad' : ''}`}>⏱ {Math.ceil(left / 1000)}s</span>
          )}
        </div>
        <div className="status-line">{status}</div>
      </div>

      <div className="hand" role="group" aria-label="Your hand">
        {shown.map((id, i) => (
          <CardFace
            key={id}
            id={id}
            selected={played.includes(id)}
            dimmed={locked && !played.includes(id)}
            scoring={!!preview && preview.scoring.includes(id)}
            onClick={locked ? undefined : () => toggle(id)}
            style={{ animationDelay: `${i * 40}ms` }}
          />
        ))}
      </div>

      <div className="preview">
        {preview ? (
          <>
            <span className="preview-hand">{ctx.balance.hands[preview.hand].label}</span>
            <span className="preview-score">
              <span className="chips">{fmt(preview.chips)}</span> × <span className="mult">{fmt(preview.mult)}</span> ={' '}
              <strong>{fmt(preview.score)}</strong>
            </span>
          </>
        ) : (
          <span className="muted">Select cards to preview your score</span>
        )}
      </div>

      <div className="controls">
        <div className="sort">
          <span className="muted">Sort</span>
          {(['deal', 'rank', 'suit'] as SortMode[]).map((m) => (
            <button key={m} className={`btn tiny ${sort === m ? 'active' : ''}`} onClick={() => setSort(m)}>
              {m}
            </button>
          ))}
        </div>
        <button className="btn" disabled={locked || selected.length === 0} onClick={() => setSelected([])}>
          Clear
        </button>
        <button
          className="btn"
          disabled={!canDiscard}
          title={`Replace the selected cards (${view.discardsLeft} discard${view.discardsLeft === 1 ? '' : 's'} left)`}
          onClick={() => {
            send({ type: 'discard', cards: selected });
            setSelected([]);
          }}
        >
          Discard {selected.length > 0 ? `(${selected.length})` : ''}
        </button>
        <button
          className="btn primary big"
          disabled={locked || selected.length < 1 || selected.length > max}
          onClick={() => send({ type: 'lock', cards: selected })}
        >
          {locked ? 'Ready ✓' : 'Ready'}
        </button>
      </div>
    </section>
  );
}

export const fmt = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, '').replace(/\.$/, ''));

const ZONE_LABEL: Record<Zone, string> = { left: 'Left', center: 'Center', right: 'Right' };

function ShotArea({ view, send, deadlineAt }: Props) {
  const left = useCountdown(deadlineAt);
  const shooting = view.shooter === view.me;
  const oppName = view.names[other(view.me)];
  const zones: Zone[] = ['left', 'center', 'right'];
  return (
    <section className="shot-area">
      <h3>{shooting ? 'Penalty chance! Pick where to shoot' : `${oppName} is shooting! Pick where to dive`}</h3>
      <p className="muted">
        {shooting ? 'Score if the keeper guesses a different zone.' : 'Save it by guessing the same zone as the shooter.'}
      </p>
      <div className="goal-frame">
        {zones.map((z) => (
          <button
            key={z}
            className={`zone ${view.myShotPick === z ? 'picked' : ''}`}
            disabled={!!view.myShotPick}
            onClick={() => send({ type: 'shotPick', zone: z })}
          >
            <span className="zone-icon">{shooting ? '⚽' : '🧤'}</span>
            <span>{ZONE_LABEL[z]}</span>
          </button>
        ))}
      </div>
      <div className="status-line">
        {view.myShotPick ? (
          <span>Locked in. Waiting for {oppName}…</span>
        ) : view.oppShotPicked ? (
          <span className={left !== null && left < 5000 ? 'urgent' : ''}>
            {oppName} has chosen — {Math.ceil((left ?? 0) / 1000)}s left (random pick on timeout)
          </span>
        ) : (
          <span className="muted">Both picks are simultaneous and hidden.</span>
        )}
      </div>
    </section>
  );
}
