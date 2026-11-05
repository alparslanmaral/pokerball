import type { ReactNode } from 'react';

interface IconProps {
  size?: string | number;
  className?: string;
  title?: string;
}

function Svg({ size = '1em', className, title, children }: IconProps & { children: ReactNode }) {
  return (
    <svg
      className={`icon ${className ?? ''}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role="img"
      aria-label={title}
      focusable="false"
    >
      {title && <title>{title}</title>}
      {children}
    </svg>
  );
}

/** Poker chip: blue disc with a dashed rim. Stands for "chips". */
export const ChipIcon = (p: IconProps) => (
  <Svg title="chips" {...p}>
    <circle cx="12" cy="12" r="10.5" fill="#3b82f6" />
    <circle cx="12" cy="12" r="8.6" fill="none" stroke="#fff" strokeWidth="2.4" strokeDasharray="3.6 3.1" opacity=".95" />
    <circle cx="12" cy="12" r="5.2" fill="#1e4fb8" stroke="#a9ccff" strokeWidth="1" />
  </Svg>
);

/** Red diamond with a bolt. Stands for "mult". */
export const MultIcon = (p: IconProps) => (
  <Svg title="mult" {...p}>
    <rect x="3.6" y="3.6" width="16.8" height="16.8" rx="4.6" transform="rotate(45 12 12)" fill="#ff4d6d" />
    <path d="M13.2 5.2 7.6 13h3.8l-1 5.8L16.4 11h-3.9z" fill="#fff" />
  </Svg>
);

/** Gold star. Stands for the final score. */
export const ScoreIcon = (p: IconProps) => (
  <Svg title="score" {...p}>
    <path
      d="m12 2.4 2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.2l-5.9 3.3 1.3-6.6L2.5 9.3l6.6-.8z"
      fill="#fbbf24"
      stroke="#f59e0b"
      strokeWidth="1"
      strokeLinejoin="round"
    />
  </Svg>
);

export const SpadeIcon = (p: IconProps) => (
  <Svg title="hand" {...p}>
    <path d="M12 2.5c3.6 3.4 7.4 6 7.4 9.7a3.9 3.9 0 0 1-6.6 2.7c.1 1.9.6 3.2 1.9 4.6H9.3c1.3-1.4 1.8-2.7 1.9-4.6a3.9 3.9 0 0 1-6.6-2.7C4.6 8.5 8.4 5.9 12 2.5z" fill="currentColor" />
  </Svg>
);

export const CardsIcon = (p: IconProps) => (
  <Svg title="scoring cards" {...p}>
    <rect x="3" y="5" width="11" height="15" rx="2.2" fill="none" stroke="currentColor" strokeWidth="1.8" />
    <rect x="9.5" y="3" width="11" height="15" rx="2.2" fill="currentColor" opacity=".85" />
  </Svg>
);

export const ShieldIcon = (p: IconProps) => (
  <Svg title="keeper" {...p}>
    <path d="M12 2.8 4.5 5.6v5.8c0 4.4 3 8 7.5 9.8 4.5-1.800 7.500-5.400 7.500-9.800V5.600z" fill="currentColor" />
  </Svg>
);

export const UserIcon = (p: IconProps) => (
  <Svg title="player trait" {...p}>
    <circle cx="12" cy="8" r="4.2" fill="currentColor" />
    <path d="M3.8 21c.6-4.600 4-7 8.200-7s7.600 2.400 8.200 7z" fill="currentColor" />
  </Svg>
);

export const ClockIcon = (p: IconProps) => (
  <Svg title="timer" {...p}>
    <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" />
    <path d="M12 7v5.200l3.400 2" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </Svg>
);

export const DeckIcon = (p: IconProps) => (
  <Svg title="deck" {...p}>
    <rect x="5" y="3" width="14" height="18" rx="2.600" fill="currentColor" opacity=".35" />
    <rect x="4" y="5" width="14" height="16" rx="2.600" fill="currentColor" opacity=".6" />
    <rect x="3" y="7" width="14" height="14" rx="2.600" fill="currentColor" />
  </Svg>
);

export const DiscardIcon = (p: IconProps) => (
  <Svg title="discards" {...p}>
    <path d="M5 7h14M9.500 7V4.500h5V7M7 7l.9 12.500h8.200L17 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

// ---------------------------------------------------------------------------------------------

/** `[chip] 50`, `[bolt] 4`, `[star] 200` style badge. */
export function Stat({
  kind,
  value,
  prefix,
  className,
}: {
  kind: 'chips' | 'mult' | 'score';
  value: ReactNode;
  prefix?: string;
  className?: string;
}) {
  const Icon = kind === 'chips' ? ChipIcon : kind === 'mult' ? MultIcon : ScoreIcon;
  return (
    <span className={`stat ${kind} ${className ?? ''}`}>
      <Icon />
      <b>
        {prefix}
        {value}
      </b>
    </span>
  );
}

/** `[chip] 50 × [bolt] 4` (and optionally `= [star] 200`). */
export function Calc({ chips, mult, score, large }: { chips: ReactNode; mult: ReactNode; score?: ReactNode; large?: boolean }) {
  return (
    <span className={`calc ${large ? 'large' : ''}`}>
      <Stat kind="chips" value={chips} />
      <span className="op">×</span>
      <Stat kind="mult" value={mult} />
      {score !== undefined && (
        <>
          <span className="op">=</span>
          <Stat kind="score" value={score} />
        </>
      )}
    </span>
  );
}

/** Renders text with the words "chips" / "mult" replaced by their icons (used for trait descriptions). */
export function IconText({ text }: { text: string }) {
  const parts = text.split(/\b(chips?|mult)\b/g);
  return (
    <>
      {parts.map((part, i) =>
        part === 'chips' || part === 'chip' ? (
          <ChipIcon key={i} className="inline" />
        ) : part === 'mult' ? (
          <MultIcon key={i} className="inline" />
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}
