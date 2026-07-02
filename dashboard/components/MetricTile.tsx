const TONE: Record<string, string> = { default: "var(--text)", mint: "var(--mint)", amber: "var(--amber)", red: "var(--red)" };

export default function MetricTile({ label, value, sub, tone = "default" }: {
  label: string; value: string; sub?: string; tone?: "default" | "mint" | "amber" | "red";
}) {
  return (
    <div className="card p-5">
      <p className="text-xs uppercase tracking-wider mb-2" style={{ color: "var(--text-faint)" }}>{label}</p>
      <p className="mono text-2xl font-semibold break-all" style={{ color: TONE[tone] }}>{value}</p>
      {sub && <p className="text-xs mt-1" style={{ color: "var(--text-faint)" }}>{sub}</p>}
    </div>
  );
}
