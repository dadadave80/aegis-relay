"use client";

/**
 * Compact corridor view for the lifecycle board (drone shipments). Renders the
 * public lane-7 corridor cover from the committed fixtures, and overlays the
 * carrier's *live* honest-flight waypoints once they exist (from api.fly) —
 * watermarked "visible only to you" to make the privacy point. Falls back to a
 * faint sample route before the flight, with a link to the full /map view.
 *
 * Reuses lib/geo (Morton decode + equirectangular projector) and lib/fixtures.
 */

import Link from "next/link";
import type { FlyRes } from "@/lib/types";
import { corridorFixture, routeWaypoints } from "@/lib/fixtures";
import {
  RC_RES,
  bounds,
  decodeCell,
  latQToDeg,
  lonQToDeg,
  projector,
} from "@/lib/geo";

const W = 640;
const H = 380;

export default function CorridorMini({ fly }: { fly: FlyRes | null }) {
  const cells = corridorFixture.cells.map((c) => decodeCell(c, RC_RES));

  const sample = routeWaypoints.map((w) => ({
    lat: latQToDeg(w.latQ),
    lon: lonQToDeg(w.lonQ),
  }));
  const live = fly?.waypoints ?? null;
  const route = live ?? sample;

  const b = bounds(cells, route);
  const { x, y } = projector(b, W, H);
  const path = route
    .map((p, i) => `${i === 0 ? "M" : "L"}${x(p.lon).toFixed(1)},${y(p.lat).toFixed(1)}`)
    .join(" ");

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 border-b hairline">
        <p
          className="text-xs uppercase tracking-wider"
          style={{ color: "var(--text-faint)" }}
        >
          Corridor · lane {corridorFixture.laneId}
        </p>
        <span className="text-xs" style={{ color: "var(--mint)" }}>
          {live
            ? `${live.length} telemetry points → 1 proof`
            : `${cells.length} public cells`}
        </span>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-auto block"
        role="img"
        aria-label="Corridor cover with the flight route overlaid"
      >
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

        {/* route: solid + live, or faint dashed sample */}
        <path
          d={path}
          fill="none"
          stroke="#4EF0B5"
          strokeWidth={live ? 2.5 : 1.5}
          strokeDasharray={live ? undefined : "5 4"}
          strokeOpacity={live ? 1 : 0.4}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {live &&
          route.map((p, i) => (
            <circle
              key={i}
              cx={x(p.lon)}
              cy={y(p.lat)}
              r={i === 0 || i === route.length - 1 ? 5 : 3}
              fill={i === 0 || i === route.length - 1 ? "#4EF0B5" : "#0A0B0D"}
              stroke="#4EF0B5"
              strokeWidth="1.5"
            />
          ))}

        {live && (
          <g
            transform={`rotate(-22 ${W / 2} ${H / 2})`}
            opacity="0.8"
            pointerEvents="none"
          >
            {[-1, 0, 1].map((row) => (
              <text
                key={row}
                x={W / 2}
                y={H / 2 + row * 110}
                textAnchor="middle"
                fill="rgba(245,247,250,0.14)"
                fontSize="26"
                fontWeight="700"
                letterSpacing="4"
                style={{ fontFamily: "var(--font-mono, monospace)" }}
              >
                VISIBLE ONLY TO YOU — NEVER ON-CHAIN
              </text>
            ))}
          </g>
        )}
      </svg>

      <div
        className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2.5 border-t hairline text-xs"
        style={{ color: "var(--text-faint)" }}
      >
        <span>
          {live
            ? "Live route — the chain records only flight_ok = true"
            : "Public corridor cover — fly the drone to overlay the live route"}
        </span>
        <Link
          href="/map"
          className="hover:text-white transition-colors"
          style={{ color: "var(--mint)" }}
        >
          full corridor view →
        </Link>
      </div>
    </div>
  );
}
