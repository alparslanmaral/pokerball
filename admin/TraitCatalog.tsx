import { HAND_IDS } from '../src/engine';
import type { Balance, ParamDef, Player, TraitTemplate } from '../src/engine';

interface Props {
  catalog: TraitTemplate[];
  players: Player[];
  balance: Balance;
  onChange: (c: TraitTemplate[]) => void;
}

/** Enable/disable templates and edit the allowed min/max of each numeric parameter. */
export function TraitCatalog({ catalog, players, balance, onChange }: Props) {
  const update = (id: string, fn: (t: TraitTemplate) => TraitTemplate) => onChange(catalog.map((t) => (t.id === id ? fn(structuredClone(t)) : t)));
  return (
    <div className="catalog">
      <p className="muted">
        Players keep their trait even if you disable its template, but the editor will no longer offer it. Changing a parameter range
        flags every player that falls outside the new range (those errors block saving until fixed).
      </p>
      {catalog.map((t) => {
        const users = players.filter((p) => p.trait.type === t.id).length;
        return (
          <section key={t.id} className={`tpl ${t.enabled ? '' : 'off'}`}>
            <header>
              <label className="check on">
                <input type="checkbox" checked={t.enabled} onChange={(e) => update(t.id, (x) => ({ ...x, enabled: e.target.checked }))} />
                <strong>{t.label}</strong>
              </label>
              <code>{t.id}</code>
              <span className="muted">
                {t.allowedPositions.join(' / ')} · {users} player{users === 1 ? '' : 's'}
              </span>
              <label className="inline">
                price weight ×
                <input
                  type="number"
                  step={0.1}
                  min={0}
                  value={t.powerWeight}
                  onChange={(e) => update(t.id, (x) => ({ ...x, powerWeight: Number(e.target.value) }))}
                />
              </label>
            </header>
            <div className="muted tpl-desc">{t.description}</div>
            <div className="params">
              {Object.entries(t.params).map(([key, def]) => (
                <ParamBounds key={key} name={key} def={def} balance={balance} onChange={(d) => update(t.id, (x) => ({ ...x, params: { ...x.params, [key]: d } }))} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function ParamBounds({ name, def, balance, onChange }: { name: string; def: ParamDef; balance: Balance; onChange: (d: ParamDef) => void }) {
  if (def.type === 'number') {
    const num = (k: 'min' | 'max' | 'default') => (
      <label>
        {k}
        <input type="number" step={def.step} value={def[k]} onChange={(e) => onChange({ ...def, [k]: Number(e.target.value) })} />
      </label>
    );
    return (
      <div className="param">
        <strong>{name}</strong> {num('min')} {num('max')} {num('default')}
        <span className="muted"> step {def.step}</span>
      </div>
    );
  }
  if (def.type === 'enum') {
    return (
      <div className="param">
        <strong>{name}</strong> <span className="muted">options: {def.options.join(', ')}</span>
      </div>
    );
  }
  if (def.type === 'hands') {
    return (
      <div className="param">
        <strong>{name}</strong>
        <label>
          min hands
          <input type="number" min={1} max={9} value={def.minCount} onChange={(e) => onChange({ ...def, minCount: Number(e.target.value) })} />
        </label>
        <label>
          max hands
          <input type="number" min={1} max={9} value={def.maxCount} onChange={(e) => onChange({ ...def, maxCount: Number(e.target.value) })} />
        </label>
      </div>
    );
  }
  return (
    <div className="param bounds">
      <strong>{name}</strong> <span className="muted">per-hand bonus bounds ({def.count} distinct hands). Rare hands should allow more.</span>
      <table>
        <thead>
          <tr>
            <th>Hand</th>
            <th colSpan={2}>chips min / max</th>
            <th colSpan={2}>mult min / max</th>
          </tr>
        </thead>
        <tbody>
          {HAND_IDS.map((h) => {
            const b = def.bounds[h];
            const set = (kind: 'chips' | 'mult', k: 'min' | 'max', v: number) =>
              onChange({ ...def, bounds: { ...def.bounds, [h]: { ...b, [kind]: { ...b[kind], [k]: v } } } });
            return (
              <tr key={h}>
                <td>{balance.hands[h].label}</td>
                <td>
                  <input type="number" value={b.chips.min} onChange={(e) => set('chips', 'min', Number(e.target.value))} />
                </td>
                <td>
                  <input type="number" value={b.chips.max} onChange={(e) => set('chips', 'max', Number(e.target.value))} />
                </td>
                <td>
                  <input type="number" value={b.mult.min} onChange={(e) => set('mult', 'min', Number(e.target.value))} />
                </td>
                <td>
                  <input type="number" value={b.mult.max} onChange={(e) => set('mult', 'max', Number(e.target.value))} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
