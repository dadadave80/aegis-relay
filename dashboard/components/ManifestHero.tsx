"use client";

/**
 * Overview hero — the live self-redacting manifest (Aegis Relay Design System,
 * ui_kits/overview). A realistic waybill types itself in ivory, then seals
 * field-by-field: UV shimmer bars sweep in and each field's shadow-commitment
 * ticks into the cold cyan column, resolving to the single line the chain keeps.
 * ~4s, skippable, static end-frame under reduced motion. The Lens link re-renders
 * the panel exactly as the chain sees it.
 */

import { useEffect, useMemo, useState } from "react";

const FIELDS = [
  { label: "SKU", value: "MS-204 · Medical supplies", c: "C_1 84f2…09da" },
  { label: "Declared value", value: "1,000 XLM", c: "C_2 3b7c…e441" },
  { label: "Recipient", value: "A. Okafor", c: "C_3 c09d…772f" },
  { label: "Address", value: "14 Adeniran Ogunsanya St, Surulere", c: "C_4 5512…8ab3" },
  { label: "Route", value: "lane 7 · 16 waypoints", c: "C_5 f9e0…1c26" },
];

const CHAIN_LINE = "C_S 2081536494…181308 · flight_ok · DELIVERED";

function useReducedMotion() {
  return useMemo(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    [],
  );
}

export default function ManifestHero() {
  const reduced = useReducedMotion();
  // phase: 0 typing, 1..5 sealing field n, 6 done. Starts at 0 (SSR + first
  // client render agree — fields shown unsealed), then the effect drives it.
  const [phase, setPhase] = useState(0);
  const [lens, setLens] = useState(false);

  useEffect(() => {
    if (phase >= 6) return;
    // Reduced motion: jump straight to the static end-frame (in a timeout so
    // this isn't a synchronous setState in the effect body).
    const delay = reduced ? 0 : phase === 0 ? 1400 : 520;
    const next = reduced ? 6 : phase + 1;
    const t = setTimeout(() => setPhase(next), delay);
    return () => clearTimeout(t);
  }, [phase, reduced]);

  const done = phase >= 6;

  return (
    <div style={{ position: "relative", maxWidth: 720, margin: "0 auto" }}>
      <div
        className={lens ? "panel-cold" : "panel-warm"}
        style={{ padding: 20, transition: "background var(--dur-lens) ease-out" }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 14 }}>
          <span className="stamp" style={{ color: lens ? "var(--chain-dim)" : "var(--ink-dim)" }}>
            {lens ? "As the chain sees it" : "Waybill · shipment #2"}
          </span>
          {!done && !lens && (
            <button
              onClick={() => setPhase(6)}
              className="mono"
              style={{ background: "none", border: "none", cursor: "pointer", fontSize: "var(--text-xs)", color: "var(--ink-dim)", textDecoration: "underline", padding: 0 }}
            >
              skip
            </button>
          )}
        </div>

        {lens ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <p className="mono" style={{ margin: 0, fontSize: "var(--text-md)", color: "var(--chain)" }}>
              {CHAIN_LINE}
            </p>
            <p className="mono" style={{ margin: 0, fontSize: "var(--text-xs)", color: "var(--chain-dim)" }}>
              this is everything — the chain holds only its shadow
            </p>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 3fr) minmax(0, 2fr)", gap: "8px 20px" }}>
            {FIELDS.map((f, i) => {
              const sealed = phase > i;
              return (
                <div key={f.label} style={{ display: "contents" }}>
                  <div style={{ minWidth: 0 }}>
                    <span className="stamp" style={{ color: "var(--ink-dim)" }}>{f.label}</span>
                    <div style={{ marginTop: 2, minHeight: 22 }}>
                      {sealed ? (
                        <span
                          aria-hidden
                          style={{
                            display: "inline-block",
                            width: "90%",
                            height: 18,
                            borderRadius: "var(--r-control)",
                            background:
                              "linear-gradient(100deg, rgba(74,61,189,0.35) 40%, rgba(139,124,255,0.5) 50%, rgba(74,61,189,0.35) 60%)",
                            backgroundSize: "200% 100%",
                            animation: "aegis-shimmer var(--dur-shimmer) linear infinite",
                          }}
                        />
                      ) : (
                        <span style={{ fontSize: "var(--text-sm)", color: "var(--ink)" }}>{f.value}</span>
                      )}
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "flex-end", minWidth: 0 }}>
                    <span
                      className="mono"
                      style={{
                        fontSize: "var(--text-xs)",
                        color: "var(--chain)",
                        opacity: sealed ? 1 : 0,
                        transition: "opacity var(--dur-structural) var(--ease-structural)",
                      }}
                    >
                      {f.c}
                    </span>
                  </div>
                </div>
              );
            })}
            {done && (
              <p
                className="mono"
                style={{
                  gridColumn: "1 / -1",
                  margin: "10px 0 0",
                  paddingTop: 12,
                  borderTop: "1px solid var(--hairline)",
                  fontSize: "var(--text-sm)",
                  color: "var(--chain)",
                }}
              >
                {CHAIN_LINE}
              </p>
            )}
          </div>
        )}
      </div>

      <div style={{ textAlign: "center", marginTop: 12 }}>
        <button
          onClick={() => setLens((v) => !v)}
          className="mono"
          style={{ background: "none", border: "none", cursor: "pointer", fontSize: "var(--text-xs)", color: "var(--seal)", textDecoration: "underline", padding: 0 }}
        >
          {lens ? "back to your view" : "see this page as the chain does"}
        </button>
      </div>
    </div>
  );
}
