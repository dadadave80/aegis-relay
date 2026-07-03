"use client";

import { useEffect, useRef, useState } from "react";
import { Stamp } from "./Stamp";
import { ChainDatum } from "./ChainDatum";

/**
 * <ProofCeremony> — the one theatrical moment (Aegis Relay Design System). A
 * 900ms four-beat sequence bound to REAL pipeline states, never simulated:
 * WITNESS (dots gather) → CONSTRAINTS (hairline grid flashes) → PAIRING (two
 * arcs meet) → VERIFIED (seal flips to --verified, one glow pulse, tx ticks in).
 * Failure branches at any beat to --danger with the exact failing check named.
 */

const BEATS = ["WITNESS", "CONSTRAINTS", "PAIRING", "VERIFIED"];
const BEAT_MS = 225;

export interface CeremonyFail {
  /** Beat index (0-3) at which the proof was rejected. */
  beat: number;
  /** The exact failing check, named verbatim (e.g. "waypoint 7 outside corridor"). */
  check: string;
}

export function ProofCeremony({
  playing = false,
  fail = null,
  tx,
  txHref,
  onDone,
  size = 150,
}: {
  playing?: boolean;
  fail?: CeremonyFail | null;
  tx?: string;
  txHref?: string;
  onDone?: () => void;
  size?: number;
}) {
  const [beat, setBeat] = useState(-1); // -1 idle, 0..3 beats, 4 done
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Animation driver bound to the `playing` prop — the canonical effect use
  // (drive an external timeline from a prop), opted out of the set-state-in-effect
  // heuristic exactly as lib/session-context.tsx does for its hydration effects.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!playing) {
      setBeat(-1);
      return;
    }
    const reduced =
      typeof window !== "undefined" && window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      setBeat(fail ? fail.beat : 4);
      onDone?.();
      return;
    }
    setBeat(0);
    let b = 0;
    timer.current = setInterval(() => {
      b += 1;
      if (fail && b >= fail.beat) {
        setBeat(fail.beat);
        if (timer.current) clearInterval(timer.current);
        onDone?.();
        return;
      }
      if (b >= 4) {
        setBeat(4);
        if (timer.current) clearInterval(timer.current);
        onDone?.();
        return;
      }
      setBeat(b);
    }, BEAT_MS);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, fail]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const failed = !!fail && beat === fail.beat && playing;
  const verified = beat === 4 && !failed;
  const c = size / 2;
  const ringColor = failed ? "var(--danger)" : verified ? "var(--verified)" : "var(--seal)";

  const dots = Array.from({ length: 16 }, (_, i) => {
    const a = (i / 16) * Math.PI * 2;
    const rOut = c - 8;
    const rIn = 10;
    const r = beat >= 0 ? rIn : rOut;
    return { x: c + Math.cos(a) * r, y: c + Math.sin(a) * r };
  });

  return (
    <div style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={failed ? `proof rejected — ${fail?.check}` : verified ? "proof verified" : "proof ceremony"}
        style={{
          borderRadius: "50%",
          boxShadow: verified ? "var(--glow-verified)" : failed ? "0 0 24px rgba(255,92,92,0.25)" : "none",
          transition: "box-shadow 300ms var(--ease-structural)",
        }}
      >
        <circle cx={c} cy={c} r={c - 2} fill="var(--void-1)" stroke="var(--hairline)" strokeWidth="1" />

        {beat >= 1 && beat < 4 && !failed && (
          <g stroke="var(--hairline)" strokeWidth="1" opacity={beat === 1 ? 0.9 : 0.25}>
            {[-2, -1, 0, 1, 2].map((k) => (
              <line key={`v${k}`} x1={c + k * 18} y1={14} x2={c + k * 18} y2={size - 14} />
            ))}
            {[-2, -1, 0, 1, 2].map((k) => (
              <line key={`h${k}`} x1={14} y1={c + k * 18} x2={size - 14} y2={c + k * 18} />
            ))}
          </g>
        )}

        {beat >= 2 && !failed && (
          <g fill="none" stroke={ringColor} strokeWidth="2" strokeLinecap="round">
            <path d={`M ${c - 34} ${c + 22} A 40 40 0 0 1 ${c} ${c - 40}`} />
            <path d={`M ${c + 34} ${c + 22} A 40 40 0 0 0 ${c} ${c - 40}`} />
          </g>
        )}

        {beat < 3 && !failed &&
          dots.map((d, i) => (
            <circle
              key={i}
              cx={d.x}
              cy={d.y}
              r="2.4"
              fill={beat >= 0 ? "var(--seal)" : "var(--ink-dim)"}
              style={{ transition: `cx ${BEAT_MS}ms var(--ease-structural), cy ${BEAT_MS}ms var(--ease-structural)` }}
            />
          ))}

        {(beat >= 3 || failed) && (
          <g>
            <circle cx={c} cy={c} r="26" fill="var(--void-0)" stroke={ringColor} strokeWidth="2" />
            <text x={c} y={c + 7} textAnchor="middle" fontSize="22" fontFamily="var(--font-mono)" fill={ringColor}>
              {failed ? "✗" : verified ? "✓" : "◈"}
            </text>
          </g>
        )}
      </svg>

      <div style={{ display: "flex", gap: 12 }}>
        {BEATS.map((b, i) => {
          const isFailBeat = !!fail && fail.beat === i && failed;
          const on = beat >= i && (!fail || beat < fail.beat || i < fail.beat) && !isFailBeat;
          return (
            <Stamp
              key={b}
              tone={isFailBeat ? "danger" : i === 3 && verified ? "verified" : on ? "seal" : "dim"}
              style={{ opacity: on || isFailBeat || (i === 3 && verified) ? 1 : 0.4 }}
            >
              {isFailBeat ? "REJECTED" : b}
            </Stamp>
          );
        })}
      </div>

      {failed && (
        <p className="mono" style={{ margin: 0, fontSize: "var(--text-xs)", color: "var(--danger)" }}>
          Proof rejected — {fail?.check}. The escrow is untouched.
        </p>
      )}
      {verified && tx && <ChainDatum label="Verified in tx" value={tx} href={txHref} />}
    </div>
  );
}
