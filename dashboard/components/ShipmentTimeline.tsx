import type { ShipmentView } from "@/lib/contract";
import { utcTime } from "@/lib/contract";

interface Step {
  label: string;
  detail: string;
  status: "done" | "active" | "pending" | "failed";
}

/**
 * The lifecycle timeline (DESIGN §7):
 * OPEN → IN TRANSIT → [FLIGHT VERIFIED, method=DRONE] → DELIVERED,
 * with EXPIRED as the terminal timeout branch.
 */
function buildSteps(s: ShipmentView): Step[] {
  const accepted = s.carrier !== null;
  const delivered = s.stateName === "DELIVERED";
  const expired = s.stateName === "EXPIRED";
  const isDrone = s.method === 3;

  const steps: Step[] = [
    {
      label: "OPEN",
      detail: "Created — opaque commitment stored, escrow funded",
      status: "done",
    },
    {
      label: "IN TRANSIT",
      detail: accepted
        ? `Carrier accepted at ${utcTime(s.acceptTs)} — custody head computed on-chain`
        : "Awaiting carrier acceptance",
      status: accepted ? "done" : expired ? "failed" : "active",
    },
  ];

  if (isDrone) {
    steps.push({
      label: "FLIGHT VERIFIED",
      detail: s.flightOk
        ? "Groth16 corridor-compliance proof accepted — route never revealed"
        : accepted && !expired
          ? "Awaiting the A2 flight proof (gates delivery for drones)"
          : "Flight proof not reached",
      status: s.flightOk ? "done" : expired ? "failed" : accepted ? "active" : "pending",
    });
  }

  if (expired) {
    steps.push({
      label: "EXPIRED",
      detail: "Escrow deadline passed — remaining escrow refunded to merchant",
      status: "failed",
    });
  } else {
    steps.push({
      label: "DELIVERED",
      detail: delivered
        ? "Recipient proved receipt in zero-knowledge — escrow released in the same tx"
        : "Awaiting the A1 proof-of-delivery",
      status: delivered
        ? "done"
        : accepted && (!isDrone || s.flightOk)
          ? "active"
          : "pending",
    });
  }

  return steps;
}

const GLYPH: Record<Step["status"], string> = {
  done: "✓",
  active: "▸",
  pending: "○",
  failed: "✗",
};

const COLOR: Record<Step["status"], string> = {
  done: "var(--mint)",
  active: "var(--text)",
  pending: "var(--text-faint)",
  failed: "var(--red)",
};

export default function ShipmentTimeline({ shipment }: { shipment: ShipmentView }) {
  const steps = buildSteps(shipment);
  return (
    <ol className="space-y-0">
      {steps.map((step, i) => (
        <li key={step.label} className="flex gap-4">
          <div className="flex flex-col items-center">
            <span
              className="mono text-sm w-7 h-7 shrink-0 rounded-full border flex items-center justify-center"
              style={{
                color: COLOR[step.status],
                borderColor: "color-mix(in srgb, " + COLOR[step.status] + " 45%, transparent)",
                background: "color-mix(in srgb, " + COLOR[step.status] + " 10%, transparent)",
              }}
              aria-hidden
            >
              {GLYPH[step.status]}
            </span>
            {i < steps.length - 1 && (
              <span className="w-px flex-1 my-1" style={{ background: "var(--border)" }} />
            )}
          </div>
          <div className="pb-6 min-w-0">
            <p className="font-semibold tracking-wide text-sm" style={{ color: COLOR[step.status] }}>
              {step.label}
            </p>
            <p className="text-sm mt-0.5" style={{ color: "var(--text-dim)" }}>{step.detail}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}
