import Link from "next/link";

const links = [
  { href: "/", label: "Overview" },
  { href: "/map", label: "Corridor" },
  { href: "/market", label: "Market" },
  { href: "/verify", label: "Verify" },
];

const cta = { href: "/console", label: "Open the app" };

export default function Nav() {
  return (
    <header className="border-b hairline">
      <nav className="max-w-6xl mx-auto flex items-center gap-6 px-6 h-14">
        <Link href="/" className="display flex items-center" style={{ fontSize: "var(--text-md)", fontWeight: 700 }}>
          AEGIS<span style={{ color: "var(--seal)" }}>&nbsp;RELAY</span>
        </Link>
        <div className="flex gap-5" style={{ fontSize: "var(--text-sm)", color: "var(--ink-dim)" }}>
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="transition-colors hover:[color:var(--ink)]"
            >
              {l.label}
            </Link>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-4">
          <span
            className="hidden sm:inline"
            title="Recipients: the merchant sends you a claim link (/claim/<id>#seed). Open it directly to sign for delivery — the signing seed stays in your browser and never reaches the server."
            style={{ fontSize: "var(--text-xs)", color: "var(--ink-dim)", cursor: "help", borderBottom: "1px dotted var(--hairline)" }}
          >
            Have a claim link?
          </span>
          <Link
            href={cta.href}
            className="transition-transform active:scale-[.98]"
            style={{ background: "var(--seal)", color: "var(--on-mint)", fontWeight: 600, fontSize: "var(--text-sm)", borderRadius: "var(--r-control)", padding: "6px 14px" }}
          >
            {cta.label}
          </Link>
        </div>
      </nav>
    </header>
  );
}
