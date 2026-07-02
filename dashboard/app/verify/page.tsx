import type { Metadata } from "next";
import CodeBlock from "@/components/CodeBlock";
import { REGISTRY_ID } from "@/lib/contract";

export const metadata: Metadata = {
  title: "Verify — Aegis Relay",
  description: "How a recipient proves receipt without revealing who or where they are.",
};

const MSG_FIELDS = [
  { field: "DOM_PODMSG", note: "domain tag (5) — every Poseidon call in Aegis is domain-separated; a hash without a tag is a spec violation" },
  { field: "shipment_id", note: "binds the signature to this shipment — no replay across shipments (T1)" },
  { field: "carrier_pk_commit", note: "binds it to the current custodian — a stolen or pre-signed confirmation is useless to any other carrier (T8)" },
  { field: "cell_RD(location)", note: "the r=17 geocell where the signature happened — ties receipt to the committed destination region without an address" },
  { field: "ts", note: "unix seconds — the contract enforces a ±600 s freshness window on-chain (I9)" },
];

const STEPS = [
  {
    title: "Claim link",
    body: "At create, the merchant sends the recipient an encrypted shipment packet containing a claim seed. The recipient's Baby Jubjub key is derived from it — they never transact on-chain, ever.",
  },
  {
    title: "Sign at the door",
    body: "When the parcel arrives (courier door, locker, or drone hover point), the carrier's device shows the shipment context and the recipient signs the PoD message with their claim key.",
  },
  {
    title: "Carrier proves",
    body: "The carrier feeds the signature into circuit A1, which proves — in zero knowledge — that the committed recipient signed a fresh message bound to this custodian at a location inside the committed destination region, and that the nullifier is well-formed.",
  },
  {
    title: "Verify-and-settle, one transaction",
    body: "deliver() checks the proof against the stored C_S and custody head (never caller-supplied — I1), spends the nullifier, flips the state to DELIVERED, and releases the remaining escrow to the payout address fixed at accept. Atomic; no oracle.",
  },
];

const CLI_SIGN = `# recipient — sign the PoD message at the door
# (demo stand-in for the wallet PWA; keys come from the packet claim seed)
cd prover
node --import tsx/esm src/recipient.ts sign-pod \\
  --packet out/packet.json --id 1 \\
  --carrier-commit <decimal printed by carrier accept> \\
  --lat 6.4899 --lon 3.3499
# → writes out/ships/1/pod.json`;

const CLI_PROVE = `# carrier — turn the signature into a Groth16 A1 proof
node --import tsx/esm src/carrier.ts prove-delivery \\
  --packet out/packet.json --id 1 --pod out/ships/1/pod.json
# → writes out/ships/1/{proof,public}.json (snarkjs fullProve)`;

const CLI_DELIVER = `# anyone — submit the proof; funds only ever flow to the stored payout (I3)
node --import tsx/esm src/carrier.ts deliver \\
  --id 1 --registry ${REGISTRY_ID}
# → state → DELIVERED + escrow release, same transaction`;

export default function VerifyPage() {
  return (
    <div className="max-w-5xl mx-auto px-6 py-14">
      <div className="mb-10">
        <h1 className="text-2xl font-bold tracking-tight">Proof of delivery, without a delivery address</h1>
        <p className="mt-2 text-sm max-w-2xl leading-relaxed" style={{ color: "var(--text-dim)" }}>
          The recipient confirms receipt by signing one Poseidon message with a key only they hold.
          The chain never sees the signature, the key, or the location — only a Groth16 proof that
          all of it checks out.
        </p>
      </div>

      {/* Message structure */}
      <div className="card p-5 mb-10">
        <p className="text-xs uppercase tracking-wider mb-3" style={{ color: "var(--text-faint)" }}>
          The signed message
        </p>
        <div className="overflow-x-auto">
          <p className="mono text-sm whitespace-nowrap pb-2">
            m = Poseidon( <span style={{ color: "var(--mint)" }}>DOM_PODMSG</span>, shipment_id, carrier_pk_commit, cell_RD(location), ts )
          </p>
        </div>
        <ul className="mt-3">
          {MSG_FIELDS.map((f) => (
            <li key={f.field} className="py-2 border-b last:border-b-0 hairline flex flex-col sm:flex-row sm:items-baseline gap-1 sm:gap-4">
              <span className="mono text-sm shrink-0 sm:w-44" style={{ color: "var(--mint)" }}>{f.field}</span>
              <span className="text-xs leading-relaxed" style={{ color: "var(--text-dim)" }}>{f.note}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Claim-link flow */}
      <div className="grid sm:grid-cols-2 gap-4 mb-10">
        {STEPS.map((s, i) => (
          <div key={s.title} className="card p-5">
            <p className="text-xs uppercase tracking-wider mb-2" style={{ color: "var(--mint)" }}>
              <span className="mono mr-2">{i + 1}</span>{s.title}
            </p>
            <p className="text-sm leading-relaxed" style={{ color: "var(--text-dim)" }}>{s.body}</p>
          </div>
        ))}
      </div>

      {/* Honesty box */}
      <div
        className="card p-5 mb-10 text-sm leading-relaxed"
        style={{ borderColor: "color-mix(in srgb, var(--amber) 35%, transparent)" }}
      >
        <span className="font-semibold" style={{ color: "var(--amber)" }}>Honest scope:</span>{" "}
        <span style={{ color: "var(--text-dim)" }}>
          in production this signing flow lives in the recipient&apos;s wallet PWA behind the claim link.
          The demo signs via CLI — same keys, same message, same proof; only the button is missing.
          There is deliberately no in-browser signing here.
        </span>
      </div>

      {/* CLI one-liners */}
      <p className="text-xs uppercase tracking-wider mb-3" style={{ color: "var(--text-faint)" }}>
        Run the flow (from the repo root)
      </p>
      <div className="space-y-4">
        <CodeBlock title="1 · recipient signs" code={CLI_SIGN} />
        <CodeBlock title="2 · carrier proves" code={CLI_PROVE} />
        <CodeBlock title="3 · settle on-chain" code={CLI_DELIVER} />
      </div>
    </div>
  );
}
