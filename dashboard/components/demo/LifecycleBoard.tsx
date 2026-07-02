"use client";

/**
 * Persistent lifecycle board: the current shipment's state, timeline, the
 * seen-vs-hidden money-shot panel, and (for drones) the corridor map. Stays on
 * screen across role switches so the founder can narrate the whole story.
 */

import { useState } from "react";
import { useSession } from "@/lib/session-context";
import { FALLBACK_CONTRACTS } from "./config";
import { Spinner, TextInput } from "./primitives";
import DemoTimeline from "./DemoTimeline";
import SeenVsHidden from "./SeenVsHidden";
import CorridorMini from "./CorridorMini";
import type { ShipmentState } from "@/lib/types";

const STATE_STYLE: Record<
  ShipmentState,
  { label: string; color: string; glyph: string }
> = {
  OPEN: { label: "OPEN", color: "var(--amber)", glyph: "○" },
  IN_TRANSIT: { label: "IN TRANSIT", color: "var(--text)", glyph: "▸" },
  DELIVERED: { label: "DELIVERED", color: "var(--mint)", glyph: "✓" },
  EXPIRED: { label: "EXPIRED", color: "var(--red)", glyph: "▲" },
  UNKNOWN: { label: "UNKNOWN", color: "var(--text-faint)", glyph: "?" },
};

function StatePill({ state }: { state: ShipmentState }) {
  const s = STATE_STYLE[state];
  return (
    <span
      className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-sm font-semibold"
      style={{
        color: s.color,
        background: `color-mix(in srgb, ${s.color} 12%, transparent)`,
        border: `1px solid color-mix(in srgb, ${s.color} 40%, transparent)`,
      }}
    >
      <span aria-hidden>{s.glyph}</span>
      {s.label}
    </span>
  );
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
        className="rounded-lg min-h-[40px] px-3 text-sm border hairline transition-[transform,opacity] active:scale-[0.96] hover:text-white"
        style={{ color: "var(--text-dim)" }}
      >
        Focus
      </button>
    </div>
  );
}

export default function LifecycleBoard() {
  const { shipment, currentShipmentId, shipmentLoading, session, flyResult } =
    useSession();
  const contracts = session?.contracts ?? FALLBACK_CONTRACTS;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold tracking-tight">
            Lifecycle board
          </h2>
          {currentShipmentId !== null && (
            <span
              className="mono text-sm px-2 py-0.5 rounded-md"
              style={{
                color: "var(--mint)",
                background: "color-mix(in srgb, var(--mint) 10%, transparent)",
              }}
            >
              #{currentShipmentId}
            </span>
          )}
          {shipmentLoading && <Spinner />}
        </div>
        <FocusInput />
      </div>

      {shipment && currentShipmentId !== null ? (
        <>
          <div className="card p-5">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex flex-wrap items-center gap-2.5">
                <StatePill state={shipment.state} />
                <span
                  className="mono text-xs px-2 py-0.5 rounded-full border uppercase"
                  style={{
                    color: "var(--mint)",
                    borderColor: "color-mix(in srgb, var(--mint) 40%, transparent)",
                    background: "color-mix(in srgb, var(--mint) 10%, transparent)",
                  }}
                >
                  {shipment.method}
                  {shipment.laneId !== null ? ` · lane ${shipment.laneId}` : ""}
                </span>
                <span
                  className="mono text-xs px-2 py-0.5 rounded-full border"
                  style={{
                    color:
                      shipment.rail === "confidential"
                        ? "var(--amber)"
                        : "var(--text-dim)",
                    borderColor: "var(--border)",
                  }}
                >
                  {shipment.rail} rail
                </span>
              </div>
            </div>

            <div className="mt-5">
              <DemoTimeline shipment={shipment} />
            </div>
          </div>

          <SeenVsHidden shipment={shipment} contracts={contracts} />

          {shipment.method === "drone" && <CorridorMini fly={flyResult} />}
        </>
      ) : (
        <div className="card p-10 text-center">
          <p className="text-base font-semibold">No shipment in focus</p>
          <p
            className="text-sm mt-2 max-w-md mx-auto leading-relaxed"
            style={{ color: "var(--text-dim)" }}
          >
            Switch to <span style={{ color: "var(--mint)" }}>Merchant</span> and
            create a shipment to start the story — or focus an existing id above.
            Everything the chain records will appear here as an opaque commitment,
            which is the whole point.
          </p>
        </div>
      )}
    </section>
  );
}
