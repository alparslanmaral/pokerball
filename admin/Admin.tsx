import { useEffect, useMemo, useRef, useState } from 'react';
import { POSITIONS, defaultTraitFor, suggestPrice, traitLabel, validateDb } from '../src/engine';
import type { Balance, GameContext, Player, Position, TraitTemplate } from '../src/engine';
import { PlayerEditor } from './PlayerEditor';
import { TraitCatalog } from './TraitCatalog';
import { deleteImage, loadData, saveData, uploadImage } from './api';
import { measurePower } from './usePower';

type Tab = 'players' | 'traits';
type SortKey = 'position' | 'name' | 'priceAsc' | 'priceDesc' | 'power';

const json = (v: unknown) => JSON.stringify(v);

export function Admin() {
  const [loaded, setLoaded] = useState<{ players: Player[]; traits: TraitTemplate[]; balance: Balance; images: string[] } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [catalog, setCatalog] = useState<TraitTemplate[]>([]);
  const [tab, setTab] = useState<Tab>('players');
  const [selected, setSelected] = useState<string | null>(null);
  const [pendingImages, setPendingImages] = useState<Record<string, { blob: Blob; url: string }>>({});
  const [removedImages, setRemovedImages] = useState<string[]>([]);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const baseline = useRef('');

  // filters
  const [search, setSearch] = useState('');
  const [posFilter, setPosFilter] = useState<Position | 'all'>('all');
  const [traitFilter, setTraitFilter] = useState('all');
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [sort, setSort] = useState<SortKey>('position');
  const [powers, setPowers] = useState<Record<string, number>>({});

  useEffect(() => {
    loadData()
      .then((d) => {
        setLoaded(d);
        setPlayers(d.players);
        setCatalog(d.traits);
        baseline.current = json({ p: d.players, t: d.traits });
        setSelected(d.players[0]?.id ?? null);
      })
      .catch((e: Error) => setLoadError(e.message));
  }, []);

  const balance = loaded?.balance ?? null;
  const ctx: GameContext | null = useMemo(
    () => (balance ? { balance, catalog, players: Object.fromEntries(players.map((p) => [p.id, p])) } : null),
    [balance, catalog, players],
  );
  const report = useMemo(() => (ctx ? validateDb(ctx, players) : { errors: [], warnings: [] }), [ctx, players]);
  const originalIds = useMemo(() => new Set(loaded?.players.map((p) => p.id) ?? []), [loaded]);
  const dirty = json({ p: players, t: catalog }) !== baseline.current || Object.keys(pendingImages).length > 0 || removedImages.length > 0;

  // Background power measurement for the list (cheap sample size, cached per trait).
  useEffect(() => {
    if (!balance) return;
    let cancelled = false;
    (async () => {
      for (const p of players) {
        if (cancelled) return;
        const r = await measurePower(balance, catalog, p.trait, p.position, 500);
        if (cancelled) return;
        setPowers((prev) => (prev[p.id] === r.power ? prev : { ...prev, [p.id]: r.power }));
      }
    })();
    return () => {
      cancelled = true;
    };
    // re-run when any trait/position changes (cache makes unchanged players free)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [balance, catalog, json(players.map((p) => [p.id, p.position, p.trait]))]);

  if (loadError)
    return (
      <div className="admin-shell">
        <div className="notice">
          Could not reach the admin API: {loadError}. The editor only works with <code>npm run dev</code> on localhost.
        </div>
      </div>
    );
  if (!loaded || !ctx || !balance) return <div className="admin-shell">Loading…</div>;

  const errorsById = new Map<string, string[]>();
  for (const e of report.errors) errorsById.set(e.playerId, [...(errorsById.get(e.playerId) ?? []), e.message]);

  const visible = players
    .filter((p) => {
      const q = search.trim().toLowerCase();
      if (q && !`${p.id} ${p.firstName} ${p.lastName} ${traitLabel(p.trait, catalog)} ${p.trait.type}`.toLowerCase().includes(q)) return false;
      if (posFilter !== 'all' && p.position !== posFilter) return false;
      if (traitFilter !== 'all' && p.trait.type !== traitFilter) return false;
      if (minPrice !== '' && p.price < Number(minPrice)) return false;
      if (maxPrice !== '' && p.price > Number(maxPrice)) return false;
      return true;
    })
    .sort((a, b) => {
      switch (sort) {
        case 'name':
          return `${a.lastName}${a.firstName}`.localeCompare(`${b.lastName}${b.firstName}`);
        case 'priceAsc':
          return a.price - b.price;
        case 'priceDesc':
          return b.price - a.price;
        case 'power':
          return (powers[b.id] ?? 0) - (powers[a.id] ?? 0);
        default:
          return POSITIONS.indexOf(a.position) - POSITIONS.indexOf(b.position) || a.id.localeCompare(b.id);
      }
    });

  const current = players.find((p) => p.id === selected) ?? null;

  const nextId = (pos: Position, taken: Set<string>) => {
    let n = 1;
    while (taken.has(`${pos.toLowerCase()}-${String(n).padStart(3, '0')}`)) n++;
    return `${pos.toLowerCase()}-${String(n).padStart(3, '0')}`;
  };

  const addPlayer = (base?: Player) => {
    const taken = new Set(players.map((p) => p.id));
    const position = base?.position ?? (posFilter === 'all' ? 'MID' : posFilter);
    const tpl = catalog.find((t) => t.enabled && t.allowedPositions.includes(position));
    const fresh: Player = base
      ? { ...structuredClone(base), id: nextId(base.position, taken), lastName: base.lastName, image: undefined }
      : {
          id: nextId(position, taken),
          firstName: '',
          lastName: '',
          position,
          price: balance.priceBands[0].max,
          trait: tpl ? defaultTraitFor(tpl) : { type: '', params: {} },
        };
    if (fresh.image === undefined) delete fresh.image;
    setPlayers([...players, fresh]);
    setSelected(fresh.id);
    setTab('players');
  };

  const removePlayer = (id: string) => {
    const p = players.find((x) => x.id === id);
    if (!p || !confirm(`Delete ${p.firstName} ${p.lastName} (${id})?`)) return;
    setPlayers(players.filter((x) => x.id !== id));
    if (originalIds.has(id) && loaded.images.includes(`${id}.webp`)) setRemovedImages((r) => [...r, id]);
    dropPending(id);
    if (selected === id) setSelected(null);
  };

  const dropPending = (id: string) =>
    setPendingImages((prev) => {
      if (!prev[id]) return prev;
      URL.revokeObjectURL(prev[id].url);
      const { [id]: _gone, ...rest } = prev;
      return rest;
    });

  const updatePlayer = (id: string, p: Player) => {
    // id can change only while the player is new (not on disk); keep pending image + selection in sync
    if (id !== p.id) {
      setPendingImages((prev) => {
        if (!prev[id]) return prev;
        const { [id]: moved, ...rest } = prev;
        return { ...rest, [p.id]: moved };
      });
      setSelected(p.id);
      if (p.image) p = { ...p, image: `players/${p.id}.webp` };
    }
    setPlayers(players.map((x) => (x.id === id ? p : x)));
  };

  const setImage = (p: Player, blob: Blob | null) => {
    if (blob) {
      dropPending(p.id);
      setPendingImages((prev) => ({ ...prev, [p.id]: { blob, url: URL.createObjectURL(blob) } }));
      updatePlayer(p.id, { ...p, image: `players/${p.id}.webp` });
      setRemovedImages((r) => r.filter((x) => x !== p.id));
    } else {
      dropPending(p.id);
      const { image: _img, ...rest } = p;
      updatePlayer(p.id, rest);
      if (originalIds.has(p.id) && loaded.images.includes(`${p.id}.webp`)) setRemovedImages((r) => [...new Set([...r, p.id])]);
    }
  };

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const res = await saveData(players, catalog);
      for (const [id, img] of Object.entries(pendingImages)) await uploadImage(id, img.blob);
      for (const id of removedImages) await deleteImage(id);
      const fresh = await loadData();
      setLoaded(fresh);
      setPlayers(fresh.players);
      setCatalog(fresh.traits);
      baseline.current = json({ p: fresh.players, t: fresh.traits });
      Object.values(pendingImages).forEach((i) => URL.revokeObjectURL(i.url));
      setPendingImages({});
      setRemovedImages([]);
      setMessage({
        kind: 'ok',
        text: `Saved ${fresh.players.length} players${res.warnings.length ? ` (${res.warnings.length} warning(s))` : ''}.`,
      });
    } catch (e) {
      setMessage({ kind: 'error', text: (e as Error).message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="admin-shell">
      <header className="admin-top">
        <h1>Poker Pitch · Admin</h1>
        <span className="muted">dev only — edits src/data/*.json and public/players/</span>
        <nav className="admin-tabs">
          <button className={`btn ${tab === 'players' ? 'primary' : ''}`} onClick={() => setTab('players')}>
            Players ({players.length})
          </button>
          <button className={`btn ${tab === 'traits' ? 'primary' : ''}`} onClick={() => setTab('traits')}>
            Trait catalog
          </button>
        </nav>
        <div className="save-area">
          {dirty && <span className="dirty">● unsaved changes</span>}
          <button className="btn primary" disabled={!dirty || report.errors.length > 0 || saving} onClick={save}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </header>

      {report.errors.length > 0 && (
        <div className="notice">
          <strong>{report.errors.length} error(s) block saving:</strong>
          <ul>
            {report.errors.slice(0, 8).map((e, i) => (
              <li key={i}>
                <a href="#" onClick={(ev) => (ev.preventDefault(), setTab('players'), setSelected(e.playerId))}>
                  {e.playerId}
                </a>
                : {e.message}
              </li>
            ))}
            {report.errors.length > 8 && <li>…and {report.errors.length - 8} more</li>}
          </ul>
        </div>
      )}

      {message && (
        <div className={`notice ${message.kind === 'ok' ? 'ok' : ''}`}>
          <div style={{ whiteSpace: 'pre-wrap' }}>{message.text}</div>
          {message.kind === 'ok' && (
            <div className="git-reminder">
              Now publish the changes yourself (the editor never runs git):
              <pre>{`git add src/data/players.json src/data/traits.json public/players
git commit -m "Update player database"
git push`}</pre>
              The GitHub Pages workflow redeploys on push to <code>main</code>.
            </div>
          )}
        </div>
      )}

      {report.warnings.length > 0 && (
        <details className="warnbox" open={report.warnings.length < 6}>
          <summary>{report.warnings.length} warning(s) — market feasibility (never block saving)</summary>
          <ul>
            {report.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </details>
      )}

      {tab === 'traits' ? (
        <TraitCatalog catalog={catalog} players={players} balance={balance} onChange={setCatalog} />
      ) : (
        <div className="admin-main">
          <aside className="player-list">
            <div className="filters">
              <input placeholder="Search name, id, trait…" value={search} onChange={(e) => setSearch(e.target.value)} />
              <div className="grid3">
                <select value={posFilter} onChange={(e) => setPosFilter(e.target.value as Position | 'all')}>
                  <option value="all">All positions</option>
                  {POSITIONS.map((p) => (
                    <option key={p}>{p}</option>
                  ))}
                </select>
                <select value={traitFilter} onChange={(e) => setTraitFilter(e.target.value)}>
                  <option value="all">All traits</option>
                  {catalog.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </select>
                <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
                  <option value="position">Sort: position</option>
                  <option value="name">Sort: name</option>
                  <option value="priceAsc">Sort: price ↑</option>
                  <option value="priceDesc">Sort: price ↓</option>
                  <option value="power">Sort: power ↓</option>
                </select>
              </div>
              <div className="grid2">
                <input type="number" placeholder="Min $" value={minPrice} onChange={(e) => setMinPrice(e.target.value)} />
                <input type="number" placeholder="Max $" value={maxPrice} onChange={(e) => setMaxPrice(e.target.value)} />
              </div>
              <button className="btn primary" onClick={() => addPlayer()}>
                + New player
              </button>
            </div>
            <ul>
              {visible.map((p) => {
                const sug = powers[p.id] !== undefined ? suggestPrice(balance, powers[p.id]) : null;
                const errs = errorsById.get(p.id);
                return (
                  <li key={p.id} className={`row ${p.id === selected ? 'active' : ''} ${errs ? 'has-error' : ''}`} onClick={() => setSelected(p.id)}>
                    <span className={`pos-pill pos-${p.position}`}>{p.position}</span>
                    <span className="row-name">
                      {p.firstName || '—'} <strong>{p.lastName || '—'}</strong>
                      <small>{traitLabel(p.trait, catalog)}</small>
                    </span>
                    <span className="row-price">
                      ${p.price}
                      {sug !== null && Math.abs(sug - p.price) >= 10 && <small className="off" title={`Suggested $${sug}`}>{p.price > sug ? '▲' : '▼'} ${sug}</small>}
                    </span>
                    <span className="row-actions">
                      <button className="btn tiny" title="Duplicate" onClick={(e) => (e.stopPropagation(), addPlayer(p))}>
                        ⧉
                      </button>
                      <button className="btn tiny" title="Delete" onClick={(e) => (e.stopPropagation(), removePlayer(p.id))}>
                        🗑
                      </button>
                    </span>
                  </li>
                );
              })}
              {visible.length === 0 && <li className="muted pad">No players match.</li>}
            </ul>
          </aside>
          <main>
            {current ? (
              <PlayerEditor
                key={current.id}
                player={current}
                ctx={ctx}
                balance={balance}
                isNew={!originalIds.has(current.id)}
                pendingUrl={pendingImages[current.id]?.url}
                onChange={(p) => updatePlayer(current.id, p)}
                onImage={(b) => setImage(current, b)}
              />
            ) : (
              <p className="muted pad">Select a player or create a new one.</p>
            )}
          </main>
        </div>
      )}
    </div>
  );
}
