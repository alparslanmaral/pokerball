import { type ReactNode, useEffect, useRef } from 'react';
import { other } from '../../engine';
import type { ClientView, DuelReveal, GameContext, Intent, ShotReveal, Side, Zone } from '../../engine';
import { CardFace } from '../components/CardFace';
import { CardsIcon, ScoreIcon, ShieldIcon, SpadeIcon, Stat, UserIcon, ChipIcon, MultIcon } from '../components/Icons';
import { useCountUp, useSteps } from '../hooks';

interface Props {
  view: ClientView;
  ctx: GameContext;
  send: (i: Intent) => void;
}

const DUEL_STEPS = [450, 1250, 2000, 2800, 3600];
const SHOT_STEPS = [700, 1700];
const AUTO_CONTINUE_DUEL = 5200;
const AUTO_CONTINUE_SHOT = 3600;

export function RevealOverlay({ view, ctx, send }: Props) {
  const reveal = view.reveal;
  const sent = useRef<number | null>(null);
  const id = reveal?.id ?? -1;
  const done = () => {
    if (sent.current === id || view.meContinued) return;
    sent.current = id;
    send({ type: 'continue' });
  };

  // Auto-continue after the animation; the player can also skip.
  useEffect(() => {
    if (!reveal) return;
    const t = setTimeout(done, reveal.kind === 'duel' ? AUTO_CONTINUE_DUEL : AUTO_CONTINUE_SHOT);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (!reveal) return null;
  return (
    <div className="reveal-backdrop">
      <div className="reveal">
        {reveal.kind === 'duel' ? (
          <DuelReveal r={reveal} view={view} ctx={ctx} />
        ) : (
          <ShotRevealView r={reveal} view={view} />
        )}
        <div className="reveal-foot">
          {view.meContinued ? (
            <span className="muted">Waiting for {view.names[other(view.me)]}…</span>
          ) : (
            <button className="btn" onClick={done}>
              Skip ▸▸
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(Math.round(n)) : n.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

const SOURCE_ICON: Record<string, ReactNode> = {
  hand: <SpadeIcon />,
  cards: <CardsIcon />,
  keeper: <ShieldIcon />,
  trait: <UserIcon />,
};
const SOURCE_TITLE: Record<string, string> = { hand: 'Hand', cards: 'Scoring cards', keeper: 'Keeper', trait: 'Player trait' };

function DuelReveal({ r, view, ctx }: { r: DuelReveal; view: ClientView; ctx: GameContext }) {
  const step = useSteps(DUEL_STEPS, r.id);
  const me = view.me;
  const sides: Side[] = [me, other(me)];
  const winnerText =
    r.winner === 'tie'
      ? "It's a tie! The duel is replayed."
      : r.winner === me
        ? `${view.names[me]} wins the duel!`
        : `${view.names[r.winner]} wins the duel!`;
  const outcomeText =
    r.winner === 'tie'
      ? ''
      : r.outcome === 'shot'
        ? r.winner === me
          ? 'Penalty chance!'
          : 'They get a shot!'
        : r.winner === me
          ? 'You push forward ▸'
          : '◂ They push forward';

  return (
    <>
      <h3 className="reveal-title">Showdown</h3>
      <div className="reveal-cols">
        {sides.map((side) => {
          const h = r.hands[side];
          const res = h.result;
          return (
            <ResultColumn
              key={side}
              name={view.names[side]}
              mine={side === me}
              auto={h.auto}
              cards={h.cards}
              result={res}
              step={step}
              ctx={ctx}
              won={r.winner === side}
              lost={r.winner !== 'tie' && r.winner !== side}
            />
          );
        })}
      </div>
      <div className={`reveal-banner ${step >= 5 ? 'show' : ''} ${r.winner === me ? 'good' : r.winner === 'tie' ? '' : 'bad'}`}>
        <strong>{winnerText}</strong> {outcomeText}
      </div>
    </>
  );
}

function ResultColumn({
  name,
  mine,
  auto,
  cards,
  result,
  step,
  ctx,
  won,
  lost,
}: {
  name: string;
  mine: boolean;
  auto: boolean;
  cards: string[];
  result: DuelReveal['hands'][Side]['result'];
  step: number;
  ctx: GameContext;
  won: boolean;
  lost: boolean;
}) {
  const chips = useCountUp(result.chips, step >= 2);
  const mult = useCountUp(result.mult, step >= 3);
  const score = useCountUp(result.score, step >= 4, 600);
  return (
    <div className={`reveal-col ${mine ? 'mine' : ''} ${step >= 5 && won ? 'won' : ''} ${step >= 5 && lost ? 'lost' : ''}`}>
      <div className="reveal-name">
        {name} {mine && <span className="muted">(you)</span>}
      </div>
      <div className="reveal-cards">
        {cards.map((c, i) => (
          <CardFace
            key={c}
            id={c}
            small
            scoring={step >= 1 && result.scoring.includes(c)}
            dimmed={step >= 1 && !result.scoring.includes(c)}
            style={{ animationDelay: `${i * 90}ms` }}
          />
        ))}
      </div>
      <div className={`reveal-hand ${step >= 1 ? 'show' : ''}`}>
        {ctx.balance.hands[result.hand].label}
        {auto && <span className="auto-tag"> · auto-played (time ran out)</span>}
      </div>
      <div className="reveal-calc">
        <Stat kind="chips" value={step >= 2 ? fmt(chips) : '–'} className={step >= 2 ? 'pop' : 'idle'} />
        <span className="op">×</span>
        <Stat kind="mult" value={step >= 3 ? fmt(mult) : '–'} className={step >= 3 ? 'pop' : 'idle'} />
      </div>
      <div className={`reveal-score ${step >= 4 ? 'show' : ''}`}>
        <ScoreIcon />
        <span>{step >= 4 ? fmt(score) : ''}</span>
      </div>
      <ul className={`reveal-breakdown ${step >= 2 ? 'show' : ''}`}>
        {result.breakdown.map((b, i) => (
          <li key={i} title={SOURCE_TITLE[b.source]}>
            <span className="src">{SOURCE_ICON[b.source]}</span>
            <span className="vals">
              {b.chips !== 0 && (
                <span className="v chips">
                  <ChipIcon />+{fmt(b.chips)}
                </span>
              )}
              {b.mult !== 0 && (
                <span className="v mult">
                  <MultIcon />+{fmt(b.mult)}
                </span>
              )}
              {b.xmult !== 1 && (
                <span className="v mult">
                  <MultIcon />×{fmt(b.xmult)}
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const ZONE_X: Record<Zone, number> = { left: 17, center: 50, right: 83 };

function ShotRevealView({ r, view }: { r: ShotReveal; view: ClientView }) {
  const step = useSteps(SHOT_STEPS, r.id);
  const me = view.me;
  const keeperSide = other(r.shooter);
  const iShot = r.shooter === me;
  const shooterName = view.names[r.shooter];
  return (
    <>
      <h3 className="reveal-title">
        {r.penalty ? 'Penalty · ' : ''}
        {iShot ? 'Your shot' : `${shooterName}'s shot`}
      </h3>
      <div className="shot-stage">
        <div className="shot-goal">
          {step >= 1 && (
            <>
              <div className="shot-ball" style={{ left: `${ZONE_X[r.picks[r.shooter]]}%` }}>
                ⚽
              </div>
              <div className="shot-keeper" style={{ left: `${ZONE_X[r.picks[keeperSide]]}%` }}>
                🧤
              </div>
            </>
          )}
          {step < 1 && <div className="shot-wait">Shooter and keeper are choosing…</div>}
        </div>
        <div className="shot-labels">
          <span>Left</span>
          <span>Center</span>
          <span>Right</span>
        </div>
      </div>
      <div className={`reveal-banner big ${step >= 2 ? 'show' : ''} ${r.goal === iShot ? 'good' : 'bad'}`}>
        <strong>{r.goal ? 'GOAL!' : 'SAVED!'}</strong>{' '}
        {r.goal ? `${shooterName} scores.` : `${view.names[keeperSide]} guessed right.`}
      </div>
    </>
  );
}
