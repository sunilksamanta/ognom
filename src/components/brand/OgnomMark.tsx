/**
 * The Ognom mark: an O split into two arcs in orbit, tilted 12 degrees around
 * a single node. Always paints with currentColor - in-app that is
 * `var(--accent)`. `outline` is the watermark variant for empty panes.
 */
export function OgnomMark({
  className,
  outline = false,
  style,
}: {
  className?: string;
  outline?: boolean;
  style?: React.CSSProperties;
}) {
  return (
    <svg viewBox="0 0 120 120" className={className} style={style} aria-hidden>
      <g transform="rotate(-12 60 60)">
        <path d="M14.7 52A46 46 0 0 1 105.3 52L89.5 54.8A30 30 0 0 0 30.5 54.8Z" fill="currentColor" />
        {outline ? (
          <path
            d="M105.3 68A46 46 0 0 1 14.7 68L30.5 65.2A30 30 0 0 0 89.5 65.2Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
          />
        ) : (
          <path
            d="M105.3 68A46 46 0 0 1 14.7 68L30.5 65.2A30 30 0 0 0 89.5 65.2Z"
            fill="currentColor"
            opacity=".5"
          />
        )}
      </g>
      <circle cx="60" cy="60" r="7" fill="currentColor" />
    </svg>
  );
}

/** Gradient app-icon tile - only for the OS icon / about screen. */
export function OgnomTile({ size = 64 }: { size?: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.26),
        background: "linear-gradient(150deg,#12E96A,#00A24C 62%,#00684A)",
        boxShadow: "0 18px 40px -18px rgba(0,180,90,.55), inset 0 1px 0 rgba(255,255,255,.35)",
        display: "grid",
        placeItems: "center",
        color: "#04180D",
        flex: "none",
      }}
    >
      <OgnomMark style={{ width: size * 0.55, height: size * 0.55 }} />
    </div>
  );
}
