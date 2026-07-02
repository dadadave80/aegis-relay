// Client-side API wrapper — the console (app/demo/**) calls these; the server
// (app/api/**) implements the matching routes. Shapes come from ./types.
"use client";
import type {
  SessionInfo, ShipmentView, ActionResult, CreateReq, CreateRes,
  ShipmentReq, VerifyRes, FlyRes, SignPodReq, AuditRes, AttackReq, AttackRes,
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

/** localStorage-persisted session id (Privy user id when logged in, else uuid). */
export function ensureSessionId(seed?: string): string {
  if (typeof window === "undefined") return "";
  const KEY = "aegis-demo-session";
  if (seed) { window.localStorage.setItem(KEY, seed); return seed; }
  let id = window.localStorage.getItem(KEY);
  if (!id) { id = crypto.randomUUID(); window.localStorage.setItem(KEY, id); }
  return id;
}

export const api = {
  session:      (sessionId: string) => post<SessionInfo>("/api/session", { sessionId }),
  refresh:      (sessionId: string) => get<SessionInfo>(`/api/session?sessionId=${encodeURIComponent(sessionId)}`),
  create:       (body: CreateReq)   => post<CreateRes>("/api/merchant/create", body),
  verify:       (body: ShipmentReq) => post<VerifyRes>("/api/carrier/verify", body),
  accept:       (body: ShipmentReq) => post<ShipmentView>("/api/carrier/accept", body),
  fly:          (body: ShipmentReq) => post<FlyRes>("/api/drone/fly", body),
  submitFlight: (body: ShipmentReq) => post<ShipmentView>("/api/drone/submit", body),
  signPod:      (body: SignPodReq)  => post<{ signed: boolean }>("/api/recipient/sign-pod", body),
  proveDeliver: (body: ShipmentReq) => post<{ ready: boolean }>("/api/carrier/prove-deliver", body),
  deliver:      (body: ShipmentReq) => post<ShipmentView>("/api/carrier/deliver", body),
  audit:        (body: ShipmentReq) => post<AuditRes>("/api/confidential/audit", body),
  attack:       (body: AttackReq)   => post<AttackRes>("/api/attack", body),
  shipment:     (id: number)        => get<ShipmentView>(`/api/shipment/${id}`),
};
