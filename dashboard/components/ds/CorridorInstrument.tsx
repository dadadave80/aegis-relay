import { Stamp } from "./Stamp";
import { ChainDatum } from "./ChainDatum";
import { LANE7, RC_RES, decodeCell, latQToDeg, lonQToDeg, geoBounds, projector } from "./lane7";

/**
 * <CorridorInstrument> — the corridor map instrument (Aegis Relay Design System).
 * Renders the public lane-7 corridor cover (cold cyan cells, PUBLIC BY DESIGN)
 * and, when `live`, the carrier's private route in ivory INSIDE the cells,
 * watermarked "VISIBLE ONLY TO YOU — NEVER ON-CHAIN". Under the Ledger Lens it
 * collapses to corridor root + dest-region root + cell count. A 1px baseline
 * grid is visible only inside this instrument.
 */
export function CorridorInstrument({
  live = false,
  lens = false,
  height = 320,
}: {
  live?: boolean;
  lens?: boolean;
  height?: number;
}) {
  const W = 640;
  const H = height;
  const cells = LANE7.cells.map((c) => decodeCell(c, RC_RES));
  const route = LANE7.waypoints.map((w) => ({ lat: latQToDeg(w.latQ), lon: lonQToDeg(w.lonQ) }));
  const b = geoBounds(cells, route);
  const { x, y } = projector(b, W, H);
  const path = route.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.lon).toFixed(1)},${y(p.lat).toFixed(1)}`).join(" ");

  if (lens) {
    return (
      <div
        style={{
          background: "linear-gradient(var(--panel-cold), var(--panel-cold)), var(--void-1)",
          border: "1px solid var(--hairline)",
          borderRadius: "var(--r-panel)",
          padding: "24px 20px",
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        <Stamp tone="chain">Corridor · lane {LANE7.laneId}</Stamp>
        <ChainDatum label="Corridor root" value={LANE7.root} />
        <ChainDatum label="Dest-region root" value={LANE7.destRegionRoot} />
        <span className="mono" style={{ fontSize: "var(--text-sm)", color: "var(--chain)" }}>{LANE7.cells.length} public cells</span>
        <span className="mono" style={{ fontSize: "var(--text-xs)", color: "var(--chain-dim)" }}>this is all the chain knows of the map</span>
      </div>
    );
  }

  return (
    <div style={{ background: "var(--void-1)", border: "1px solid var(--hairline)", borderRadius: "var(--r-panel)", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", borderBottom: "1px solid var(--hairline)" }}>
        <span style={{ display: "inline-flex", gap: 12, alignItems: "baseline" }}>
          <Stamp tone="chain">Corridor · lane {LANE7.laneId}</Stamp>
          <Stamp tone="chain" style={{ opacity: 0.7 }}>Public by design</Stamp>
        </span>
        <span className="mono" style={{ fontSize: "var(--text-xs)", color: live ? "var(--ink)" : "var(--chain-dim)" }}>
          {live ? "16 telemetry points → 1 proof" : `${LANE7.cells.length} public cells`}
        </span>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} style={{ display: "block", width: "100%", height: "auto" }} role="img" aria-label="Corridor cover with the flight route overlaid">
        <g stroke="var(--hairline)" strokeWidth="0.5" opacity="0.5">
          {Array.from({ length: 12 }, (_, i) => (
            <line key={`g${i}`} x1={(i + 1) * (W / 13)} y1="0" x2={(i + 1) * (W / 13)} y2={H} />
          ))}
          {Array.from({ length: 7 }, (_, i) => (
            <line key={`h${i}`} x1="0" y1={(i + 1) * (H / 8)} x2={W} y2={(i + 1) * (H / 8)} />
          ))}
        </g>

        {cells.map((c) => (
          <rect
            key={c.cell}
            x={x(c.lonMin)}
            y={y(c.latMax)}
            width={x(c.lonMax) - x(c.lonMin)}
            height={y(c.latMin) - y(c.latMax)}
            fill="rgba(125,223,242,0.06)"
            stroke="rgba(125,223,242,0.28)"
            strokeWidth="1"
          />
        ))}

        <path
          d={path}
          fill="none"
          stroke={live ? "var(--ink)" : "var(--ink-dim)"}
          strokeWidth={live ? 2.5 : 1.5}
          strokeDasharray={live ? undefined : "5 4"}
          strokeOpacity={live ? 1 : 0.35}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {live &&
          route.map((p, i) => (
            <circle
              key={i}
              cx={x(p.lon)}
              cy={y(p.lat)}
              r={i === 0 || i === route.length - 1 ? 4.5 : 2.8}
              fill={i === 0 || i === route.length - 1 ? "var(--ink)" : "var(--void-0)"}
              stroke="var(--ink)"
              strokeWidth="1.5"
            />
          ))}

        {live && (
          <g transform={`rotate(-22 ${W / 2} ${H / 2})`} opacity="0.9" pointerEvents="none">
            {[-1, 0, 1].map((row) => (
              <text
                key={row}
                x={W / 2}
                y={H / 2 + row * 100}
                textAnchor="middle"
                fill="rgba(233,228,216,0.12)"
                fontSize="24"
                fontWeight="700"
                letterSpacing="4"
                fontFamily="var(--font-mono)"
              >
                VISIBLE ONLY TO YOU — NEVER ON-CHAIN
              </text>
            ))}
          </g>
        )}
      </svg>

      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "9px 14px", borderTop: "1px solid var(--hairline)", fontSize: "var(--text-xs)", color: "var(--ink-dim)" }}>
        <span>
          {live ? "Live route — the chain records only flight_ok = true" : "Public corridor cover — fly the drone to overlay the live route"}
        </span>
        <span className="mono" style={{ color: "var(--chain-dim)" }}>r15 · ~611 m cells</span>
      </div>
    </div>
  );
}
