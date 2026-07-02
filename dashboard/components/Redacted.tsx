/** A locked row in the "what the chain never learns" column. */

function LockGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden className="shrink-0 mt-1">
      <rect x="5" y="10" width="14" height="10" rx="2" stroke="var(--mint)" strokeWidth="2" />
      <path d="M8 10V7a4 4 0 1 1 8 0v3" stroke="var(--mint)" strokeWidth="2" />
    </svg>
  );
}

export default function Redacted({ label, note }: { label: string; note: string }) {
  return (
    <li className="flex items-start gap-3 py-2.5 border-b last:border-b-0 hairline">
      <LockGlyph />
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs mt-0.5" style={{ color: "var(--text-faint)" }}>{note}</p>
      </div>
    </li>
  );
}
