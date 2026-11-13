import { useEffect, useRef, useState } from 'react';
import { ctx } from '../../data';
import type { ClientView, Intent, TMatch, TournamentView } from '../../engine';
import type { TournamentTransport } from '../../net/transport';
import { useCountdown } from '../hooks';
import { Halftime } from './EndScreens';
import { Match, pensScored } from './Match';
import { Transfer, type TransferIntent } from './Transfer';

interface Props {
  transport: TournamentTransport;
  /** Room creator only: the code guests type in. */
  roomCode?: string;
  /** Room creator only: false while the room is still being registered with the broker. */
  roomOpen: boolean;
  onExit: () => void;
  onClosed: (reason: string) => void;
}

export function TournamentGame({ transport, roomCode, roomOpen, onExit, onClosed }: Props) {
  const [view, setView] = useState<TournamentView | null>(null);
  const [matchDeadline, setMatchDeadline] = useState<number | null>(null);
  const [startsAt, setStartsAt] = useState<number | null>(null);
  const closedRef = useRef(onClosed);
  closedRef.current = onClosed;

  useEffect(() => {
    const offView = transport.onView((v) => {
      setView(v);
      setMatchDeadline(v.match?.timerMs == null ? null : Date.now() + v.match.timerMs);
      setStartsAt(v.startsInMs === null ? null : Date.now() + v.startsInMs);
    });
    const offClosed = transport.onClosed((reason) => closedRef.current(reason));
    return () => {
      offView();
      offClosed();
    };
  }, [transport]);

  if (!view) return <div className="screen center-screen">Loading…</div>;

  const leave = () => {
    const warning = view.isHost
      ? 'Leave and close the tournament for everyone?'
      : view.stage === 'finished'
        ? 'Leave the tournament?'
        : 'Leave the tournament? You will be eliminated.';
    if (view.stage === 'finished' || confirm(warning)) onExit();
  };
  const sendMatch = (intent: Intent) => transport.send({ type: 'match', intent });

  return (
    <>
      <button className="exit-btn" onClick={leave}>
        <span aria-hidden>✕</span>
        <span className="lbl"> Leave</span>
      </button>
      {view.stage === 'lobby' && <TournamentLobby view={view} roomCode={roomCode} roomOpen={roomOpen} send={transport.send.bind(transport)} />}
      {view.stage === 'transfer' && (
        <Transfer
          view={{ market: view.market, squad: view.squad, budgetLeft: view.budgetLeft, meTransferReady: view.meReady }}
          ctx={ctx}
          send={(i: TransferIntent) => transport.send(i)}
          tournament={{ ready: view.players.filter((p) => p.connected && p.ready).length, total: view.players.filter((p) => p.connected).length }}
        />
      )}
      {view.stage === 'match' && view.match && (
        <>
          {(view.match.phase === 'duel' || view.match.phase === 'shot' || view.match.phase === 'reveal') && (
            <Match view={view.match} ctx={ctx} send={sendMatch} deadlineAt={matchDeadline} />
          )}
          {view.match.phase === 'halftime' && <Halftime view={view.match} send={sendMatch} />}
          {view.match.phase === 'fulltime' && <TournamentFulltime tv={view} match={view.match} onAck={() => transport.send({ type: 'ack' })} />}
        </>
      )}
      {(view.stage === 'bracket' || view.stage === 'finished') && <Bracket tv={view} startsAt={startsAt} onExit={onExit} />}
    </>
  );
}

// ---------------------------------------------------------------------------

function TournamentLobby({
  view,
  roomCode,
  roomOpen,
  send,
}: {
  view: TournamentView;
  roomCode?: string;
  roomOpen: boolean;
  send: (i: { type: 'start' }) => void;
}) {
  const count = view.players.filter((p) => p.connected).length;
  const enough = count >= view.minPlayers;
  return (
    <div className="screen center-screen">
      <div className="panel lobby">
        <h2>Tournament lobby</h2>
        {view.isHost && (
          <>
            {!roomOpen && <p className="muted">Opening room…</p>}
            {roomOpen && roomCode && (
              <>
                <p className="muted">Share this room code. Everyone picks “Join room” and types it in:</p>
                <div className="room-code">{roomCode}</div>
              </>
            )}
          </>
        )}
        <div className="t-count muted">
          {count} / {view.maxPlayers} players
        </div>
        <ul className="t-list">
          {view.players.map((p) => (
            <li key={p.id} className={`t-player ${p.id === view.me ? 'me' : ''}`}>
              <span>{p.name}</span>
              <span className="muted">
                {p.id === 'p0' ? 'host' : ''}
                {p.id === view.me ? (p.id === 'p0' ? ' · you' : 'you') : ''}
              </span>
            </li>
          ))}
        </ul>
        {view.isHost ? (
          <>
            <button className="btn primary big" disabled={!enough || !roomOpen} onClick={() => send({ type: 'start' })}>
              Start tournament
            </button>
            <p className="muted footnote">
              {enough
                ? 'Starting opens the transfer market: everyone builds one squad that plays the whole tournament. No one can join after that.'
                : `At least ${view.minPlayers} players are needed. With an odd number, one player gets a bye each round.`}
            </p>
          </>
        ) : (
          <p className="muted">Waiting for the host to start the tournament…</p>
        )}
      </div>
    </div>
  );
}

function TournamentFulltime({ tv, match, onAck }: { tv: TournamentView; match: ClientView; onAck: () => void }) {
  const opp = match.me === 'A' ? 'B' : 'A';
  const won = match.winner === match.me;
  const champion = tv.champion === tv.me;
  const mine = match.goals[match.me];
  const theirs = match.goals[opp];
  const pens = match.shootout ? `Penalties ${pensScored(match, match.me)}–${pensScored(match, opp)}` : null;
  return (
    <div className="screen center-screen">
      <div className="panel big-panel">
        <h2>Full time</h2>
        <div className={`result ${won ? 'good' : 'bad'}`}>{champion ? 'Champion! 🏆' : won ? 'You advance!' : 'Eliminated'}</div>
        <div className="big-score">
          <span>{match.names[match.me]}</span>
          <strong>
            {mine} – {theirs}
          </strong>
          <span>{match.names[opp]}</span>
        </div>
        {pens && <p className="muted">{pens}</p>}
        <button className="btn primary big" onClick={onAck}>
          {champion ? 'See the final bracket' : won ? 'To the bracket' : 'Watch the bracket'}
        </button>
        <p className="muted footnote">This screen closes by itself in a few seconds.</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function Bracket({ tv, startsAt, onExit }: { tv: TournamentView; startsAt: number | null; onExit: () => void }) {
  const left = useCountdown(startsAt);
  const name = (id: string | null) => (id === null ? '—' : (tv.players.find((p) => p.id === id)?.name ?? '?'));
  const finished = tv.stage === 'finished';
  const champion = tv.champion;

  let status: string;
  if (champion === tv.me) status = 'You won the tournament! 🏆';
  else if (champion) status = `${name(champion)} won the tournament.`;
  else if (finished) status = 'The tournament is over.';
  else if (!tv.meAlive) status = 'You are out. You can follow the bracket until the end.';
  else if (tv.myMatch && tv.myMatch.b === null) status = 'You have a bye this round: you advance without playing.';
  else if (tv.myMatch && tv.myMatch.winner === null)
    status = left !== null ? `Next: you vs ${name(tv.myMatch.a === tv.me ? tv.myMatch.b : tv.myMatch.a)}. Kick-off in ${Math.ceil(left / 1000)}s.` : 'Your match is about to start…';
  else status = 'Waiting for the other matches to finish…';

  return (
    <div className="screen center-screen">
      <div className="panel big-panel bracket">
        <h2>{champion ? '🏆 Tournament result' : 'Tournament bracket'}</h2>
        {tv.notice && <div className="notice">{tv.notice}</div>}
        <div className={`result ${champion === tv.me ? 'good' : ''}`}>{status}</div>
        {!finished && left !== null && <p className="muted">Next round starts in {Math.ceil(left / 1000)}s.</p>}
        <div className="t-rounds">
          {tv.rounds.map((round, ri) => (
            <section key={ri} className="t-round">
              <h3>{ri === tv.rounds.length - 1 && !!champion && round.filter((m) => m.b !== null).length === 1 ? 'Final' : `Round ${ri + 1}`}</h3>
              <ul className="t-list">
                {round.map((m) => (
                  <MatchRow key={m.id} m={m} name={name} me={tv.me} />
                ))}
              </ul>
            </section>
          ))}
        </div>
        {finished && (
          <button className="btn primary big" onClick={onExit}>
            Back to lobby
          </button>
        )}
      </div>
    </div>
  );
}

function MatchRow({ m, name, me }: { m: TMatch; name: (id: string | null) => string; me: string }) {
  const mine = m.a === me || m.b === me;
  if (m.b === null)
    return (
      <li className={`t-match bye ${mine ? 'mine' : ''}`}>
        <span className="t-side win">{name(m.a)}</span>
        <span className="muted">bye</span>
      </li>
    );
  const result = m.goals
    ? `${m.goals[0]}–${m.goals[1]}${m.pens ? ` (pens ${m.pens[0]}–${m.pens[1]})` : ''}`
    : m.forfeit
      ? 'walkover'
      : m.winner
        ? ''
        : 'vs';
  return (
    <li className={`t-match ${mine ? 'mine' : ''}`}>
      <span className={`t-side ${m.winner === m.a ? 'win' : m.winner ? 'lose' : ''}`}>{name(m.a)}</span>
      <span className="t-result muted">{result}</span>
      <span className={`t-side right ${m.winner === m.b ? 'win' : m.winner ? 'lose' : ''}`}>{name(m.b)}</span>
    </li>
  );
}
