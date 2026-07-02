"use client";

/**
 * Auth providers for the interactive demo.
 *
 * Two interchangeable modes, chosen once at build time by the presence of
 * NEXT_PUBLIC_PRIVY_APP_ID:
 *
 *   • privy  — real email / wallet / social login via @privy-io/react-auth.
 *   • guest  — zero-config fallback. `login()` flips a persisted local flag and
 *              the "user" is a synthetic { id: <guest uuid> }. The whole app
 *              works with no Privy app id, which is the demo's default.
 *
 * Both modes expose the SAME `useAuth()` shape so nothing downstream cares
 * which is active.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { PrivyProvider, usePrivy } from "@privy-io/react-auth";

export const MINT = "#4EF0B5";
const APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID;

export type AuthMode = "privy" | "guest";

export interface AuthUser {
  id: string;
  email?: string;
  wallet?: string;
}

export interface AuthState {
  ready: boolean;
  authenticated: boolean;
  user: AuthUser | null;
  login: () => void;
  logout: () => void;
  mode: AuthMode;
}

const FALLBACK: AuthState = {
  ready: false,
  authenticated: false,
  user: null,
  login: () => {},
  logout: () => {},
  mode: "guest",
};

const AuthContext = createContext<AuthState>(FALLBACK);

export function useAuth(): AuthState {
  return useContext(AuthContext);
}

// ── Privy mode ───────────────────────────────────────────────────────────────

function PrivyAuthBridge({ children }: { children: React.ReactNode }) {
  const { ready, authenticated, user, login, logout } = usePrivy();

  const value = useMemo<AuthState>(
    () => ({
      ready,
      authenticated,
      user: user
        ? {
            id: user.id,
            email: user.email?.address,
            wallet: user.wallet?.address,
          }
        : null,
      login: () => {
        login();
      },
      logout: () => {
        void logout();
      },
      mode: "privy",
    }),
    [ready, authenticated, user, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// ── Guest mode ───────────────────────────────────────────────────────────────

const GUEST_ID_KEY = "aegis-guest-id";
const GUEST_ENTERED_KEY = "aegis-guest-entered";

function GuestAuthProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [entered, setEntered] = useState(false);
  const [guestId, setGuestId] = useState<string | null>(null);

  // Restore any persisted guest session after mount. We deliberately render the
  // signed-out default on the server + first client paint (so hydration always
  // matches) and only then sync from localStorage — the canonical use of an
  // effect, so we opt this one out of the no-setState-in-effect heuristic.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    try {
      const id = window.localStorage.getItem(GUEST_ID_KEY);
      const wasEntered = window.localStorage.getItem(GUEST_ENTERED_KEY) === "1";
      if (id) setGuestId(id);
      if (id && wasEntered) setEntered(true);
    } catch {
      /* localStorage unavailable — degrade to a fresh in-memory guest */
    }
    setReady(true);
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  const login = useCallback(() => {
    let id: string | null = null;
    try {
      id = window.localStorage.getItem(GUEST_ID_KEY);
      if (!id) {
        id = crypto.randomUUID();
        window.localStorage.setItem(GUEST_ID_KEY, id);
      }
      window.localStorage.setItem(GUEST_ENTERED_KEY, "1");
    } catch {
      id = id ?? crypto.randomUUID();
    }
    setGuestId(id);
    setEntered(true);
  }, []);

  const logout = useCallback(() => {
    try {
      window.localStorage.removeItem(GUEST_ENTERED_KEY);
    } catch {
      /* ignore */
    }
    setEntered(false);
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      ready,
      authenticated: entered && !!guestId,
      user: entered && guestId ? { id: guestId } : null,
      login,
      logout,
      mode: "guest",
    }),
    [ready, entered, guestId, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// ── Root ─────────────────────────────────────────────────────────────────────

export default function Providers({ children }: { children: React.ReactNode }) {
  if (APP_ID) {
    return (
      <PrivyProvider
        appId={APP_ID}
        config={{
          loginMethods: ["email", "wallet", "google"],
          appearance: { theme: "dark", accentColor: MINT },
          embeddedWallets: {
            ethereum: { createOnLogin: "users-without-wallets" },
            solana: { createOnLogin: "users-without-wallets" },
          },
        }}
      >
        <PrivyAuthBridge>{children}</PrivyAuthBridge>
      </PrivyProvider>
    );
  }
  return <GuestAuthProvider>{children}</GuestAuthProvider>;
}
