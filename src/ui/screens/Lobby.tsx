import { useState } from 'react';
import { dbVersionHash } from '../../data';
import type { Stats } from '../stats';
import { useInstallPrompt } from '../pwa';
import { StatsTable } from './EndScreens';

interface Props {
  username: string;
  setUsername: (n: string) => void;
  stats: Stats;
  notice: string | null;
  busy: boolean;
  onSolo: () => void;
  onCreate: () => void;
  onTournament: () => void;
  onJoin: (code: string) => void;
}

export function Lobby({ username, setUsername, stats, notice, busy, onSolo, onCreate, onTournament, onJoin }: Props) {
  const [code, setCode] = useState('');
  const { install } = useInstallPrompt();
  const name = username.trim();
  const ok = name.length >= 1;
  return (
    <div className="screen center-screen">
      <div className="panel lobby">
        <div className="logo">
          <span className="logo-ball">⚽</span>
          <h1>Poker Pitch</h1>
          <p className="muted">Card duels decide every yard. Build a squad, win the hands, score the goals.</p>
        </div>

        {notice && <div className="notice">{notice}</div>}

        <label className="field">
          <span>Your name (also your team name)</span>
          <input
            value={username}
            maxLength={20}
            placeholder="e.g. Red Dragons"
            onChange={(e) => setUsername(e.target.value)}
          />
        </label>

        <div className="lobby-actions">
          <button className="btn primary big" disabled={!ok || busy} onClick={onSolo}>
            Play vs AI
          </button>
          <button className="btn big" disabled={!ok || busy} onClick={onCreate}>
            Create room
          </button>
          <button className="btn big" disabled={!ok || busy} onClick={onTournament} title="Knockout tournament for 2–16 players">
            Create tournament
          </button>
          <div className="join-row">
            <input
              value={code}
              maxLength={6}
              placeholder="Room code"
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
              onKeyDown={(e) => e.key === 'Enter' && ok && code.length >= 4 && onJoin(code)}
            />
            <button className="btn big" disabled={!ok || busy || code.length < 4} onClick={() => onJoin(code)}>
              Join room
            </button>
          </div>
        </div>

        {install && (
          <button className="btn install" onClick={() => void install()}>
            Install app
          </button>
        )}
        <StatsTable stats={stats} title="Your record (this browser only)" />
        <div className="muted footnote">
          Online play uses peer-to-peer WebRTC; some strict networks may block the connection. Game data v{dbVersionHash}
        </div>
      </div>
    </div>
  );
}
