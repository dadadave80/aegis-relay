"use client";

import { useCallback, useState, type KeyboardEvent } from "react";

/**
 * <Sealed> — the redaction primitive (Aegis Relay Design System). Three states:
 *  (a) sealed — seal-deep bar at 35% with a slow UV shimmer + lock glyph
 *  (b) peek — press-and-hold (or focus + Enter) reveals plaintext locally, with
 *      the teaching line "decrypted on this device — never on-chain"
 *  (c) lens — under the Ledger Lens: hard black bar, no shimmer, no peek.
 * Optional `commitment` renders the value's on-chain shadow in chain cyan.
 */

const barBase = {
  display: "inline-flex" as const,
  alignItems: "center" as const,
  gap: 6,
  minHeight: 22,
  padding: "2px 8px",
  borderRadius: "var(--r-control)",
  border: "none",
  font: "inherit",
  verticalAlign: "middle" as const,
};

function LockGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="5" y="10" width="14" height="10" rx="2" stroke="var(--seal)" strokeWidth="2.5" />
      <path d="M8 10V7a4 4 0 1 1 8 0v3" stroke="var(--seal)" strokeWidth="2.5" />
    </svg>
  );
}

function Shadow({ commitment }: { commitment: string }) {
  const short =
    commitment.length > 14 ? `${commitment.slice(0, 4)}…${commitment.slice(-4)}` : commitment;
  return (
    <span className="mono" style={{ display: "block", marginTop: 3, fontSize: "var(--text-xs)", color: "var(--chain)" }}>
      C_S {short}
    </span>
  );
}

export function Sealed({
  value,
  label,
  commitment,
  lens = false,
  width = "12ch",
}: {
  value: string;
  label?: string;
  commitment?: string;
  lens?: boolean;
  width?: string;
}) {
  const [peek, setPeek] = useState(false);
  const show = useCallback(() => setPeek(true), []);
  const hide = useCallback(() => setPeek(false), []);
  const onKey = useCallback((e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setPeek((p) => !p);
    }
  }, []);

  if (lens) {
    return (
      <span style={{ display: "inline-block" }}>
        <span
          aria-label="sealed value — the chain cannot read this"
          style={{ ...barBase, minWidth: width, background: "#000", cursor: "default" }}
        />
        {commitment && <Shadow commitment={commitment} />}
      </span>
    );
  }

  return (
    <span style={{ display: "inline-block" }}>
      {peek ? (
        <span style={{ display: "inline-block" }}>
          <button
            type="button"
            onMouseUp={hide}
            onMouseLeave={hide}
            onTouchEnd={hide}
            onKeyDown={onKey}
            onBlur={hide}
            aria-label="revealed value, release to seal"
            className="mono"
            style={{
              ...barBase,
              minWidth: width,
              cursor: "pointer",
              background: "linear-gradient(var(--panel-warm), var(--panel-warm)), var(--void-1)",
              border: "1px solid var(--hairline)",
              color: "var(--ink)",
              fontSize: "var(--text-sm)",
            }}
          >
            {value}
          </button>
          <span
            className="honesty"
            style={{ display: "block", marginTop: 4, color: "var(--ink-dim)" }}
          >
            decrypted on this device — never on-chain
          </span>
        </span>
      ) : (
        <button
          type="button"
          onMouseDown={show}
          onTouchStart={show}
          onKeyDown={onKey}
          aria-label={`sealed value${label ? ` — ${label}` : ""}, press Enter to reveal locally`}
          style={{
            ...barBase,
            minWidth: width,
            cursor: "pointer",
            background:
              "linear-gradient(100deg, rgba(74,61,189,0.35) 40%, rgba(139,124,255,0.5) 50%, rgba(74,61,189,0.35) 60%)",
            backgroundSize: "200% 100%",
            animation: "aegis-shimmer var(--dur-shimmer) linear infinite",
          }}
        >
          <LockGlyph />
        </button>
      )}
      {commitment && <Shadow commitment={commitment} />}
    </span>
  );
}
