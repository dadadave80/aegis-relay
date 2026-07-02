// Shared types for the interactive demo — the PINNED CONTRACT between the
// server API routes (app/api/**) and the client console (app/demo/**, components/**).
// Both sides import from here. Do not change a shape without updating both.

export type Role = "merchant" | "carrier" | "recipient" | "auditor" | "attacker";
export type Method = "courier" | "drone";
export type Rail = "transparent" | "confidential";

/** Registry state enum, mirrored from contracts/aegis-registry State. */
export type ShipmentState = "OPEN" | "IN_TRANSIT" | "DELIVERED" | "EXPIRED" | "UNKNOWN";

/** Per-session role accounts, auto-funded via friendbot. */
export interface SessionInfo {
  sessionId: string;
  merchant: { address: string; funded: boolean; balanceXlm: string | null };
  carrier: { address: string; funded: boolean; balanceXlm: string | null };
  /** Recipient never holds a Stellar account — only an in-packet Baby Jubjub key. */
  contracts: {
    registry: string;
    airspace: string;
    credentials: string;
    ctToken: string;
    ctAuditor: string;
    explorerBase: string; // https://stellar.expert/explorer/testnet/contract/
    txBase: string;       // https://stellar.expert/explorer/testnet/tx/
  };
}

/** What the chain sees vs. what stays hidden — drives the money-shot panel. */
export interface ShipmentView {
  id: number;
  state: ShipmentState;
  method: Method;
  rail: Rail;
  laneId: number | null;
  cs: string;            // opaque commitment (decimal)
  head: string | null;   // custody head (decimal) once accepted
  amountXlm: string | null; // transparent rail only; null/"hidden" on confidential
  paidXlm: string;
  flightOk: boolean;
  escrowDeadline: number;
  payout: string | null;
  createdTx?: string;
  acceptTx?: string;
  flightTx?: string;
  deliverTx?: string;
  settleTx?: string;
}

/** Standard envelope for every mutating action. */
export interface ActionResult<T = unknown> {
  ok: boolean;
  error?: string;
  errorCode?: string;   // e.g. "Error(Contract, #4302)" for the attack beats
  tx?: string;          // explorer tx hash when a tx landed
  data?: T;
}

// ── Request payloads (POST bodies) ──────────────────────────────────────────

export interface CreateReq {
  sessionId: string;
  toLat: number; toLon: number;
  fromLat?: number; fromLon?: number; // drone origin; defaults sensible
  amount: number;                     // XLM (whole units); server converts to stroops
  method: Method;
  rail: Rail;
  deadlineHours?: number;             // default 24
}
export interface CreateRes { shipmentId: number; view: ShipmentView; }

export interface ShipmentReq { sessionId: string; shipmentId: number; }

export interface VerifyRes { match: boolean; cs: string; onchainCs: string; }

export interface FlyRes {
  /** For the /map "true route vs public corridor" beat. */
  waypoints: { lat: number; lon: number }[];
  corridorRoot: string;
  digest: string;
}

export interface SignPodReq extends ShipmentReq { lat: number; lon: number; }

export interface AuditRes { amountXlm: string; note: string; }

export type AttackKind =
  | "replay"        // resubmit another shipment's proof → BadProof/TsBeforeAccept
  | "tamper"        // flip a proof byte → Crypto/InvalidInput
  | "wrongproof"    // valid points, wrong proof → BadProof #1
  | "stray"         // dronesim off-corridor → rejected at witness gen
  | "premature";    // confidential: settle before DELIVERED → hook #4302
export interface AttackReq extends ShipmentReq { kind: AttackKind; }
export interface AttackRes { rejected: boolean; where: string; detail: string; }
