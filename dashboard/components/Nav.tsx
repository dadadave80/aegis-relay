import Link from "next/link";

const links = [
  { href: "/", label: "Overview" },
  { href: "/map", label: "Corridor" },
  { href: "/verify", label: "Verify" },
];

const cta = { href: "/demo", label: "Demo console" };

export default function Nav() {
  return (
    <header className="border-b hairline">
      <nav className="max-w-5xl mx-auto flex items-center gap-6 px-6 h-14">
        <Link href="/" className="font-semibold tracking-tight flex items-center gap-2">
          <span className="inline-block w-2 h-2 rounded-full" style={{ background: "var(--mint)" }} />
          AEGIS RELAY
        </Link>
        <div className="flex gap-5 text-sm" style={{ color: "var(--text-dim)" }}>
          {links.map((l) => (
            <Link key={l.href} href={l.href} className="hover:text-white transition-colors">{l.label}</Link>
          ))}
        </div>
        <Link
          href={cta.href}
          className="ml-auto text-sm font-semibold rounded-lg px-3.5 py-1.5 transition-opacity hover:opacity-90"
          style={{ background: "var(--mint)", color: "var(--on-mint)" }}
        >
          {cta.label}
        </Link>
      </nav>
    </header>
  );
}
