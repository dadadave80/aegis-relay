"use client";

import { useState } from "react";
import { Stamp } from "./Stamp";

/**
 * <ChainDatum> — the ONLY way on-chain values render (Aegis Relay Design System).
 * STAMP label in chain-dim + value in IBM Plex Mono chain cyan + copy + optional
 * explorer link. Chain cyan lives exclusively in monospace.
 */
export function ChainDatum({
  label,
  value,
  href,
  sub,
  full = false,
}: {
  label?: string;
  value: string;
  href?: string;
  sub?: string;
  full?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const short = !full && value.length > 18 ? `${value.slice(0, 10)}…${value.slice(-6)}` : value;

  const body = (
    <span
      className="mono"
      style={{
        fontSize: "var(--text-sm)",
        color: "var(--chain)",
        wordBreak: full ? "break-all" : "normal",
        whiteSpace: full ? "normal" : "nowrap",
      }}
    >
      {short}
    </span>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
      {label && <Stamp tone="chain">{label}</Stamp>}
      <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
        {href ? (
          <a href={href} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none" }}>
            {body}
          </a>
        ) : (
          body
        )}
        <button
          type="button"
          onClick={() => {
            if (navigator.clipboard) navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          }}
          aria-label="copy"
          className="mono"
          style={{
            fontSize: "var(--text-xs)",
            color: copied ? "var(--verified)" : "var(--chain-dim)",
            background: "transparent",
            border: "1px solid var(--hairline)",
            borderRadius: "var(--r-control)",
            padding: "1px 6px",
            cursor: "pointer",
          }}
        >
          {copied ? "✓" : "⧉"}
        </button>
        {href && (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="open in explorer"
            className="mono"
            style={{ fontSize: "var(--text-xs)", color: "var(--chain-dim)", textDecoration: "none" }}
          >
            ↗
          </a>
        )}
      </span>
      {sub && <span style={{ fontSize: "var(--text-xs)", color: "var(--ink-dim)" }}>{sub}</span>}
    </div>
  );
}
