// Client-side fetch layer — thin wrappers over the STATELESS server routes.
// On-chain actions go through buildTx → (wallet signs) → submitTx; the
// orchestration lives in lib/wallet-flows.ts (useWalletFlows). Shapes: ./types.
"use client";
import type {
  ShipmentView, ActionResult, BuildTxReq, BuildTxRes, SubmitTxReq, SubmitTxRes,
  VerifyRes, FlyRes, SignPodReq, AuditRes, AttackReq, AttackRes, ShipmentReq,
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
  // stateless server work (no custody)
  faucet:       (address: string) => post<{ funded: boolean; balanceXlm: string | null }>("/api/faucet", { address }),
  verify:       (b: ShipmentReq)  => post<VerifyRes>("/api/carrier/verify", b),
  fly:          (b: ShipmentReq)  => post<FlyRes>("/api/drone/fly", b),
  proveDeliver: (b: ShipmentReq)  => post<{ ready: boolean }>("/api/prove-delivery", b),
  signPod:      (b: SignPodReq)   => post<{ signed: boolean }>("/api/recipient-pod", b),
  audit:        (b: ShipmentReq)  => post<AuditRes>("/api/confidential/audit", b),
  attack:       (b: AttackReq)    => post<AttackRes>("/api/attack", b),
  shipment:     (id: number)      => get<ShipmentView>(`/api/shipment/${id}`),
};
