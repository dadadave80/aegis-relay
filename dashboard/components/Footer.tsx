import { REGISTRY_ID, explorer } from "@/lib/contract";

const REPO_URL = "https://github.com/dadadave80/aegis-relay"; // repo placeholder
const DESIGN_URL = `${REPO_URL}/blob/main/docs/DESIGN.md`;

export default function Footer() {
  return (
    <footer className="border-t hairline mt-16">
      <div className="max-w-5xl mx-auto px-6 py-6 text-xs flex flex-wrap gap-x-6 gap-y-2" style={{ color: "var(--text-faint)" }}>
        <span>Stellar Testnet · Protocol 27</span>
        <a href={explorer(REGISTRY_ID)} target="_blank" rel="noopener noreferrer" className="mono hover:text-white transition-colors">
          registry {REGISTRY_ID.slice(0, 6)}…{REGISTRY_ID.slice(-6)} ↗
        </a>
        <a href={REPO_URL} target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors">Repo</a>
        <a href={DESIGN_URL} target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors">DESIGN.md</a>
      </div>
    </footer>
  );
}
