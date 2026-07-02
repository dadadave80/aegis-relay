"use client";

/**
 * Wallet context — the connected Privy embedded **Stellar** wallet is the
 * single source of on-chain identity + custody for the console. No server keys.
 *
 * Two interchangeable modes, mirroring app/providers.tsx:
 *
 *   • privy  — reads the user's Stellar wallet from `user.linkedAccounts`
 *              (type "wallet", chainType "stellar"), auto-faucets it on connect,
 *              and signs 32-byte tx hashes with `useSignRawHash` (extended-chains).
 *   • guest  — no wallet. `stellarAddress` stays null and on-chain actions are
 *              gated with a "connect wallet" prompt (the board still browses).
 *
 * Both expose the SAME `useWallet()` shape so nothing downstream cares which is
 * active. Every network call goes through lib/api.ts, whose wrappers never throw.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { usePrivy } from "@privy-io/react-auth";
import type { WalletWithMetadata } from "@privy-io/react-auth";
import { useSignRawHash } from "@privy-io/react-auth/extended-chains";
import { api } from "./api";
import { useAuth } from "@/app/providers";

export interface WalletState {
  /** Connected Privy Stellar wallet address (G…), or null when not provisioned. */
  stellarAddress: string | null;
  /** Whether the wallet layer has finished its initial load. */
  ready: boolean;
  /** Friendbot-funded (has an XLM balance) — drives the funding chip. */
  funded: boolean;
  /** Human XLM balance string, or null before the first faucet/read. */
  balanceXlm: string | null;
  /** Auto-faucet the connected address once on connect + refresh the balance. */
  ensureFunded: () => Promise<void>;
  /** Re-read the balance (via the faucet route, which is fund-if-needed). */
  refreshBalance: () => Promise<void>;
  /**
   * Sign a raw 32-byte tx hash (hex, with or without 0x) with the Stellar
   * wallet. Pops the Privy signing UI — that confirmation IS the wallet
   * authorizing the transaction. Returns the 64-byte ed25519 signature as hex
   * (no 0x). Throws when no wallet is connected.
   */
  signHash: (hashHex: string) => Promise<string>;
}

const FALLBACK: WalletState = {
  stellarAddress: null,
  ready: false,
  funded: false,
  balanceXlm: null,
  ensureFunded: async () => {},
  refreshBalance: async () => {},
  signHash: async () => {
    throw new Error("Connect a Stellar wallet to sign");
  },
};

const WalletContext = createContext<WalletState>(FALLBACK);

export function useWallet(): WalletState {
  return useContext(WalletContext);
}

// ── Privy mode ───────────────────────────────────────────────────────────────

function PrivyWalletBridge({ children }: { children: React.ReactNode }) {
  const { ready, authenticated, user } = usePrivy();
  const { signRawHash } = useSignRawHash();

  const stellarAddress = useMemo<string | null>(() => {
    const acct = user?.linkedAccounts?.find(
      (a): a is WalletWithMetadata =>
        a.type === "wallet" && a.chainType === "stellar",
    );
    return acct?.address ?? null;
  }, [user]);

  const [funded, setFunded] = useState(false);
  const [balanceXlm, setBalanceXlm] = useState<string | null>(null);
  const ensuredRef = useRef<string | null>(null);

  const applyFaucet = useCallback(async () => {
    if (!stellarAddress) return;
    const r = await api.faucet(stellarAddress);
    if (r.ok && r.data) {
      setFunded(r.data.funded);
      setBalanceXlm(r.data.balanceXlm);
    }
  }, [stellarAddress]);

  const ensureFunded = useCallback(async () => {
    if (!stellarAddress) return;
    if (ensuredRef.current === stellarAddress) return;
    ensuredRef.current = stellarAddress;
    await applyFaucet();
  }, [stellarAddress, applyFaucet]);

  // Auto-faucet on connect: fund the freshly provisioned wallet once so it can
  // pay tx fees, then surface the balance. Async setState (not synchronous in
  // the effect body), so exempt from the no-setState-in-effect heuristic.
  useEffect(() => {
    if (authenticated && stellarAddress) void ensureFunded();
  }, [authenticated, stellarAddress, ensureFunded]);

  const signHash = useCallback(
    async (hashHex: string): Promise<string> => {
      if (!stellarAddress) throw new Error("Connect a Stellar wallet to sign");
      const hash = (
        hashHex.startsWith("0x") ? hashHex : `0x${hashHex}`
      ) as `0x${string}`;
      const { signature } = await signRawHash({
        address: stellarAddress,
        chainType: "stellar",
        hash,
      });
      return signature.startsWith("0x") ? signature.slice(2) : signature;
    },
    [stellarAddress, signRawHash],
  );

  const value = useMemo<WalletState>(
    () => ({
      stellarAddress,
      ready,
      funded,
      balanceXlm,
      ensureFunded,
      refreshBalance: applyFaucet,
      signHash,
    }),
    [stellarAddress, ready, funded, balanceXlm, ensureFunded, applyFaucet, signHash],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

// ── Guest mode ───────────────────────────────────────────────────────────────

function GuestWalletProvider({ children }: { children: React.ReactNode }) {
  const value = useMemo<WalletState>(
    () => ({
      stellarAddress: null,
      ready: true,
      funded: false,
      balanceXlm: null,
      ensureFunded: async () => {},
      refreshBalance: async () => {},
      signHash: async () => {
        throw new Error(
          "Wallet signing needs a Privy app id (NEXT_PUBLIC_PRIVY_APP_ID)",
        );
      },
    }),
    [],
  );
  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

// ── Root ─────────────────────────────────────────────────────────────────────

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const { mode } = useAuth();
  // `mode` is fixed for the session (chosen by NEXT_PUBLIC_PRIVY_APP_ID at build
  // time), so this branch never flips — each subtree keeps stable hook order.
  if (mode === "privy") {
    return <PrivyWalletBridge>{children}</PrivyWalletBridge>;
  }
  return <GuestWalletProvider>{children}</GuestWalletProvider>;
}
