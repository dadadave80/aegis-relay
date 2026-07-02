import type { StateName } from "@/lib/contract";

const MAP: Record<StateName, { label: string; color: string; glyph: string; note: string }> = {
  OPEN: {
    label: "OPEN",
    color: "var(--amber)",
    glyph: "○",
    note: "Escrow funded — awaiting a carrier",
  },
  IN_TRANSIT: {
    label: "IN TRANSIT",
    color: "var(--text)",
    glyph: "▸",
    note: "Carrier holds custody — the chain sees only a head hash",
  },
  DELIVERED: {
    label: "DELIVERED",
    color: "var(--mint)",
    glyph: "✓",
    note: "Receipt proven in zero-knowledge — escrow released atomically",
  },
  EXPIRED: {
    label: "EXPIRED",
    color: "var(--red)",
    glyph: "▲",
    note: "Deadline passed — remaining escrow refunded to the merchant",
  },
};

export default function StatusBadge({ state }: { state: StateName }) {
  const s = MAP[state];
  return (
    <div className="text-center">
      <div
        className="inline-flex items-center gap-3 px-7 py-4 rounded-full text-2xl font-bold tracking-wide"
        style={{ color: s.color, background: "color-mix(in srgb, " + s.color + " 12%, transparent)", border: "1px solid color-mix(in srgb, " + s.color + " 40%, transparent)" }}
      >
        <span aria-hidden>{s.glyph}</span>
        <span>{s.label}</span>
      </div>
      <p className="mt-3 text-sm" style={{ color: "var(--text-dim)" }}>{s.note}</p>
    </div>
  );
}
