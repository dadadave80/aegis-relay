"use client";

/**
 * Session context for the interactive demo console.
 *
 * With the console now non-custodial (the connected Privy Stellar wallet signs
 * every on-chain action — see lib/wallet-context.tsx), this context no longer
 * provisions or funds any server accounts. It owns only the console's *selection
 * state*: the acting role, the currently focused shipment (re-read from chain
 * after every mutation so the lifecycle board stays live), the merchant's
 * entered destination, and the last honest-flight result for the corridor map.
 *
 * Every network call goes through lib/api.ts, whose wrappers never throw —
 * failures surface as inline state, never a crashed page.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { api } from "./api";
import type { FlyRes, Role, ShipmentView } from "./types";

export interface DestPoint {
  lat: number;
  lon: number;
}

export interface SessionContextValue {
  role: Role;
  setRole: (r: Role) => void;

  currentShipmentId: number | null;
  setCurrentShipmentId: (id: number | null) => void;
  shipment: ShipmentView | null;
  shipmentLoading: boolean;

  /** Merchant-entered destination for the current shipment (recipient prefill). */
  createdDest: DestPoint | null;
  setCreatedDest: (id: number, dest: DestPoint) => void;

  /** Last honest flight result — drives the mini corridor map. */
  flyResult: FlyRes | null;
  setFlyResult: (r: FlyRes | null) => void;

  refreshShipment: () => Promise<void>;
  /** Optimistically apply a ShipmentView an action already returned. */
  applyView: (view: ShipmentView) => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used within <SessionProvider>");
  return ctx;
}

const SHIPMENT_KEY = "aegis-demo-shipment";
const ROLE_KEY = "aegis-demo-role";
const destKey = (id: number) => `aegis-demo-dest-${id}`;

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [role, setRoleState] = useState<Role>("merchant");
  const [currentShipmentId, setShipmentIdState] = useState<number | null>(null);
  const [shipment, setShipment] = useState<ShipmentView | null>(null);
  const [shipmentLoading, setShipmentLoading] = useState(false);
  const [createdDest, setCreatedDestState] = useState<DestPoint | null>(null);
  const [flyResult, setFlyResult] = useState<FlyRes | null>(null);

  // ── restore lightweight UI state (role + focused shipment) once ──────────────
  // Mount-time hydration from localStorage: render defaults first (matching SSR)
  // then sync — the canonical effect use, opted out of the heuristic.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    try {
      const r = window.localStorage.getItem(ROLE_KEY) as Role | null;
      if (r) setRoleState(r);
      const sid = window.localStorage.getItem(SHIPMENT_KEY);
      if (sid && /^\d+$/.test(sid)) setShipmentIdState(Number(sid));
    } catch {
      /* ignore */
    }
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  const setRole = useCallback((r: Role) => {
    setRoleState(r);
    try {
      window.localStorage.setItem(ROLE_KEY, r);
    } catch {
      /* ignore */
    }
  }, []);

  const setCurrentShipmentId = useCallback((id: number | null) => {
    setShipmentIdState(id);
    setFlyResult(null);
    try {
      if (id === null) window.localStorage.removeItem(SHIPMENT_KEY);
      else window.localStorage.setItem(SHIPMENT_KEY, String(id));
    } catch {
      /* ignore */
    }
  }, []);

  const setCreatedDest = useCallback((id: number, dest: DestPoint) => {
    setCreatedDestState(dest);
    try {
      window.localStorage.setItem(destKey(id), JSON.stringify(dest));
    } catch {
      /* ignore */
    }
  }, []);

  const refreshShipment = useCallback(async () => {
    if (currentShipmentId === null) {
      setShipment(null);
      return;
    }
    setShipmentLoading(true);
    const res = await api.shipment(currentShipmentId);
    if (res.ok && res.data) setShipment(res.data);
    setShipmentLoading(false);
  }, [currentShipmentId]);

  const applyView = useCallback((view: ShipmentView) => {
    setShipment(view);
  }, []);

  // ── re-read the focused shipment whenever it changes ────────────────────────
  // Loads the persisted destination + re-reads chain state on id change.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (currentShipmentId === null) {
      setShipment(null);
      setCreatedDestState(null);
      return;
    }
    try {
      const raw = window.localStorage.getItem(destKey(currentShipmentId));
      setCreatedDestState(raw ? (JSON.parse(raw) as DestPoint) : null);
    } catch {
      setCreatedDestState(null);
    }
    void refreshShipment();
  }, [currentShipmentId, refreshShipment]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const value = useMemo<SessionContextValue>(
    () => ({
      role,
      setRole,
      currentShipmentId,
      setCurrentShipmentId,
      shipment,
      shipmentLoading,
      createdDest,
      setCreatedDest,
      flyResult,
      setFlyResult,
      refreshShipment,
      applyView,
    }),
    [
      role,
      setRole,
      currentShipmentId,
      setCurrentShipmentId,
      shipment,
      shipmentLoading,
      createdDest,
      setCreatedDest,
      flyResult,
      refreshShipment,
      applyView,
    ],
  );

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}
