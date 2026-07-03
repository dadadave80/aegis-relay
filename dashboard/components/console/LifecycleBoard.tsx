"use client";

/**
 * Persistent lifecycle board (Two-Worlds design): the current shipment as a
 * StatusRail instrument + the VisibilityMatrix disclosure ledger, plus the drone
 * corridor. Stays on screen across the lifecycle so the whole story is legible.
 */

import { useState } from "react";
import { useSession } from "@/lib/session-context";
import { FALLBACK_CONTRACTS, txLink } from "./config";
import { StatusRail, type RailStation } from "@/components/ds/StatusRail";
import { VisibilityMatrix } from "@/components/ds/VisibilityMatrix";
import { Stamp } from "@/components/ds/Stamp";
import { Spinner } from "@/components/ds/Button";
import { CorridorInstrument } from "@/components/ds/CorridorInstrument";
import { TextInput } from "./primitives";
import type { ShipmentState, ShipmentView } from "@/lib/types";

const STATE_STAMP: Record<ShipmentState, { label: string; tone: "caution" | "ink" | "verified" | "danger" | "dim" }> = {
  OPEN: { label: "OPEN", tone: "caution" },
  IN_TRANSIT: { label: "IN TRANSIT", tone: "ink" },
  DELIVERED: { label: "DELIVERED", tone: "verified" },
  EXPIRED: { label: "EXPIRED", tone: "danger" },
  UNKNOWN: { label: "UNKNOWN", tone: "dim" },
};

/** Map a ShipmentView to the StatusRail's instrument stations (mirrors the
 *  on-chain lifecycle: OPEN → IN TRANSIT → [FLIGHT VERIFIED] → DELIVERED/EXPIRED). */
function railStations(s: ShipmentView, contracts: typeof FALLBACK_CONTRACTS): RailStation[] {
  const accepted = s.head !== null || s.state === "IN_TRANSIT" || s.state === "DELIVERED";
  const delivered = s.state === "DELIVERED";
  const expired = s.state === "EXPIRED";
  const isDrone = s.method === "drone";
  const tx = (h?: string): { tx?: string; txHref?: string } =>
    h ? { tx: h, txHref: txLink(contracts, h) } : {};

  const stations: RailStation[] = [
    { label: "OPEN", status: "done", detail: "Created — opaque commitment stored, escrow funded", ...tx(s.createdTx) },
    {
      label: "IN TRANSIT",
      status: accepted ? "done" : expired ? "failed" : "active",
      detail: accepted
        ? "Carrier accepted — custody head computed on-chain"
        : expired
          ? "Never accepted before the deadline"
          : "Awaiting carrier acceptance",
      ...tx(s.acceptTx),
    },
  ];

  if (isDrone) {
    stations.push({
      label: "FLIGHT VERIFIED",
      status: s.flightOk ? "done" : expired ? "failed" : accepted ? "active" : "pending",
      detail: s.flightOk
        ? "Groth16 corridor-compliance proof accepted — route never revealed"
        : accepted && !expired
          ? "Awaiting the A2 flight proof (gates delivery for drones)"
          : "Flight proof not reached",
      flag: { ok: s.flightOk },
      ...tx(s.flightTx),
    });
  }

  if (expired) {
    stations.push({ label: "EXPIRED", status: "failed", detail: "Escrow deadline passed — remaining escrow refunded to merchant" });
  } else {
    stations.push({
      label: "DELIVERED",
      status: delivered ? "done" : accepted && (!isDrone || s.flightOk) ? "active" : "pending",
      detail: delivered
        ? "Recipient proved receipt in zero-knowledge — escrow released in the same tx"
        : "Awaiting the A1 proof-of-delivery",
      ...tx(s.settleTx ?? s.deliverTx),
    });
  }
  return stations;
}

function FocusInput() {
  const { setCurrentShipmentId } = useSession();
  const [val, setVal] = useState("");
  const go = () => {
    const n = val.trim();
    if (/^\d+$/.test(n)) {
      setCurrentShipmentId(Number(n));
      setVal("");
    }
  };
  return (
    <div className="flex items-center gap-2">
      <div className="w-28">
        <TextInput
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && go()}
          inputMode="numeric"
          placeholder="focus #"
          aria-label="Focus a shipment id"
        />
      </div>
      <button
        onClick={go}
        style={{ minHeight: 40, padding: "0 14px", borderRadius: "var(--r-control)", border: "1px solid var(--hairline)", background: "var(--void-1)", color: "var(--ink-dim)", fontSize: "var(--text-sm)", cursor: "pointer" }}
      >
        Focus
      </button>
    </div>
  );
}

export default function LifecycleBoard() {
  const { shipment, currentShipmentId, shipmentLoading, flyResult, lens } = useSession();
  const contracts = FALLBACK_CONTRACTS;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 className="display" style={{ fontSize: "var(--text-lg)", fontWeight: 600 }}>Lifecycle board</h2>
          {currentShipmentId !== null && (
            <span className="mono" style={{ fontSize: "var(--text-sm)", color: "var(--chain)", padding: "1px 8px", borderRadius: "var(--r-control)", border: "1px solid var(--hairline)" }}>
              #{currentShipmentId}
            </span>
          )}
          {shipmentLoading && <Spinner />}
        </div>
        <FocusInput />
      </div>

      {shipment && currentShipmentId !== null ? (
        <>
          <div className={lens ? "panel-cold" : "panel-warm"} style={{ padding: 18, transition: "background var(--dur-lens) ease-out" }}>
            <div className="flex flex-wrap items-center gap-3" style={{ marginBottom: 18 }}>
              <Stamp tone={STATE_STAMP[shipment.state].tone} style={{ fontSize: "var(--text-sm)" }}>
                {STATE_STAMP[shipment.state].label}
              </Stamp>
              <span className="mono" style={{ fontSize: "var(--text-xs)", color: "var(--ink-dim)", padding: "1px 8px", borderRadius: "var(--r-pill)", border: "1px solid var(--hairline)" }}>
                {shipment.method}{shipment.laneId !== null ? ` · lane ${shipment.laneId}` : ""}
              </span>
              <span className="mono" style={{ fontSize: "var(--text-xs)", color: shipment.rail === "confidential" ? "var(--seal)" : "var(--ink-dim)", padding: "1px 8px", borderRadius: "var(--r-pill)", border: `1px solid ${shipment.rail === "confidential" ? "rgba(139,124,255,0.45)" : "var(--hairline)"}` }}>
                {shipment.rail} rail
              </span>
            </div>
            <StatusRail stations={railStations(shipment, contracts)} />
          </div>

          <VisibilityMatrix confidential={shipment.rail === "confidential"} drone={shipment.method === "drone"} hideYou={lens} />

          {shipment.method === "drone" && <CorridorInstrument live={!!flyResult} lens={lens} />}
        </>
      ) : (
        <div className="panel" style={{ padding: 40, textAlign: "center" }}>
          <p style={{ fontSize: "var(--text-md)", fontWeight: 600, color: "var(--ink)" }}>No shipment in focus</p>
          <p style={{ fontSize: "var(--text-sm)", margin: "8px auto 0", maxWidth: "44ch", color: "var(--ink-dim)", lineHeight: "var(--lh-body)" }}>
            Create a shipment as <span style={{ color: "var(--seal)" }}>Merchant</span> to start the story — or
            focus an existing id above. Everything the chain records appears here as an opaque commitment, which
            is the whole point.
          </p>
        </div>
      )}
    </section>
  );
}
