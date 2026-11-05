export interface Stats {
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
}

const KEY = 'pokerpitch.stats.v1';
const EMPTY: Stats = { played: 0, wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0 };

export function loadStats(): Stats {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...EMPTY, ...JSON.parse(raw) } : { ...EMPTY };
  } catch {
    return { ...EMPTY };
  }
}

/** Record a finished match (never call for matches ended by a disconnect). */
export function recordMatch(goalsFor: number, goalsAgainst: number): Stats {
  const s = loadStats();
  s.played++;
  s.goalsFor += goalsFor;
  s.goalsAgainst += goalsAgainst;
  if (goalsFor > goalsAgainst) s.wins++;
  else if (goalsFor < goalsAgainst) s.losses++;
  else s.draws++;
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable: stats are best-effort */
  }
  return s;
}

const NAME_KEY = 'pokerpitch.username';
export function loadUsername(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}
export function saveUsername(name: string): void {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    /* ignore */
  }
}
