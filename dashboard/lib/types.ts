// Shared types for the app — the PINNED CONTRACT between the server API routes
// (app/api/**) and the client console (app/console/**, components/**).
// Both sides import from here. Do not change a shape without updating both.

export type Role = "merchant" | "carrier" | "recipient" | "auditor";
export type Method = "courier" | "drone";
export type Rail = "transparent" | "confidential";

/** Registry state enum, mirrored from contracts/aegis-registry State. */
export type ShipmentState = "OPEN" | "IN_TRANSIT" | "DELIVERED" | "EXPIRED" | "UNKNOWN";

/** The connected wallet's on-chain identity + the deployment it acts on. */
export interface WalletInfo {
  address: string;               // the connected Privy Stellar wallet (G...)
  funded: boolean;
  balanceXlm: string | null;
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

// ── Two-step wallet-signed transaction flow (server builds, wallet signs, server submits) ──

export type TxAction = "create" | "accept" | "submitFlight" | "deliver" | "refund";

export interface BuildTxReq {
  action: TxAction;
  source: string;                     // connected wallet address (tx source + role arg)
  shipmentId?: number;                // for accept/submitFlight/deliver/refund
  params?: Record<string, unknown>;   // create form fields, etc.
}
export interface BuildTxRes {
  buildId: string;
  xdr: string;                        // prepared unsigned tx XDR — the wallet signs this
  note?: string;
}
export interface SubmitTxReq {
  buildId: string;
  signedXdr: string;                  // full signed tx XDR from the wallet (kit.signTransaction)
}
export interface SubmitTxRes {
  tx: string;                         // explorer tx hash / id
  shipmentId?: number;                // assigned on create
  view?: ShipmentView;
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
  errorCode?: string;   // e.g. "Error(Contract, #2)" surfaced from a rejected action
  tx?: string;          // explorer tx hash when a tx landed
  data?: T;
}

// ── Request payloads (POST bodies) ──────────────────────────────────────────

/** Merchant create form → goes into BuildTxReq.params for action:"create". */
export interface CreateParams {
  toLat: number; toLon: number;
  fromLat?: number; fromLon?: number; // drone origin; defaults sensible
  amount: number;                     // XLM (whole units); server converts to stroops
  method: Method;
  rail: Rail;
  deadlineHours?: number;             // default 24
}

export interface ShipmentReq { shipmentId: number; }

export interface VerifyRes { match: boolean; cs: string; onchainCs: string; }

export interface FlyRes {
  /** For the /map "true route vs public corridor" beat. */
  waypoints: { lat: number; lon: number }[];
  corridorRoot: string;
  digest: string;
}

export interface SignPodReq extends ShipmentReq { lat: number; lon: number; }

export interface AuditRes { amountXlm: string; note: string; }
