import Link from "next/link";
import Hash from "@/components/Hash";
import TrackLookup from "@/components/TrackLookup";
import ManifestHero from "@/components/ManifestHero";
import { AIRSPACE_ID, CREDENTIALS_ID, REGISTRY_ID, explorer, getLatestLedger } from "@/lib/contract";

export const dynamic = "force-dynamic";

const PROOFS = [
  {
    name: "Custody",
    claim:
      "The parcel is held by exactly the party the chain of signed hand-offs says it is — a credentialed carrier.",
    hides: "Carrier identity never appears on-chain; only a blinded commitment inside one head hash.",
  },
  {
    name: "Compliance",
    claim:
      "A drone flight stayed inside the regulator-approved corridor — altitude, speed, no telemetry gaps.",
    hides: "The route is never published. The chain sees a corridor root and a single flight_ok flag.",
  },
  {
    name: "Delivery",
    claim:
      "The committed recipient cryptographically confirmed receipt inside the committed destination region.",
    hides: "Who they are and where they live stay off-chain forever; settlement is gated by one nullifier.",
  },
];

export default async function Home() {
  const ledger = await getLatestLedger().catch(() => null);

  return (
    <div className="mx-auto" style={{ maxWidth: 1080, padding: "72px 24px 96px" }}>
      {/* Hero thesis */}
      <div style={{ textAlign: "center", marginBottom: 48 }}>
        <h1 className="display" style={{ margin: 0, fontSize: "var(--mk-2xl)", fontWeight: 700 }}>
          Prove the delivery.
          <br />
          <span style={{ color: "var(--seal)" }}>Hide the map.</span>
        </h1>
        <p
          style={{
            margin: "20px auto 0",
            maxWidth: "60ch",
            fontSize: "var(--mk-sm)",
            color: "var(--ink-dim)",
            lineHeight: "var(--lh-body)",
          }}
        >
          Freight runs on data nobody wants to share — manifests, values, recipients, addresses,
          routes. Aegis Relay settles deliveries on Stellar while keeping all of it private: on-chain
          there is only an opaque commitment, an escrow, a state machine, and Groth16 proofs. Each
          verified proof advances the shipment and releases escrow in the <em>same</em> Soroban
          transaction, on the native BN254 + Poseidon host functions — no oracle, no off-chain
          settlement layer.
        </p>
      </div>

      {/* The self-redacting manifest */}
      <ManifestHero />

      {/* Primary CTA — the app */}
      <div style={{ maxWidth: 720, margin: "48px auto 0" }}>
        <Link
          href="/console"
          className="group panel-warm block transition-[transform,border-color] hover:-translate-y-0.5"
          style={{ padding: 24 }}
        >
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="min-w-0">
              <span className="stamp" style={{ color: "var(--seal)" }}>The app</span>
              <p className="display" style={{ margin: "8px 0 0", fontSize: "var(--text-lg)", fontWeight: 600 }}>
                Drive the whole lifecycle yourself
              </p>
              <p style={{ margin: "6px 0 0", fontSize: "var(--text-sm)", color: "var(--ink-dim)", lineHeight: "var(--lh-body)" }}>
                Connect your wallet, act as merchant, carrier, recipient or auditor, and watch every
                proof settle live on testnet.
              </p>
            </div>
            <span
              className="shrink-0 inline-flex items-center gap-2 transition-transform group-hover:translate-x-0.5"
              style={{ background: "var(--seal)", color: "var(--on-mint)", padding: "12px 20px", borderRadius: "var(--r-control)", fontWeight: 600, fontSize: "var(--text-sm)" }}
            >
              Open the app ↗
            </span>
          </div>
        </Link>
      </div>

      {/* Three proof statements */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
          gap: 16,
          margin: "64px 0",
        }}
      >
        {PROOFS.map((p) => (
          <div key={p.name} className="panel" style={{ padding: 18 }}>
            <span className="stamp" style={{ color: "var(--seal)" }}>{p.name}</span>
            <p style={{ margin: "10px 0 0", fontSize: "var(--text-sm)", color: "var(--ink)", lineHeight: "var(--lh-body)" }}>
              {p.claim}
            </p>
            <p style={{ margin: "10px 0 0", fontSize: "var(--text-xs)", color: "var(--ink-dim)", lineHeight: "var(--lh-body)" }}>
              {p.hides}
            </p>
          </div>
        ))}
      </div>

      {/* Shipment lookup */}
      <div style={{ maxWidth: 420, margin: "0 auto 16px" }}>
        <TrackLookup />
      </div>
      <p className="mono" style={{ textAlign: "center", margin: "0 0 64px", fontSize: "var(--text-xs)", color: "var(--ink-dim)" }}>
        look up a live shipment on the testnet registry
      </p>

      {/* Live network strip */}
      <div
        className="panel-cold"
        style={{ padding: "14px 18px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap" }}
      >
        <span className="mono" style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: "var(--text-xs)", color: ledger !== null ? "var(--chain)" : "var(--danger)" }}>
          <span
            aria-hidden
            style={{ width: 7, height: 7, borderRadius: "50%", background: ledger !== null ? "var(--verified)" : "var(--danger)", display: "inline-block" }}
          />
          {ledger !== null ? (
            <>Stellar Testnet · ledger {ledger.toLocaleString("en-US")}</>
          ) : (
            <>Testnet RPC unreachable — reads degrade gracefully</>
          )}
        </span>
        <div style={{ display: "flex", gap: 20, flexWrap: "wrap", alignItems: "center" }} className="text-xs">
          <span className="inline-flex items-center gap-2 mono" style={{ color: "var(--chain-dim)" }}>
            registry <Hash value={REGISTRY_ID} href={explorer(REGISTRY_ID)} />
          </span>
          <span className="inline-flex items-center gap-2 mono" style={{ color: "var(--chain-dim)" }}>
            airspace <Hash value={AIRSPACE_ID} href={explorer(AIRSPACE_ID)} />
          </span>
          <span className="inline-flex items-center gap-2 mono" style={{ color: "var(--chain-dim)" }}>
            credentials <Hash value={CREDENTIALS_ID} href={explorer(CREDENTIALS_ID)} />
          </span>
        </div>
      </div>
    </div>
  );
}
