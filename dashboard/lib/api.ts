// Client-side fetch layer — thin wrappers over the STATELESS server routes.
// On-chain actions go through buildTx → (wallet signs) → submitTx; the
// orchestration lives in lib/wallet-flows.ts (useWalletFlows). Shapes: ./types.
"use client";
import type {
  ShipmentView, ActionResult, BuildTxReq, BuildTxRes, SubmitTxReq, SubmitTxRes,
  VerifyRes, FlyInputRes, ProveInputRes, AuditRes, ShipmentReq, RoleInfo,
  Listing, MarketClaimResult, ClaimContext, PodSignReq,
  CarrierStatus, CarrierStatusRes, ReportReq, ReportRes,
} from "./types";

async function post<T>(path: string, body: unknown): Promise<ActionResult<T>> {
  try {
    const r = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return (await r.json()) as ActionResult<T>;
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}
async function get<T>(path: string): Promise<ActionResult<T>> {
  try {
    const r = await fetch(path);
    return (await r.json()) as ActionResult<T>;
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export const api = {
  // two-step wallet-signed tx
  buildTx:      (b: BuildTxReq)  => post<BuildTxRes>("/api/tx/build", b),
  submitTx:     (b: SubmitTxReq) => post<SubmitTxRes>("/api/tx/submit", b),
  // (BuildTxReq/SubmitTxReq now carry xdr / signedXdr — Stellar Wallets Kit)
  // stateless server work (no custody)
  faucet:       (address: string) => post<{ funded: boolean; balanceXlm: string | null }>("/api/faucet", { address }),
  verify:       (b: ShipmentReq)  => post<VerifyRes>("/api/carrier/verify", b),
  // Browser Groth16 proving is two-phase: fly/proveDeliver fetch the circuit
  // input, then flyRecord/deliverRecord post the proof produced in the browser.
  fly:          (b: ShipmentReq)  => post<FlyInputRes>("/api/drone/fly", b),
  flyRecord:    (shipmentId: number, proof: unknown, publicSignals: string[]) =>
                  post<{ ok: boolean }>("/api/drone/fly", { shipmentId, proof, publicSignals }),
  proveDeliver: (b: ShipmentReq)  => post<ProveInputRes>("/api/prove-delivery", b),
  deliverRecord:(shipmentId: number, proof: unknown, publicSignals: string[]) =>
                  post<{ ready: boolean }>("/api/prove-delivery", { shipmentId, proof, publicSignals }),
  audit:        (b: ShipmentReq)  => post<AuditRes>("/api/confidential/audit", b),
  report:       (b: ReportReq)    => post<ReportRes>("/api/dispute/report", b),
  shipment:     (id: number)      => get<ShipmentView>(`/api/shipment/${id}`),
  roleInfo:     (address: string) => get<RoleInfo>(`/api/role?address=${encodeURIComponent(address)}`),
  // recipient claim link — GET signing context, POST the in-browser PoD signature
  claimContext: (id: number)      => get<ClaimContext>(`/api/claim/${id}`),
  claimPod:     (b: PodSignReq)   => post<{ signed: boolean }>("/api/claim", b),
  // marketplace board + credential-gated claim (Task 5)
  market: {
    list:  ()                                    => get<Listing[]>("/api/market"),
    claim: (shipmentId: number, address: string) =>
             post<MarketClaimResult>("/api/market", { shipmentId, address }),
  },
  // carrier onboarding + credential-gate status read (Task 8)
  carrier: {
    onboard: (address: string) => post<CarrierStatus>("/api/carrier/onboard", { address }),
    status:  (address: string) => get<CarrierStatusRes>(`/api/carrier/${encodeURIComponent(address)}`),
  },
};
