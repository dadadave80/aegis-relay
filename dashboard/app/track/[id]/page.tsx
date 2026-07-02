import Link from "next/link";
import Hash from "@/components/Hash";
import Redacted from "@/components/Redacted";
import ShipmentTimeline from "@/components/ShipmentTimeline";
import StatusBadge from "@/components/StatusBadge";
import {
  NATIVE_SAC,
  REGISTRY_ID,
  explorer,
  formatAmount,
  getShipment,
  shortId,
  utcDay,
  type ShipmentView,
} from "@/lib/contract";

export const dynamic = "force-dynamic";

// ── The judging money-shot: what the chain sees vs what it never learns ──────

const REDACTED = [
  { label: "Contents & SKU", note: "Hashed into the commitment; opened only in the encrypted off-chain packet" },
  { label: "Quantity · weight · value", note: "Range-checked inside the circuit, never published" },
  { label: "Recipient identity", note: "A Baby Jubjub public key sealed inside C_S — the recipient never transacts on-chain" },
  { label: "Destination address", note: "A depth-6 Merkle root of geocells inside C_S; region size is the merchant's privacy dial" },
  { label: "Route flown", note: "16 telemetry waypoints proven inside the corridor in zero-knowledge — see the corridor demo" },
  { label: "Sensor telemetry", note: "Digest-signed by the drone key, verified in-circuit, discarded" },
  { label: "Carrier circuit identity", note: "Blinded behind carrier_pk_commit; only a hash of a hash reaches the ledger" },
];

function SeenRow({ label, children, sub }: { label: string; children: React.ReactNode; sub?: string }) {
  return (
    <div className="py-2.5 border-b last:border-b-0 hairline">
      <p className="text-xs uppercase tracking-wider mb-1" style={{ color: "var(--text-faint)" }}>{label}</p>
      <div className="text-sm break-all">{children}</div>
      {sub && <p className="text-xs mt-0.5" style={{ color: "var(--text-faint)" }}>{sub}</p>}
    </div>
  );
}

function MethodBadge({ shipment }: { shipment: ShipmentView }) {
  return (
    <span
      className="mono text-xs px-2 py-0.5 rounded-full border"
      style={{
        color: "var(--mint)",
        borderColor: "color-mix(in srgb, var(--mint) 40%, transparent)",
        background: "color-mix(in srgb, var(--mint) 10%, transparent)",
      }}
    >
      {shipment.methodName}
      {shipment.laneId !== null ? ` · lane ${shipment.laneId}` : ""}
    </span>
  );
}

// ── Empty / error states ──────────────────────────────────────────────────────

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="max-w-5xl mx-auto px-6 py-14">{children}</div>;
}

function BadId({ raw }: { raw: string }) {
  return (
    <Shell>
      <div className="card p-10 text-center max-w-xl mx-auto">
        <p className="text-lg font-semibold">Not a shipment id</p>
        <p className="text-sm mt-2" style={{ color: "var(--text-dim)" }}>
          <span className="mono">{raw.slice(0, 40)}</span> is not a positive integer.
          Shipment ids are sequential u64s starting at 1.
        </p>
        <Link href="/" className="inline-block mt-5 text-sm hover:underline" style={{ color: "var(--mint)" }}>
          ← back to lookup
        </Link>
      </div>
    </Shell>
  );
}

function NotFound({ id }: { id: number }) {
  return (
    <Shell>
      <div className="card p-10 text-center max-w-xl mx-auto">
        <p className="text-lg font-semibold">No shipment #{id} on this registry</p>
        <p className="text-sm mt-2" style={{ color: "var(--text-dim)" }}>
          Nothing is stored under this id. Create one with the merchant CLI
          (<span className="mono">merchant.ts create</span>) and it will appear here —
          as an opaque commitment, which is the point.
        </p>
        <Link href="/" className="inline-block mt-5 text-sm hover:underline" style={{ color: "var(--mint)" }}>
          ← back to lookup
        </Link>
      </div>
    </Shell>
  );
}

function RpcDown({ id }: { id: number }) {
  return (
    <Shell>
      <div
        className="card p-5 mb-8 text-sm"
        style={{ borderColor: "color-mix(in srgb, var(--red) 40%, transparent)" }}
      >
        <span className="font-semibold" style={{ color: "var(--red)" }}>Testnet RPC unreachable.</span>{" "}
        <span style={{ color: "var(--text-dim)" }}>
          The live state of shipment #{id} cannot be read right now. All reads are read-only
          simulations against <span className="mono">{shortId(REGISTRY_ID)}</span> — reload in a moment,
          or inspect the contract directly on the explorer.
        </span>
      </div>
      <div className="text-center">
        <a
          href={explorer(REGISTRY_ID)}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm hover:underline"
          style={{ color: "var(--mint)" }}
        >
          Open registry on stellar.expert ↗
        </a>
      </div>
    </Shell>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function TrackPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await params;

  if (!/^\d{1,18}$/.test(rawId) || Number(rawId) < 1) return <BadId raw={rawId} />;
  const id = Number(rawId);

  const result = await getShipment(id);
  if (!result.ok && result.reason === "rpc") return <RpcDown id={id} />;
  if (!result.ok) return <NotFound id={id} />;

  const s = result.shipment;
  const isDrone = s.method === 3;

  return (
    <Shell>
      <div className="flex flex-wrap items-baseline justify-between gap-3 mb-8">
        <h1 className="text-2xl font-bold tracking-tight">
          Shipment <span className="mono" style={{ color: "var(--mint)" }}>#{s.id}</span>
        </h1>
        <MethodBadge shipment={s} />
      </div>

      <div className="mb-10">
        <StatusBadge state={s.stateName} />
      </div>

      <div className="grid md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-6 mb-6">
        {/* Lifecycle timeline */}
        <div className="card p-5">
          <p className="text-xs uppercase tracking-wider mb-4" style={{ color: "var(--text-faint)" }}>
            Lifecycle
          </p>
          <ShipmentTimeline shipment={s} />
        </div>

        {/* The money-shot: seen vs never learned */}
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="card p-5">
            <p className="text-xs uppercase tracking-wider mb-3" style={{ color: "var(--text-faint)" }}>
              What the chain sees
            </p>
            <SeenRow label="Commitment C_S" sub="12-input Poseidon — opaque by construction">
              <Hash value={s.cS} href={explorer(REGISTRY_ID)} />
            </SeenRow>
            <SeenRow label="Custody head" sub="Poseidon²(DOM_ACCEPT, id) ⊕ carrier commit — computed on-chain">
              {s.head ? <Hash value={s.head} /> : <span style={{ color: "var(--text-faint)" }}>— not accepted yet</span>}
            </SeenRow>
            <SeenRow label="Escrow">
              <span className="mono">{formatAmount(s.amount, s.token)}</span>
              <span className="text-xs ml-2" style={{ color: "var(--text-faint)" }}>
                {s.token === NATIVE_SAC ? "native SAC · transparent rail" : shortId(s.token)}
              </span>
            </SeenRow>
            <SeenRow label="Milestones" sub="basis points, Σ = 10 000; paid so far shown on-chain">
              <span className="mono">[{s.milestones.join(", ")}]</span>
              <span className="text-xs ml-2" style={{ color: "var(--text-faint)" }}>
                paid {formatAmount(s.paid, s.token)}
              </span>
            </SeenRow>
            <SeenRow label="Escrow deadline" sub="deliberately coarse — the fine-grained deadline stays inside C_S">
              <span className="mono">{utcDay(s.escrowDeadline)}</span>
            </SeenRow>
            {isDrone && (
              <SeenRow label="flight_ok" sub="the only trace of the entire flight">
                <span className="mono" style={{ color: s.flightOk ? "var(--mint)" : "var(--text-faint)" }}>
                  {String(s.flightOk)}
                </span>
              </SeenRow>
            )}
            <SeenRow label="Payout address" sub="write-once at accept — front-running is fee donation (I3)">
              {s.payout ? (
                <Hash value={s.payout} href={`https://stellar.expert/explorer/testnet/account/${s.payout}`} />
              ) : (
                <span style={{ color: "var(--text-faint)" }}>— not accepted yet</span>
              )}
            </SeenRow>
            {s.carrierPkCommit && (
              <SeenRow label="carrier_pk_commit" sub="a blinded commitment, not a key">
                <Hash value={s.carrierPkCommit} />
              </SeenRow>
            )}
          </div>

          <div
            className="card p-5"
            style={{ borderColor: "color-mix(in srgb, var(--mint) 25%, transparent)" }}
          >
            <p className="text-xs uppercase tracking-wider mb-3" style={{ color: "var(--mint)" }}>
              What it never learns
            </p>
            <ul>
              {REDACTED.filter((r) => isDrone || (r.label !== "Route flown" && r.label !== "Sensor telemetry")).map((r) => (
                <Redacted key={r.label} label={r.label} note={r.note} />
              ))}
            </ul>
            <p className="text-xs mt-4 leading-relaxed" style={{ color: "var(--text-faint)" }}>
              Every field on the left is either an opaque hash or public by regulatory design
              (DESIGN §13). The proofs bind them to the secrets on the right without revealing them.
            </p>
          </div>
        </div>
      </div>

      {/* Explorer strip */}
      <div className="card p-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs" style={{ color: "var(--text-faint)" }}>
        <a href={explorer(REGISTRY_ID)} target="_blank" rel="noopener noreferrer" className="mono hover:text-white transition-colors">
          registry {shortId(REGISTRY_ID)} ↗
        </a>
        {s.carrier && (
          <a href={`https://stellar.expert/explorer/testnet/account/${s.carrier}`} target="_blank" rel="noopener noreferrer" className="mono hover:text-white transition-colors">
            carrier {shortId(s.carrier)} ↗
          </a>
        )}
        <a href={`https://stellar.expert/explorer/testnet/account/${s.merchant}`} target="_blank" rel="noopener noreferrer" className="mono hover:text-white transition-colors">
          merchant {shortId(s.merchant)} ↗
        </a>
        {isDrone && s.laneId !== null && (
          <Link href="/map" className="hover:text-white transition-colors" style={{ color: "var(--mint)" }}>
            corridor for lane {s.laneId} →
          </Link>
        )}
      </div>
    </Shell>
  );
}
