import { useEffect, useMemo, useState } from 'react';
import { activePosition, describePlayerTrait, other, parseCard, previewSelection } from '../../engine';
import type { CardId, ClientView, GameContext, Intent, Position, Zone } from '../../engine';
import { CardFace } from '../components/CardFace';
import { Calc, ClockIcon, DeckIcon, DiscardIcon, IconText, ShieldIcon } from '../components/Icons';
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

export const fmt = (n: number): string =>
  Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');

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
        <SquadModal title={`Your squad`} squad={view.squad} ctx={ctx} onClose={() => setModal(null)} />
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
        <span className="team-hint">Your squad</span>
      </button>
      <div className="score">
        <div className="score-line">
          <span className="goals">{view.goals[me]}</span>
          <span className="dash">:</span>
          <span className="goals">{view.goals[opp]}</span>
        </div>
        <div className="meta">
          <span>{view.half === 1 ? '1st half' : '2nd half'}</span>
          <span className="sep">•</span>
          <span>
            {Math.min(view.resolvedInHalf + (view.phase === 'duel' ? 1 : 0), view.duelsPerHalf)}/{view.duelsPerHalf}
          </span>
        </div>
      </div>
      <button className="team opp" onClick={() => onOpenSquad('opp')} title="View their squad">
        <span className="team-name">{view.names[opp]}</span>
        <span className="team-hint">Their squad</span>
      </button>
    </header>
  );
}

const NODE_LABEL: Record<number, [string, string]> = {
  [-1]: ['Your DEF vs their FWD', 'DEF · FWD'],
  0: ['MID vs MID', 'MID · MID'],
  1: ['Your FWD vs their DEF', 'FWD · DEF'],
};

function Pitch({ view }: { view: ClientView }) {
  const n = myNode(view);
  const pos = (k: number) => (k === -1 ? 16 : k === 0 ? 50 : 84);
  const active = view.phase === 'shot' ? (view.shooter === view.me ? 1 : -1) : n;
  return (
    <div className="pitch" aria-label="Pitch">
      <div className="goalpost left" />
      <div className="goalpost right" />
      <div className="midline" />
      <div className="centercircle" />
      {[-1, 0, 1].map((k) => (
        <div key={k} className={`node ${active === k ? 'active' : ''}`} style={{ left: `${pos(k)}%` }}>
          <span className="node-dot" />
          <span className="node-label">
            <span className="full">{NODE_LABEL[k][0]}</span>
            <span className="short">{NODE_LABEL[k][1]}</span>
          </span>
        </div>
      ))}
      <div className="ball" style={{ left: `${pos(n)}%` }}>
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
        <div className="arena-title">
          {inShot && shooter ? (shooter === me ? 'Your shooter' : 'Your keeper') : `Your ${posOf(me)}`}
        </div>
        {mine ? <PlayerCard player={ctx.players[mine]} ctx={ctx} compact /> : <div className="muted">—</div>}
      </div>
      <div className="vs" aria-hidden>
        VS
      </div>
      <div className="arena-side right">
        <div className="arena-title">
          {inShot && shooter ? (shooter === opp ? 'Their shooter' : 'Their keeper') : `Their ${posOf(opp)}`}
        </div>
        {theirs ? <PlayerCard player={ctx.players[theirs]} ctx={ctx} compact /> : <div className="muted">—</div>}
      </div>
      {myKeeper && posOf(me) !== 'GK' && (
        <div className="keeper-note" title="Your goalkeeper's passive bonuses apply to every duel">
          <ShieldIcon />
          <span className="kn-name">{myKeeper.lastName}</span>
          <span className="kn-desc">
            <IconText text={describePlayerTrait(myKeeper, ctx).replace(/^Permanent bonuses for your team's hands: /, '')} />
          </span>
        </div>
      )}
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
    if (sort === 'suit')
      h.sort((a, b) => parseCard(a).suit.localeCompare(parseCard(b).suit) || parseCard(b).rank - parseCard(a).rank);
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
  const urgent = left !== null && left < 5000;

  let status: React.ReactNode = <span className="muted">Pick 1–5 cards — only the cards that form the hand score.</span>;
  if (locked && !view.oppLocked) status = <span>Locked in. Waiting for {oppName}…</span>;
  else if (!locked && view.oppLocked)
    status = (
      <span className={urgent ? 'urgent' : ''}>
        {oppName} is ready — your highest card auto-plays when time runs out.
      </span>
    );

  return (
    <section className="hand-area">
      <div className="hand-top">
        <div className="chips-row">
          <span className="pill" title="Cards left in your deck">
            <DeckIcon /> {view.deckCount}
          </span>
          <span className="pill" title="Discards left">
            <DiscardIcon /> {view.discardsLeft}
          </span>
          <span className={`pill ${view.oppLocked ? 'ok' : ''}`}>
            <span className={`dot ${view.oppLocked ? 'on' : 'pulse'}`} />
            {oppName}
            {view.oppLocked ? ' ready' : ' thinking'}
          </span>
          {left !== null && view.oppLocked !== locked && (
            <span className={`pill timer ${urgent ? 'bad' : ''}`}>
              <ClockIcon /> {Math.ceil(left / 1000)}s
            </span>
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
            style={{ animationDelay: `${i * 35}ms` }}
          />
        ))}
      </div>

      <div className="action-bar">
        <div className="preview">
          {preview ? (
            <>
              <span className="preview-hand">{ctx.balance.hands[preview.hand].label}</span>
              <Calc chips={fmt(preview.chips)} mult={fmt(preview.mult)} score={fmt(preview.score)} />
            </>
          ) : (
            <span className="muted">Select cards to preview your score</span>
          )}
        </div>
        <div className="controls">
          <div className="sort" role="group" aria-label="Sort hand">
            {(['deal', 'rank', 'suit'] as SortMode[]).map((m) => (
              <button key={m} className={`seg ${sort === m ? 'active' : ''}`} onClick={() => setSort(m)}>
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
            title={`Replace the selected cards (${view.discardsLeft} left)`}
            onClick={() => {
              send({ type: 'discard', cards: selected });
              setSelected([]);
            }}
          >
            <DiscardIcon /> Discard{selected.length > 0 ? ` ${selected.length}` : ''}
          </button>
          <button
            className="btn primary"
            disabled={locked || selected.length < 1 || selected.length > max}
            onClick={() => send({ type: 'lock', cards: selected })}
          >
            {locked ? 'Ready ✓' : 'Ready'}
          </button>
        </div>
      </div>
    </section>
  );
}

const ZONE_LABEL: Record<Zone, string> = { left: 'Left', center: 'Center', right: 'Right' };

function ShotArea({ view, send, deadlineAt }: Props) {
  const left = useCountdown(deadlineAt);
  const shooting = view.shooter === view.me;
  const oppName = view.names[other(view.me)];
  const zones: Zone[] = ['left', 'center', 'right'];
  return (
    <section className="shot-area">
      <h3>{shooting ? 'Penalty chance — pick where to shoot' : `${oppName} is shooting — pick where to dive`}</h3>
      <p className="muted">
        {shooting ? 'You score if the keeper picks a different zone.' : 'Save it by choosing the same zone as the shooter.'}
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
