import { Stamp } from "./Stamp";

/**
 * <VisibilityMatrix> — the disclosure ledger (Aegis Relay Design System). One row
 * per fact, four columns: You · Counterparty · Chain · Regulator. Cells: ✓
 * (plaintext), ◈ (commitment only), ∅ (nothing). Per-shipment accurate — the
 * confidential rail flips the Escrow-amount Chain cell from ✓ to ◈ and Regulator
 * stays ✓.
 */
type CellKind = "v" | "c" | "n";
type ColKey = "you" | "cp" | "chain" | "reg";
export type MatrixRow = { fact: string } & Record<ColKey, CellKind>;

const DEFAULT_ROWS = (confidential: boolean, drone: boolean): MatrixRow[] => [
  { fact: "Contents & SKU", you: "v", cp: "v", chain: "c", reg: "n" },
  { fact: "Qty · weight · value", you: "v", cp: "v", chain: "c", reg: "n" },
  { fact: "Recipient identity", you: "v", cp: "c", chain: "c", reg: "n" },
  { fact: "Destination", you: "v", cp: "c", chain: "c", reg: "n" },
  ...(drone ? ([{ fact: "Route flown", you: "n", cp: "v", chain: "c", reg: "n" }] as MatrixRow[]) : []),
  { fact: "Escrow amount", you: "v", cp: "v", chain: confidential ? "c" : "v", reg: "v" },
  { fact: "Custody chain", you: "c", cp: "v", chain: "c", reg: "n" },
];

function Cell({ kind }: { kind: CellKind }) {
  if (kind === "v") return <span className="mono" style={{ color: "var(--ink)" }} aria-label="visible">✓</span>;
  if (kind === "c")
    return (
      <span className="mono" style={{ color: "var(--seal)" }} aria-label="commitment only" title="commitment only — an opaque hash">◈</span>
    );
  return <span className="mono" style={{ color: "rgba(169,166,155,0.4)" }} aria-label="never learns">∅</span>;
}

export function VisibilityMatrix({
  rows,
  confidential = false,
  drone = true,
  hideYou = false,
}: {
  rows?: MatrixRow[];
  confidential?: boolean;
  drone?: boolean;
  hideYou?: boolean;
}) {
  const data = rows || DEFAULT_ROWS(confidential, drone);
  const cols: [ColKey, string][] = hideYou
    ? [["cp", "Counterparty"], ["chain", "Chain"], ["reg", "Regulator"]]
    : [["you", "You"], ["cp", "Counterparty"], ["chain", "Chain"], ["reg", "Regulator"]];

  return (
    <div style={{ background: "var(--void-1)", border: "1px solid var(--hairline)", borderRadius: "var(--r-panel)", overflow: "hidden" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--text-sm)" }}>
        <thead>
          <tr>
            <th style={{ textAlign: "left", padding: "10px 14px", borderBottom: "1px solid var(--hairline)" }}>
              <Stamp>Fact</Stamp>
            </th>
            {cols.map(([k, l]) => (
              <th key={k} style={{ textAlign: "center", padding: "10px 10px", borderBottom: "1px solid var(--hairline)" }}>
                <Stamp tone={k === "chain" ? "chain" : "dim"}>{l}</Stamp>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((r, i) => (
            <tr key={r.fact}>
              <td style={{ padding: "9px 14px", color: "var(--ink)", borderBottom: i < data.length - 1 ? "1px solid var(--hairline)" : "none" }}>
                {r.fact}
              </td>
              {cols.map(([k]) => (
                <td key={k} style={{ textAlign: "center", padding: "9px 10px", borderBottom: i < data.length - 1 ? "1px solid var(--hairline)" : "none" }}>
                  <Cell kind={r[k]} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mono" style={{ display: "flex", gap: 18, padding: "8px 14px", borderTop: "1px solid var(--hairline)", fontSize: "var(--text-xs)", color: "var(--ink-dim)" }}>
        <span>✓ plaintext</span>
        <span style={{ color: "var(--seal)" }}>◈ commitment only</span>
        <span style={{ opacity: 0.6 }}>∅ never learns</span>
      </div>
    </div>
  );
}
