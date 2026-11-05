import { useCallback, useEffect, useRef, useState } from 'react';
import { ctx } from '../data';
import type { ClientView } from '../engine';
import { LocalAITransport } from '../net/localAI';
import { createRoom, joinRoom } from '../net/peer';
import type { GameTransport } from '../net/transport';
import { Fulltime, Halftime } from './screens/EndScreens';
import { Lobby } from './screens/Lobby';
import { Match } from './screens/Match';
import { Transfer } from './screens/Transfer';
import { type Stats, loadStats, loadUsername, recordMatch, saveUsername } from './stats';

type Pending = { kind: 'host'; code: string; open: boolean; cancel: () => void } | { kind: 'guest'; cancel: () => void } | null;

export function App() {
  const [username, setUsernameState] = useState(loadUsername);
  const [transport, setTransport] = useState<GameTransport | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [stats, setStats] = useState<Stats>(loadStats);

  const setUsername = (n: string) => {
    setUsernameState(n);
    saveUsername(n);
  };

  const leave = useCallback(
    (message?: string) => {
      setTransport((t) => {
        t?.close();
        return null;
      });
      setPending(null);
      setNotice(message ?? null);
      setStats(loadStats());
    },
    [setTransport],
  );

  const name = username.trim();

  const startSolo = () => {
    setNotice(null);
    setTransport(new LocalAITransport(ctx, name));
  };

  const startHost = () => {
    setNotice(null);
    try {
      const room = createRoom(ctx, name);
      setPending({ kind: 'host', code: room.code, open: false, cancel: room.cancel });
      room.opened.then(() => setPending((p) => (p && p.kind === 'host' ? { ...p, open: true } : p)));
      room.ready
        .then((t) => {
          setPending(null);
          setTransport(t);
        })
        .catch((e: Error) => {
          setPending(null);
          setNotice(e.message);
        });
    } catch (e) {
      setNotice((e as Error).message);
    }
  };

  const startJoin = (code: string) => {
    setNotice(null);
    try {
      const j = joinRoom(ctx, code, name);
      setPending({ kind: 'guest', cancel: j.cancel });
      j.ready
        .then((t) => {
          setPending(null);
          setTransport(t);
        })
        .catch((e: Error) => {
          setPending(null);
          setNotice(e.message);
        });
    } catch (e) {
      setNotice((e as Error).message);
    }
  };

  if (transport)
    return (
      <Game
        transport={transport}
        stats={stats}
        onStats={setStats}
        onExit={() => leave()}
        onClosed={(reason) => leave(reason)}
      />
    );

  if (pending)
    return (
      <div className="screen center-screen">
        <div className="panel lobby">
          <h2>{pending.kind === 'host' ? 'Waiting for an opponent…' : 'Connecting…'}</h2>
          {pending.kind === 'host' && !pending.open && <p className="muted">Opening room…</p>}
          {pending.kind === 'host' && pending.open && (
            <>
              <p className="muted">Share this room code with your friend:</p>
              <div className="room-code">{pending.code}</div>
              <p className="muted">They choose “Join room” and type it in. The room closes when you cancel.</p>
            </>
          )}
          <button
            className="btn"
            onClick={() => {
              pending.cancel();
              setPending(null);
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    );

  return (
    <Lobby
      username={username}
      setUsername={setUsername}
      stats={stats}
      notice={notice}
      busy={false}
      onSolo={startSolo}
      onCreate={startHost}
      onJoin={startJoin}
    />
  );
}

function Game({
  transport,
  stats,
  onStats,
  onExit,
  onClosed,
}: {
  transport: GameTransport;
  stats: Stats;
  onStats: (s: Stats) => void;
  onExit: () => void;
  onClosed: (reason: string) => void;
}) {
  const [view, setView] = useState<ClientView | null>(null);
  const [deadlineAt, setDeadlineAt] = useState<number | null>(null);
  const [opponentLeft, setOpponentLeft] = useState<string | null>(null);
  const recorded = useRef(false);
  const viewRef = useRef<ClientView | null>(null);
  viewRef.current = view;

  useEffect(() => {
    const offView = transport.onView((v) => {
      setView(v);
      setDeadlineAt(v.timerMs === null ? null : Date.now() + v.timerMs);
    });
    const offClosed = transport.onClosed((reason) => {
      // After the final whistle the result stays on screen; otherwise the match is void.
      if (viewRef.current?.phase === 'fulltime') setOpponentLeft(reason);
      else onClosed(reason);
    });
    return () => {
      offView();
      offClosed();
    };
  }, [transport, onClosed]);

  // Record stats once per finished match (matches ended by a disconnect never reach fulltime).
  useEffect(() => {
    if (!view) return;
    if (view.phase === 'fulltime' && !recorded.current) {
      recorded.current = true;
      const opp = view.me === 'A' ? 'B' : 'A';
      onStats(recordMatch(view.goals[view.me], view.goals[opp]));
    }
    if (view.phase !== 'fulltime') recorded.current = false;
  }, [view, onStats]);

  if (!view) return <div className="screen center-screen">Loading…</div>;
  const send = transport.send.bind(transport);

  return (
    <>
      <button className="exit-btn" onClick={() => confirm('Leave the match? It will not be recorded.') && onExit()}>
        ✕ Leave
      </button>
      {view.phase === 'transfer' && <Transfer view={view} ctx={ctx} send={send} />}
      {(view.phase === 'duel' || view.phase === 'shot' || view.phase === 'reveal') && (
        <Match view={view} ctx={ctx} send={send} deadlineAt={deadlineAt} />
      )}
      {view.phase === 'halftime' && <Halftime view={view} send={send} />}
      {view.phase === 'fulltime' && <Fulltime view={view} stats={stats} send={send} onExit={onExit} opponentLeft={opponentLeft} />}
    </>
  );
}
