// Aegis Relay brand mark — a double-outline shield with a hub-and-spoke node
// network (privacy shield over a settlement graph). Inline SVG so it stays crisp
// at any size and inherits no external assets. Brand colors are fixed by intent.
const SHIELD = "M48 9 L80 19 Q83 20 83 23 L83 47 Q83 70 48 89 Q13 70 13 47 L13 23 Q13 20 16 19 Z";

// 8 outer nodes at radius 25 around the hub (center 48,48), every 45°.
const NODES: [number, number][] = [
  [48, 23], [65.7, 30.3], [73, 48], [65.7, 65.7],
  [48, 73], [30.3, 65.7], [23, 48], [30.3, 30.3],
];

const CYAN = "#1CA9F2";
const LIGHT = "#F1F8FF";

export default function Mark({ size = 26, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 96 96"
      fill="none"
      className={className}
      role="img"
      aria-label="Aegis Relay"
    >
      {/* double-outline shield: cyan outer, light inner */}
      <path d={SHIELD} stroke={CYAN} strokeWidth={3.4} strokeLinejoin="round" />
      <path
        d={SHIELD}
        stroke={LIGHT}
        strokeWidth={2}
        strokeLinejoin="round"
        transform="translate(48 48) scale(0.85) translate(-48 -48)"
      />
      {/* spokes */}
      <g stroke={CYAN} strokeWidth={2} strokeLinecap="round">
        {NODES.map(([x, y], i) => (
          <line key={i} x1={48} y1={48} x2={x} y2={y} />
        ))}
      </g>
      {/* outer nodes */}
      {NODES.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={4.6} fill={CYAN} stroke={LIGHT} strokeWidth={1.5} />
      ))}
      {/* central hub: light ring + cyan core */}
      <circle cx={48} cy={48} r={10} fill="none" stroke={LIGHT} strokeWidth={2.4} />
      <circle cx={48} cy={48} r={5.4} fill={CYAN} />
    </svg>
  );
}
