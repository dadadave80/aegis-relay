import type { Metadata } from "next";
import Hash from "@/components/Hash";
import MetricTile from "@/components/MetricTile";
import { AIRSPACE_ID, explorer } from "@/lib/contract";
import { corridorFixture, originCell, routeWaypoints } from "@/lib/fixtures";
import { RC_RES, bounds, decodeCell, latQToDeg, lonQToDeg, projector } from "@/lib/geo";

export const metadata: Metadata = {
  title: "Corridor — Aegis Relay",
  description: "The public corridor cover vs the private flight route.",
};

// Static page: fixture data only, no RPC — this page always works.

const W = 880;
const H = 560;

export default function MapPage() {
  // Decode the r=15 Morton cells of the lane-7 cover into lat/lon boxes.
  const cells = corridorFixture.cells.map((c) => decodeCell(c, RC_RES));
  const route = routeWaypoints.map((w) => ({
    lat: latQToDeg(w.latQ),
    lon: lonQToDeg(w.lonQ),
    t: w.t,
    altDm: w.altDm,
  }));
  const b = bounds(cells, route);
  const { x, y } = projector(b, W, H);

  const path = route.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.lon).toFixed(1)},${y(p.lat).toFixed(1)}`).join(" ");
  const origin = decodeCell(originCell, RC_RES);
  const last = route[route.length - 1];
  const flightSecs = last.t - route[0].t;

  return (
    <div className="max-w-5xl mx-auto px-6 py-14">
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight">Corridor transparency — lane {corridorFixture.laneId}</h1>
        <p className="mt-2 text-sm max-w-2xl leading-relaxed" style={{ color: "var(--text-dim)" }}>
          The airspace authority publishes the corridor as a Merkle root of Morton geocells —
          coarse, public, and the same for every flight on the lane. The route below is the
          carrier&apos;s private witness from the committed demo fixture: the flight proof shows every
          waypoint lands in a corridor cell <em>without the route ever leaving the prover</em>.
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        <MetricTile label="Corridor cells" value={String(corridorFixture.cells.length)} sub={`resolution r=${RC_RES} · ≈611 m × 1.22 km`} />
        <MetricTile label="Tree depth" value="12" sub="PAD-filled Poseidon tree" />
        <MetricTile label="Waypoints proven" value={String(route.length)} sub={`${flightSecs}s of flight · alt ${route[0].altDm / 10} m`} tone="mint" />
        <MetricTile label="On-chain footprint" value="1 root" sub="plus a flight_ok flag — nothing else" tone="mint" />
      </div>

      <div className="card overflow-hidden mb-6">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto block" role="img"
          aria-label="Corridor cell grid with the private flight route overlaid">
          {/* Public corridor cover: the only geometry the chain ever anchors */}
          {cells.map((c) => (
            <rect
              key={c.cell}
              x={x(c.lonMin)}
              y={y(c.latMax)}
              width={x(c.lonMax) - x(c.lonMin)}
              height={y(c.latMin) - y(c.latMax)}
              fill="color-mix(in srgb, #4EF0B5 7%, transparent)"
              stroke="color-mix(in srgb, #4EF0B5 30%, transparent)"
              strokeWidth="1"
            />
          ))}

          {/* Origin cell (public inside C_S opening, shown for orientation) */}
          <rect
            x={x(origin.lonMin)}
            y={y(origin.latMax)}
            width={x(origin.lonMax) - x(origin.lonMin)}
            height={y(origin.latMin) - y(origin.latMax)}
            fill="none"
            stroke="#F5B84E"
            strokeWidth="1.5"
            strokeDasharray="4 3"
          />

          {/* PRIVATE: the true fixture route — exists only in the carrier's witness */}
          <path d={path} fill="none" stroke="#4EF0B5" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
          {route.map((p, i) => (
            <circle key={i} cx={x(p.lon)} cy={y(p.lat)} r={i === 0 || i === route.length - 1 ? 5 : 3}
              fill={i === 0 || i === route.length - 1 ? "#4EF0B5" : "#0A0B0D"}
              stroke="#4EF0B5" strokeWidth="1.5" />
          ))}

          {/* Watermark over the private layer */}
          <g transform={`rotate(-24 ${W / 2} ${H / 2})`} opacity="0.85" pointerEvents="none">
            {[-1, 0, 1].map((row) => (
              <text
                key={row}
                x={W / 2}
                y={H / 2 + row * 150}
                textAnchor="middle"
                fill="rgba(245,247,250,0.16)"
                fontSize="34"
                fontWeight="700"
                letterSpacing="6"
                style={{ fontFamily: "var(--font-mono, monospace)" }}
              >
                VISIBLE ONLY TO YOU — NEVER ON-CHAIN
              </text>
            ))}
          </g>

          {/* Labels */}
          <text x={x(route[0].lon) + 10} y={y(route[0].lat) + 4} fill="#A0A8B4" fontSize="12"
            style={{ fontFamily: "var(--font-mono, monospace)" }}>t₀ origin</text>
          <text x={x(last.lon) - 10} y={y(last.lat) - 10} fill="#A0A8B4" fontSize="12" textAnchor="end"
            style={{ fontFamily: "var(--font-mono, monospace)" }}>t₁₅ dest region</text>
        </svg>
      </div>

      {/* Legend + root */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 text-xs mb-8" style={{ color: "var(--text-dim)" }}>
        <span className="inline-flex items-center gap-2">
          <span className="inline-block w-3.5 h-3.5 rounded-sm" style={{ background: "color-mix(in srgb, var(--mint) 10%, transparent)", border: "1px solid color-mix(in srgb, var(--mint) 40%, transparent)" }} />
          public corridor cell (r={RC_RES} Morton)
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="inline-block w-6 h-0.5 rounded" style={{ background: "var(--mint)" }} />
          private flight route (witness only)
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="inline-block w-3.5 h-3.5 rounded-sm" style={{ border: "1.5px dashed var(--amber)" }} />
          committed origin cell
        </span>
        <span className="inline-flex items-center gap-2">
          corridor root <Hash value={corridorFixture.root} href={explorer(AIRSPACE_ID)} />
        </span>
      </div>

      <div className="card p-5 text-sm leading-relaxed" style={{ color: "var(--text-dim)" }}>
        <p>
          <span className="font-semibold" style={{ color: "var(--text)" }}>What the public sees:</span>{" "}
          this cell grid and one Poseidon root published per lane by the airspace authority
          (contract <span className="mono">{AIRSPACE_ID.slice(0, 6)}…{AIRSPACE_ID.slice(-6)}</span>).
          Lane geometry is public by regulatory design — it is the same interception-proof
          coarseness for every parcel that ever flies the lane.
        </p>
        <p className="mt-3">
          <span className="font-semibold" style={{ color: "var(--text)" }}>What only the carrier holds:</span>{" "}
          the 16-waypoint telemetry log drawn above. It exists exclusively in the prover&apos;s witness;
          the Groth16 flight proof convinces the registry that every waypoint is inside the corridor,
          time-monotonic, gap-free, and speed-plausible — and the chain records a single{" "}
          <span className="mono">flight_ok = true</span>.
        </p>
      </div>
    </div>
  );
}
