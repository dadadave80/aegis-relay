import { Stamp } from "./Stamp";
import { ChainDatum } from "./ChainDatum";

/**
 * <StatusRail> — lifecycle as a vertical instrument rail (Aegis Relay Design
 * System). Hairline spine; stations OPEN → IN TRANSIT → (FLIGHT VERIFIED) →
 * DELIVERED, EXPIRED as a red branch. Each station: STAMP label, one human
 * sentence, on-chain evidence as a ChainDatum once real. Active node pulses.
 */
export type StationStatus = "done" | "active" | "pending" | "failed";

export interface RailStation {
  label: string;
  status: StationStatus;
  detail?: string;
  tx?: string;
  txHref?: string;
  flag?: { ok: boolean };
}

const NODE: Record<StationStatus, { color: string; glyph: string }> = {
  done: { color: "var(--verified)", glyph: "✓" },
  active: { color: "var(--ink)", glyph: "▸" },
  pending: { color: "rgba(169,166,155,0.45)", glyph: "○" },
  failed: { color: "var(--danger)", glyph: "✗" },
};

export function StatusRail({ stations, horizontal = false }: { stations: RailStation[]; horizontal?: boolean }) {
  return (
    <ol
      style={{
        listStyle: "none",
        margin: 0,
        padding: 0,
        display: "flex",
        flexDirection: horizontal ? "row" : "column",
        gap: horizontal ? 16 : 0,
      }}
    >
      {stations.map((s, i) => {
        const n = NODE[s.status];
        return (
          <li key={s.label} style={{ display: "flex", gap: 14, flex: horizontal ? 1 : undefined }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
              <span
                aria-hidden
                className="mono"
                style={{
                  width: 26,
                  height: 26,
                  flexShrink: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: "50%",
                  fontSize: "var(--text-xs)",
                  color: n.color,
                  border: `1px solid ${n.color}`,
                  background: "var(--void-0)",
                  animation: s.status === "active" ? "aegis-pulse 2s ease-in-out infinite" : "none",
                }}
              >
                {n.glyph}
              </span>
              {!horizontal && i < stations.length - 1 && (
                <span style={{ width: 1, flex: 1, margin: "4px 0", background: "var(--hairline)" }} />
              )}
            </div>
            <div style={{ paddingBottom: horizontal ? 0 : 22, minWidth: 0 }}>
              <Stamp tone={s.status === "done" ? "verified" : s.status === "failed" ? "danger" : s.status === "active" ? "ink" : "dim"}>
                {s.label}
              </Stamp>
              {s.detail && (
                <p style={{ margin: "4px 0 0", fontSize: "var(--text-sm)", color: "var(--ink-dim)", lineHeight: "var(--lh-body)" }}>
                  {s.detail}
                </p>
              )}
              {s.tx && (
                <div style={{ marginTop: 6 }}>
                  <ChainDatum value={s.tx} href={s.txHref} />
                </div>
              )}
              {s.flag && (
                <div style={{ marginTop: 6 }}>
                  <FlightFlag ok={s.flag.ok} />
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** Instrument flag: FLIGHT_OK — false → true. The only trace of the flight. */
export function FlightFlag({ ok }: { ok: boolean }) {
  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: 2 }}>
      <span
        className="mono"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          padding: "3px 10px",
          border: `1px solid ${ok ? "var(--verified)" : "var(--hairline)"}`,
          borderRadius: "var(--r-control)",
          fontSize: "var(--text-xs)",
          color: ok ? "var(--verified)" : "var(--chain-dim)",
          background: "var(--void-0)",
          whiteSpace: "nowrap",
        }}
      >
        FLIGHT_OK {ok ? <span style={{ opacity: 0.6 }}>false →</span> : null} {String(ok)}
      </span>
      <span className="honesty" style={{ color: "var(--ink-dim)" }}>the only trace of the entire flight</span>
    </span>
  );
}
