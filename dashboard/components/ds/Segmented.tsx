"use client";

import type { ReactNode } from "react";

/**
 * Segmented control (Aegis Relay Design System). Instrument-style, sharp radius,
 * seal active state. Used for method (Courier / Drone), the privacy dial, and
 * the rail picker.
 */
export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  glyph?: ReactNode;
  caption?: ReactNode;
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  size = "md",
  tone = "seal",
}: {
  value: T;
  options: SegmentedOption<T>[];
  onChange?: (v: T) => void;
  size?: "sm" | "md";
  tone?: "seal" | "chain";
}) {
  const pad = size === "sm" ? "6px 12px" : "9px 14px";
  const activeStyle =
    tone === "chain"
      ? { background: "rgba(125,223,242,0.12)", color: "var(--chain)", border: "1px solid rgba(125,223,242,0.4)" }
      : { background: "rgba(139,124,255,0.16)", color: "var(--seal)", border: "1px solid rgba(139,124,255,0.5)" };
  return (
    <div
      role="tablist"
      style={{
        display: "inline-flex",
        gap: 4,
        padding: 4,
        background: "var(--void-0)",
        border: "1px solid var(--hairline)",
        borderRadius: "var(--r-panel)",
      }}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            role="tab"
            aria-selected={active}
            onClick={() => onChange?.(o.value)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: pad,
              minHeight: size === "sm" ? 32 : 38,
              borderRadius: "var(--r-control)",
              fontFamily: "var(--font-body)",
              fontSize: size === "sm" ? "var(--text-xs)" : "var(--text-sm)",
              fontWeight: 500,
              cursor: "pointer",
              transition:
                "background var(--dur-micro) var(--ease-micro), color var(--dur-micro) var(--ease-micro)",
              ...(active
                ? activeStyle
                : { background: "transparent", color: "var(--ink-dim)", border: "1px solid transparent" }),
            }}
          >
            {o.glyph && <span aria-hidden>{o.glyph}</span>}
            {o.label}
            {o.caption && (
              <span style={{ fontSize: "var(--text-xs)", color: active ? "inherit" : "var(--ink-dim)", opacity: 0.8 }}>
                {o.caption}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
