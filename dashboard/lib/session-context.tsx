"use client";

/**
 * Session context for the console.
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

  /** True once the user has picked a role for the connected wallet. */
  hasChosenRole: boolean;
  /** Record the pick for a wallet (persists per-address) + set role + mark chosen. */
  chooseRole: (address: string, r: Role) => void;
  /** Reconcile hasChosenRole/role for the connected wallet (call on connect):
   *  an on-chain role wins; else a per-wallet stored pick; else unbound. */
  syncChosen: (address: string | null, onchainRole: Role | null) => void;

  /** The connected wallet's active on-chain service count — gates role switching. */
  activeCount: number;
  setActiveCount: (n: number) => void;

  /** Ledger Lens — when on, private data renders as the chain sees it. Key `L`. */
  lens: boolean;
  toggleLens: () => void;

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
/** Per-wallet "has picked a role" marker (stores the chosen role). */
const chosenKey = (address: string) => `aegis-role-chosen-${address}`;
const VALID_ROLES: readonly Role[] = ["merchant", "carrier", "recipient", "auditor"];

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [role, setRoleState] = useState<Role>("merchant");
  const [hasChosenRole, setHasChosenRole] = useState(false);
  const [activeCount, setActiveCount] = useState(0);
  const [lens, setLens] = useState(false);
  const toggleLens = useCallback(() => setLens((v) => !v), []);
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
      const r = window.localStorage.getItem(ROLE_KEY);
      if (r && (VALID_ROLES as readonly string[]).includes(r)) setRoleState(r as Role);
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

  // Record the wallet's role pick (client-side; the contract auto-binds on the
  // first create/accept). Persists per-address so the modal stays dismissed.
  const chooseRole = useCallback(
    (address: string, r: Role) => {
      setRole(r);
      setHasChosenRole(true);
      try {
        window.localStorage.setItem(chosenKey(address), r);
      } catch {
        /* ignore */
      }
    },
    [setRole],
  );

  // Reconcile chosen-role state for the connected wallet: an on-chain-bound role
  // is authoritative; else fall back to a per-wallet stored pick; else unbound
  // (the modal will prompt).
  const syncChosen = useCallback(
    (address: string | null, onchainRole: Role | null) => {
      if (!address) {
        setHasChosenRole(false);
        return;
      }
      if (onchainRole) {
        setRole(onchainRole);
        setHasChosenRole(true);
        try {
          window.localStorage.setItem(chosenKey(address), onchainRole);
        } catch {
          /* ignore */
        }
        return;
      }
      let stored: string | null = null;
      try {
        stored = window.localStorage.getItem(chosenKey(address));
      } catch {
        /* ignore */
      }
      if (stored && (VALID_ROLES as readonly string[]).includes(stored)) {
        setRole(stored as Role);
        setHasChosenRole(true);
      } else {
        setHasChosenRole(false);
      }
    },
    [setRole],
  );

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
      hasChosenRole,
      chooseRole,
      syncChosen,
      activeCount,
      setActiveCount,
      lens,
      toggleLens,
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
      hasChosenRole,
      chooseRole,
      syncChosen,
      activeCount,
      lens,
      toggleLens,
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
