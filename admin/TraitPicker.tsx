import { HAND_IDS, defaultTraitFor, describeTrait } from '../src/engine';
import type { Balance, HandId, KeeperBonus, ParamDef, Position, Trait, TraitTemplate } from '../src/engine';

interface Props {
  trait: Trait;
  position: Position;
  catalog: TraitTemplate[];
  balance: Balance;
  onChange: (t: Trait) => void;
}

/** Picks a trait template (enabled + allowed for the position) and edits its parameters within the catalog bounds. */
export function TraitPicker({ trait, position, catalog, balance, onChange }: Props) {
  const current = catalog.find((t) => t.id === trait.type);
  const options = catalog.filter((t) => t.allowedPositions.includes(position) && (t.enabled || t.id === trait.type));
  return (
    <div className="trait-picker">
      <label className="field">
        <span>Trait template</span>
        <select
          value={trait.type}
          onChange={(e) => {
            const tpl = catalog.find((t) => t.id === e.target.value)!;
            onChange(defaultTraitFor(tpl));
          }}
        >
          {!current && <option value={trait.type}>{trait.type} (unknown)</option>}
          {options.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
              {t.enabled ? '' : ' (disabled)'}
            </option>
          ))}
        </select>
      </label>
      {current && (
        <>
          {Object.entries(current.params).map(([key, def]) => (
            <ParamInput
              key={key}
              name={key}
              def={def}
              value={trait.params[key]}
              balance={balance}
              onChange={(v) => onChange({ type: trait.type, params: { ...trait.params, [key]: v } })}
            />
          ))}
          <div className="auto-desc">
            <span className="muted">In-game text:</span> {describeTrait(trait, catalog, balance)}
          </div>
        </>
      )}
    </div>
  );
}

function ParamInput({
  name,
  def,
  value,
  balance,
  onChange,
}: {
  name: string;
  def: ParamDef;
  value: any;
  balance: Balance;
  onChange: (v: any) => void;
}) {
  if (def.type === 'number') {
    const v = typeof value === 'number' ? value : def.default;
    const clamp = (n: number) => Math.max(def.min, Math.min(def.max, n));
    return (
      <label className="field">
        <span>
          {name} <em className="muted">(allowed {def.min}–{def.max}, step {def.step})</em>
        </span>
        <div className="num-row">
          <input type="range" min={def.min} max={def.max} step={def.step} value={v} onChange={(e) => onChange(Number(e.target.value))} />
          <input
            type="number"
            min={def.min}
            max={def.max}
            step={def.step}
            value={v}
            onChange={(e) => onChange(Number(e.target.value))}
            onBlur={(e) => onChange(clamp(Number(e.target.value)))}
          />
        </div>
      </label>
    );
  }
  if (def.type === 'enum') {
    return (
      <label className="field">
        <span>{name}</span>
        <select value={value} onChange={(e) => onChange(e.target.value)}>
          {def.options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      </label>
    );
  }
  if (def.type === 'hands') {
    const sel = (value as HandId[]) ?? [];
    return (
      <div className="field">
        <span>
          {name} <em className="muted">(choose {def.minCount}–{def.maxCount})</em>
        </span>
        <div className="check-grid">
          {HAND_IDS.map((h) => {
            const on = sel.includes(h);
            return (
              <label key={h} className={`check ${on ? 'on' : ''}`}>
                <input
                  type="checkbox"
                  checked={on}
                  disabled={!on && sel.length >= def.maxCount}
                  onChange={() => onChange(on ? sel.filter((x) => x !== h) : [...sel, h])}
                />
                {balance.hands[h].label}
              </label>
            );
          })}
        </div>
      </div>
    );
  }
  // keeper bonuses: `count` distinct hands, each with chips and mult within per-hand bounds
  const rows = (value as KeeperBonus[]) ?? [];
  const setRow = (i: number, patch: Partial<KeeperBonus>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <div className="field">
      <span>
        {name} <em className="muted">({def.count} distinct hand types; rare hands allow bigger bonuses)</em>
      </span>
      {rows.map((r, i) => {
        const b = def.bounds[r.hand];
        const taken = rows.filter((_, j) => j !== i).map((x) => x.hand);
        return (
          <div key={i} className="bonus-row">
            <select
              value={r.hand}
              onChange={(e) => {
                const hand = e.target.value as HandId;
                const nb = def.bounds[hand];
                setRow(i, {
                  hand,
                  chips: Math.max(nb.chips.min, Math.min(nb.chips.max, r.chips)),
                  mult: Math.max(nb.mult.min, Math.min(nb.mult.max, r.mult)),
                });
              }}
            >
              {HAND_IDS.map((h) => (
                <option key={h} value={h} disabled={taken.includes(h)}>
                  {balance.hands[h].label}
                </option>
              ))}
            </select>
            <label>
              +chips
              <input type="number" min={b.chips.min} max={b.chips.max} step={5} value={r.chips} onChange={(e) => setRow(i, { chips: Number(e.target.value) })} />
              <em className="muted">{b.chips.min}–{b.chips.max}</em>
            </label>
            <label>
              +mult
              <input type="number" min={b.mult.min} max={b.mult.max} step={1} value={r.mult} onChange={(e) => setRow(i, { mult: Number(e.target.value) })} />
              <em className="muted">{b.mult.min}–{b.mult.max}</em>
            </label>
          </div>
        );
      })}
    </div>
  );
}
