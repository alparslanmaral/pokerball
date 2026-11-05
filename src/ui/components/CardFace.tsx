import { SUIT_GLYPH, parseCard, rankLabel } from '../../engine';

interface Props {
  id?: string;
  faceDown?: boolean;
  selected?: boolean;
  dimmed?: boolean;
  scoring?: boolean;
  small?: boolean;
  onClick?: () => void;
  style?: React.CSSProperties;
  className?: string;
}

export function CardFace({ id, faceDown, selected, dimmed, scoring, small, onClick, style, className }: Props) {
  const cls = ['pcard', small ? 'small' : '', selected ? 'selected' : '', dimmed ? 'dimmed' : '', scoring ? 'scoring' : '', faceDown ? 'back' : '', onClick ? 'clickable' : '', className ?? '']
    .filter(Boolean)
    .join(' ');
  if (faceDown || !id) return <div className={cls} style={style} />;
  const c = parseCard(id);
  const red = c.suit === 'H' || c.suit === 'D';
  return (
    <div className={cls + (red ? ' red' : '')} onClick={onClick} style={style} role={onClick ? 'button' : undefined} aria-pressed={selected}>
      <span className="corner">
        {rankLabel(c.rank)}
        <br />
        {SUIT_GLYPH[c.suit]}
      </span>
      <span className="pip">{SUIT_GLYPH[c.suit]}</span>
    </div>
  );
}
