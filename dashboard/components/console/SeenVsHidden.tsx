"use client";

/**
 * The judging money-shot: a two-column panel contrasting what the public chain
 * records (left, every field an opaque hash or public-by-design) against what
 * it never learns (right, each locked). Left rows deep-link to stellar.expert;
 * the right column reuses the site-wide <Redacted> lock rows.
 */

import Hash from "@/components/Hash";
import Redacted from "@/components/Redacted";
import type { ShipmentView } from "@/lib/types";
import { accountLink, contractLink, txLink, type Contracts } from "./config";

const REDACTED = [
  {
    label: "Contents & SKU",
    note: "Hashed into the commitment; opened only in the encrypted off-chain packet",
  },
  {
    label: "Quantity · weight · value",
    note: "Range-checked inside the circuit, never published",
  },
  {
    label: "Recipient identity",
    note: "A Baby Jubjub public key sealed inside C_S — the recipient never transacts on-chain",
  },
  {
    label: "Destination address",
    note: "A Merkle root of geocells inside C_S; region size is the merchant's privacy dial",
  },
  {
    label: "Route flown",
    note: "16 telemetry waypoints proven inside the corridor in zero-knowledge — never a coordinate",
    droneOnly: true,
  },
  {
    label: "Sensor telemetry",
    note: "Digest-signed by the drone key, verified in-circuit, then discarded",
    droneOnly: true,
  },
  {
    label: "Carrier circuit identity",
    note: "Blinded behind carrier_pk_commit; only a hash of a hash reaches the ledger",
  },
];

function SeenRow({
  label,
  sub,
  children,
}: {
  label: string;
  sub?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="py-2.5 border-b last:border-b-0 hairline">
      <p
        className="text-xs uppercase tracking-wider mb-1"
        style={{ color: "var(--text-faint)" }}
      >
        {label}
      </p>
      <div className="text-sm break-all">{children}</div>
      {sub && (
        <p className="text-xs mt-0.5" style={{ color: "var(--text-faint)" }}>
          {sub}
        </p>
      )}
    </div>
  );
}

function Dash() {
  return <span style={{ color: "var(--text-faint)" }}>— not yet</span>;
}

export default function SeenVsHidden({
  shipment: s,
  contracts,
}: {
  shipment: ShipmentView;
  contracts: Contracts;
}) {
  const isDrone = s.method === "drone";
  const isConfidential = s.rail === "confidential";

  const txRows: { label: string; hash?: string }[] = [
    { label: "create", hash: s.createdTx },
    { label: "accept", hash: s.acceptTx },
    ...(isDrone ? [{ label: "flight", hash: s.flightTx }] : []),
    { label: "deliver", hash: s.deliverTx },
    ...(isConfidential ? [{ label: "settle", hash: s.settleTx }] : []),
  ];
  const anyTx = txRows.some((t) => t.hash);

  return (
    <div className="grid sm:grid-cols-2 gap-4">
      {/* LEFT — what the chain sees */}
      <div className="card p-5">
        <p
          className="text-xs uppercase tracking-wider mb-3"
          style={{ color: "var(--text-faint)" }}
        >
          What the chain sees
        </p>

        <SeenRow label="Commitment C_S" sub="12-input Poseidon — opaque by construction">
          {s.cs ? (
            <Hash value={s.cs} href={contractLink(contracts, contracts.registry)} />
          ) : (
            <Dash />
          )}
        </SeenRow>

        <SeenRow
          label="Custody head"
          sub="Poseidon over DOM_ACCEPT ⊕ carrier commit — computed on-chain"
        >
          {s.head ? <Hash value={s.head} /> : <Dash />}
        </SeenRow>

        <SeenRow
          label="Method"
          sub={s.laneId !== null ? `lane ${s.laneId} · public by regulatory design` : "delivery method enum"}
        >
          <span className="mono uppercase" style={{ color: "var(--mint)" }}>
            {s.method}
          </span>
        </SeenRow>

        <SeenRow
          label="Escrow amount"
          sub={
            isConfidential
              ? "confidential rail — only the token is public"
              : "native SAC · transparent rail"
          }
        >
          {isConfidential ? (
            <span
              className="mono inline-flex items-center gap-1.5"
              style={{ color: "var(--mint)" }}
            >
              <span aria-hidden>🔒</span> confidential — hidden on-chain
            </span>
          ) : s.amountXlm ? (
            <span className="mono">{s.amountXlm} XLM</span>
          ) : (
            <Dash />
          )}
        </SeenRow>

        <SeenRow label="Paid so far" sub="milestone release recorded on-chain">
          <span className="mono">
            {isConfidential ? "hidden" : `${s.paidXlm} XLM`}
          </span>
        </SeenRow>

        {isDrone && (
          <SeenRow label="flight_ok" sub="the only trace of the entire flight">
            <span
              className="mono"
              style={{ color: s.flightOk ? "var(--mint)" : "var(--text-faint)" }}
            >
              {String(s.flightOk)}
            </span>
          </SeenRow>
        )}

        <SeenRow
          label="Payout address"
          sub="write-once at accept — front-running is fee donation (I3)"
        >
          {s.payout ? (
            <Hash value={s.payout} href={accountLink(s.payout)} />
          ) : (
            <Dash />
          )}
        </SeenRow>

        {anyTx && (
          <div className="pt-3">
            <p
              className="text-xs uppercase tracking-wider mb-2"
              style={{ color: "var(--text-faint)" }}
            >
              On-chain transactions
            </p>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs">
              {txRows.map((t) =>
                t.hash ? (
                  <a
                    key={t.label}
                    href={txLink(contracts, t.hash)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mono hover:text-white transition-colors"
                    style={{ color: "var(--mint)" }}
                  >
                    {t.label} ↗
                  </a>
                ) : (
                  <span
                    key={t.label}
                    className="mono"
                    style={{ color: "var(--text-faint)" }}
                  >
                    {t.label} —
                  </span>
                ),
              )}
            </div>
          </div>
        )}
      </div>

      {/* RIGHT — what it never learns */}
      <div
        className="card p-5"
        style={{ borderColor: "color-mix(in srgb, var(--mint) 25%, transparent)" }}
      >
        <p
          className="text-xs uppercase tracking-wider mb-3"
          style={{ color: "var(--mint)" }}
        >
          What it never learns
        </p>
        <ul>
          {REDACTED.filter((r) => isDrone || !r.droneOnly).map((r) => (
            <Redacted key={r.label} label={r.label} note={r.note} />
          ))}
        </ul>
        <p
          className="text-xs mt-4 leading-relaxed"
          style={{ color: "var(--text-faint)" }}
        >
          Every field on the left is an opaque hash or public by regulatory design
          (DESIGN §13). The Groth16 proofs bind them to the secrets on the right
          without revealing them.
        </p>
      </div>
    </div>
  );
}
