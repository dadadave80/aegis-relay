import Link from "next/link";
import Hash from "@/components/Hash";
import TrackLookup from "@/components/TrackLookup";
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
    <div className="max-w-5xl mx-auto px-6 py-14">
      {/* Hero */}
      <div className="text-center mb-12">
        <h1 className="text-4xl sm:text-5xl font-bold tracking-tight">
          Prove the delivery.
          <br />
          <span style={{ color: "var(--mint)" }}>Hide the map.</span>
        </h1>
        <p className="mt-5 max-w-2xl mx-auto text-sm sm:text-base leading-relaxed" style={{ color: "var(--text-dim)" }}>
          Freight runs on data nobody wants to share — manifests, values, recipients, addresses, routes.
          Every disclosure is an attack surface. Aegis Relay settles deliveries on Stellar while keeping
          all of it private: on-chain there is only an opaque commitment, an escrow, a state machine,
          and Groth16 proofs. Each verified proof advances the shipment and releases escrow in the
          <em> same</em> Soroban transaction, on the native BN254 + Poseidon host functions — no oracle,
          no off-chain settlement layer.
        </p>
      </div>

      {/* Shipment lookup */}
      <div className="max-w-md mx-auto mb-14">
        <TrackLookup />
        <p className="text-xs text-center mt-2" style={{ color: "var(--text-faint)" }}>
          Look up a live shipment on the testnet registry
        </p>
      </div>

      {/* Three proof statements */}
      <div className="grid sm:grid-cols-3 gap-4 mb-12">
        {PROOFS.map((p) => (
          <div key={p.name} className="card p-5">
            <p className="text-xs uppercase tracking-wider mb-2" style={{ color: "var(--mint)" }}>
              {p.name}
            </p>
            <p className="text-sm leading-relaxed">{p.claim}</p>
            <p className="text-xs mt-3 leading-relaxed" style={{ color: "var(--text-faint)" }}>{p.hides}</p>
          </div>
        ))}
      </div>

      <p className="text-center text-sm mb-12 max-w-2xl mx-auto" style={{ color: "var(--text-dim)" }}>
        Without ZK, each statement requires revealing the secret it protects. ZK is the mechanism,
        not a garnish — see the{" "}
        <Link href="/map" className="hover:underline" style={{ color: "var(--mint)" }}>
          corridor demo
        </Link>{" "}
        for the drone story and{" "}
        <Link href="/verify" className="hover:underline" style={{ color: "var(--mint)" }}>
          verify
        </Link>{" "}
        for the recipient flow.
      </p>

      {/* Live network strip */}
      <div className="card p-5 flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <div className="flex items-center gap-3">
          <span
            className="inline-block w-2.5 h-2.5 rounded-full"
            style={{ background: ledger !== null ? "var(--mint)" : "var(--red)" }}
            aria-hidden
          />
          <span className="text-sm">
            {ledger !== null ? (
              <>Stellar Testnet · ledger <span className="mono">{ledger.toLocaleString("en-US")}</span></>
            ) : (
              <span style={{ color: "var(--red)" }}>Testnet RPC unreachable — reads degrade gracefully</span>
            )}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs" style={{ color: "var(--text-faint)" }}>
          <span className="inline-flex items-center gap-2">
            registry <Hash value={REGISTRY_ID} href={explorer(REGISTRY_ID)} />
          </span>
          <span className="inline-flex items-center gap-2">
            airspace <Hash value={AIRSPACE_ID} href={explorer(AIRSPACE_ID)} />
          </span>
          <span className="inline-flex items-center gap-2">
            credentials <Hash value={CREDENTIALS_ID} href={explorer(CREDENTIALS_ID)} />
          </span>
        </div>
      </div>
    </div>
  );
}
