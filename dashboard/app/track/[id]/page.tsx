import Link from "next/link";
import { ChainDatum } from "@/components/ds/ChainDatum";
import { StatusRail, type RailStation } from "@/components/ds/StatusRail";
import { VisibilityMatrix } from "@/components/ds/VisibilityMatrix";
import { CorridorInstrument } from "@/components/ds/CorridorInstrument";
import { Stamp } from "@/components/ds/Stamp";
import {
  NATIVE_SAC,
  REGISTRY_ID,
  explorer,
  formatAmount,
  getShipment,
  shortId,
  utcDay,
  utcTime,
  type ShipmentView,
} from "@/lib/contract";

export const dynamic = "force-dynamic";

/** Map the on-chain shipment to the StatusRail instrument (mirrors
 *  ShipmentTimeline's lifecycle: OPEN → IN TRANSIT → [FLIGHT] → DELIVERED/EXPIRED). */
function trackStations(s: ShipmentView): RailStation[] {
  const accepted = s.carrier !== null;
  const delivered = s.stateName === "DELIVERED";
  const expired = s.stateName === "EXPIRED";
  const isDrone = s.method === 3;

  const stations: RailStation[] = [
    { label: "Open", status: "done", detail: "Created — opaque commitment stored, escrow funded" },
    {
      label: "In transit",
      status: accepted ? "done" : expired ? "failed" : "active",
      detail: accepted
        ? `Carrier accepted at ${utcTime(s.acceptTs)} — custody head computed on-chain`
        : "Awaiting carrier acceptance",
    },
  ];
  if (isDrone) {
    stations.push({
      label: "Flight verified",
      status: s.flightOk ? "done" : expired ? "failed" : accepted ? "active" : "pending",
      detail: s.flightOk
        ? "Groth16 corridor-compliance proof accepted — route never revealed"
        : accepted && !expired
          ? "Awaiting the A2 flight proof (gates delivery for drones)"
          : "Flight proof not reached",
      flag: { ok: s.flightOk },
    });
  }
  if (expired) {
    stations.push({ label: "Expired", status: "failed", detail: "Escrow deadline passed — remaining escrow refunded to merchant" });
  } else {
    stations.push({
      label: "Delivered",
      status: delivered ? "done" : accepted && (!isDrone || s.flightOk) ? "active" : "pending",
      detail: delivered
        ? "Recipient proved receipt in zero-knowledge — escrow released in the same tx"
        : "Awaiting the A1 proof-of-delivery",
    });
  }
  return stations;
}

// ── Empty / error states ──────────────────────────────────────────────────────

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto" style={{ maxWidth: 1000, padding: "40px 24px 72px" }}>{children}</div>;
}

function ErrorCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Shell>
      <div className="panel-cold" style={{ padding: 40, textAlign: "center", maxWidth: 560, margin: "0 auto" }}>
        <p className="display" style={{ fontSize: "var(--text-lg)", fontWeight: 600 }}>{title}</p>
        <div style={{ fontSize: "var(--text-sm)", margin: "8px 0 0", color: "var(--ink-dim)", lineHeight: "var(--lh-body)" }}>{children}</div>
        <Link href="/" style={{ display: "inline-block", marginTop: 20, fontSize: "var(--text-sm)", color: "var(--seal)" }}>
          ← back to lookup
        </Link>
      </div>
    </Shell>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function TrackPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await params;

  if (!/^\d{1,18}$/.test(rawId) || Number(rawId) < 1) {
    return (
      <ErrorCard title="Not a shipment id">
        <span className="mono">{rawId.slice(0, 40)}</span> is not a positive integer. Shipment ids
        are sequential u64s starting at 1.
      </ErrorCard>
    );
  }
  const id = Number(rawId);

  const result = await getShipment(id);
  if (!result.ok && result.reason === "rpc") {
    return (
      <ErrorCard title={`Testnet RPC unreachable`}>
        The live state of shipment #{id} cannot be read right now. All reads are read-only
        simulations against <span className="mono">{shortId(REGISTRY_ID)}</span> — reload in a
        moment, or{" "}
        <a href={explorer(REGISTRY_ID)} target="_blank" rel="noopener noreferrer" style={{ color: "var(--chain)" }}>
          open the registry on stellar.expert ↗
        </a>.
      </ErrorCard>
    );
  }
  if (!result.ok) {
    return (
      <ErrorCard title={`No shipment #${id} on this registry`}>
        Nothing is stored under this id. Create one in the console and it will appear here — as an
        opaque commitment, which is the point.
      </ErrorCard>
    );
  }

  const s = result.shipment;
  const isDrone = s.method === 3;

  return (
    <div style={{ background: "var(--void-0)" }}>
      {/* Cold header — the honesty banner */}
      <header style={{ borderBottom: "1px solid var(--hairline)", background: "linear-gradient(var(--panel-cold), var(--panel-cold)), var(--void-1)" }}>
        <div className="mx-auto" style={{ maxWidth: 1000, padding: "14px 24px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <Link href="/" className="display" style={{ fontSize: "var(--text-md)", fontWeight: 700 }}>
            AEGIS<span style={{ color: "var(--seal)" }}>&nbsp;RELAY</span>
          </Link>
          <Stamp tone="chain">Public view — this page renders only what the chain knows</Stamp>
        </div>
      </header>

      <Shell>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap", marginBottom: 20 }}>
          <h1 className="display" style={{ margin: 0, fontSize: "var(--text-xl)" }}>
            Shipment <span className="mono" style={{ color: "var(--chain)" }}>#{s.id}</span>
          </h1>
          <span className="mono" style={{ fontSize: "var(--text-xs)", color: "var(--chain)", border: "1px solid rgba(125,223,242,0.35)", borderRadius: "var(--r-pill)", padding: "3px 12px", whiteSpace: "nowrap" }}>
            {s.methodName}{s.laneId !== null ? ` · lane ${s.laneId}` : ""} · {s.token === NATIVE_SAC ? "transparent" : "confidential"} rail
          </span>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 20, alignItems: "start" }}>
          <div className="panel-cold" style={{ padding: 18 }}>
            <div style={{ marginBottom: 14 }}><Stamp tone="chain">Lifecycle</Stamp></div>
            <StatusRail stations={trackStations(s)} />
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div className="panel-cold" style={{ padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
            <ChainDatum label="Commitment C_S" value={s.cS} href={explorer(REGISTRY_ID)} sub="12-input Poseidon — opaque by construction" full />
            {s.head ? (
              <ChainDatum label="Custody head" value={s.head} sub="Poseidon over DOM_ACCEPT ⊕ carrier commit — computed on-chain" full />
            ) : (
              <div><Stamp tone="chain">Custody head</Stamp><p className="mono" style={{ margin: "3px 0 0", fontSize: "var(--text-sm)", color: "var(--ink-dim)" }}>— not accepted yet</p></div>
            )}
            <div style={{ display: "flex", gap: 28, flexWrap: "wrap" }}>
              <div>
                <Stamp tone="chain">Escrow</Stamp>
                <p className="mono" style={{ margin: "3px 0 0", fontSize: "var(--text-sm)", color: "var(--chain)" }}>
                  {formatAmount(s.amount, s.token)} · paid {formatAmount(s.paid, s.token)}
                </p>
              </div>
              <div>
                <Stamp tone="chain">Milestones</Stamp>
                <p className="mono" style={{ margin: "3px 0 0", fontSize: "var(--text-sm)", color: "var(--chain)" }}>[{s.milestones.join(", ")}]</p>
              </div>
              <div>
                <Stamp tone="chain">Escrow deadline</Stamp>
                <p className="mono" style={{ margin: "3px 0 0", fontSize: "var(--text-sm)", color: "var(--chain)" }}>{utcDay(s.escrowDeadline)}</p>
              </div>
              {isDrone && (
                <div>
                  <Stamp tone="chain">flight_ok</Stamp>
                  <p className="mono" style={{ margin: "3px 0 0", fontSize: "var(--text-sm)", color: s.flightOk ? "var(--verified)" : "var(--ink-dim)" }}>{String(s.flightOk)}</p>
                </div>
              )}
            </div>
            {s.payout && (
              <ChainDatum label="Payout address" value={s.payout} href={`https://stellar.expert/explorer/testnet/account/${s.payout}`} sub="write-once at accept — front-running is fee donation (I3)" />
            )}
            {s.carrierPkCommit && (
              <ChainDatum label="carrier_pk_commit" value={s.carrierPkCommit} sub="a blinded commitment, not a key" full />
            )}
          </div>
            {isDrone && <CorridorInstrument lens />}
          </div>
        </div>

        <div style={{ marginTop: 20 }}>
          <div style={{ marginBottom: 10 }}>
            <Stamp tone="chain">Disclosure ledger — the You column is absent by construction</Stamp>
          </div>
          <VisibilityMatrix hideYou drone={isDrone} confidential={s.token !== NATIVE_SAC} />
        </div>

        {/* Explorer strip */}
        <div className="panel-cold" style={{ marginTop: 20, padding: 14, display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px 24px", fontSize: "var(--text-xs)" }}>
          <a href={explorer(REGISTRY_ID)} target="_blank" rel="noopener noreferrer" className="mono" style={{ color: "var(--chain-dim)" }}>registry {shortId(REGISTRY_ID)} ↗</a>
          {s.carrier && (
            <a href={`https://stellar.expert/explorer/testnet/account/${s.carrier}`} target="_blank" rel="noopener noreferrer" className="mono" style={{ color: "var(--chain-dim)" }}>carrier {shortId(s.carrier)} ↗</a>
          )}
          <a href={`https://stellar.expert/explorer/testnet/account/${s.merchant}`} target="_blank" rel="noopener noreferrer" className="mono" style={{ color: "var(--chain-dim)" }}>merchant {shortId(s.merchant)} ↗</a>
          {isDrone && s.laneId !== null && (
            <Link href="/map" style={{ color: "var(--seal)" }}>corridor for lane {s.laneId} →</Link>
          )}
        </div>
      </Shell>
    </div>
  );
}
