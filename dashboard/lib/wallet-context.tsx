"use client";

/**
 * Wallet context — a real Stellar wallet (Freighter / Albedo / xBull / Lobstr /
 * Hana / Rabet) connected via Stellar Wallets Kit is the single on-chain
 * identity + custody for the console. No server keys: the kit signs the full
 * Soroban transaction XDR the server builds, and the server just submits it.
 *
 * The kit is browser-only (custom elements + window), so it is imported LAZILY
 * inside client-only code paths — never at module top — to keep SSR clean.
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
import { api } from "./api";

const PASSPHRASE = "Test SDF Network ; September 2015";
const LS_KEY = "aegis-wallet-address";

export interface WalletState {
  /** Connected Stellar wallet address (G…), or null when not connected. */
  stellarAddress: string | null;
  ready: boolean;
  connecting: boolean;
  funded: boolean;
  balanceXlm: string | null;
  /** Open the Stellar Wallets Kit modal to pick + connect a wallet. */
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  ensureFunded: () => Promise<void>;
  refreshBalance: () => Promise<void>;
  /**
   * Sign a prepared Soroban tx XDR with the connected wallet. Pops the wallet's
   * signing UI — that confirmation IS the on-chain authorization. Returns the
   * full signed tx XDR (kit `signTransaction` → `signedTxXdr`).
   */
  signTx: (xdr: string) => Promise<string>;
}

const FALLBACK: WalletState = {
  stellarAddress: null,
  ready: false,
  connecting: false,
  funded: false,
  balanceXlm: null,
  connect: async () => {},
  disconnect: async () => {},
  ensureFunded: async () => {},
  refreshBalance: async () => {},
  signTx: async () => {
    throw new Error("Connect a Stellar wallet to sign");
  },
};

const WalletContext = createContext<WalletState>(FALLBACK);

export function useWallet(): WalletState {
  return useContext(WalletContext);
}

// ── Kit singleton (lazy, browser-only) ───────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */
let kitPromise: Promise<any> | null = null;
async function getKit(): Promise<any> {
  if (!kitPromise) {
    kitPromise = (async () => {
      const { StellarWalletsKit, Networks } = await import(
        "@creit.tech/stellar-wallets-kit"
      );
      const [
        { FreighterModule },
        { AlbedoModule },
        { xBullModule },
        { LobstrModule },
        { HanaModule },
        { RabetModule },
      ] = await Promise.all([
        import("@creit.tech/stellar-wallets-kit/modules/freighter"),
        import("@creit.tech/stellar-wallets-kit/modules/albedo"),
        import("@creit.tech/stellar-wallets-kit/modules/xbull"),
        import("@creit.tech/stellar-wallets-kit/modules/lobstr"),
        import("@creit.tech/stellar-wallets-kit/modules/hana"),
        import("@creit.tech/stellar-wallets-kit/modules/rabet"),
      ]);
      StellarWalletsKit.init({
        network: Networks.TESTNET,
        modules: [
          new FreighterModule(),
          new AlbedoModule(),
          new xBullModule(),
          new LobstrModule(),
          new HanaModule(),
          new RabetModule(),
        ],
      });
      return StellarWalletsKit;
    })();
  }
  return kitPromise;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// ── Provider ─────────────────────────────────────────────────────────────────

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [stellarAddress, setStellarAddress] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [funded, setFunded] = useState(false);
  const [balanceXlm, setBalanceXlm] = useState<string | null>(null);
  const ensuredRef = useRef<string | null>(null);

  const applyFaucet = useCallback(async (addr: string | null) => {
    const a = addr ?? stellarAddress;
    if (!a) return;
    const r = await api.faucet(a);
    if (r.ok && r.data) {
      setFunded(r.data.funded);
      setBalanceXlm(r.data.balanceXlm);
    }
  }, [stellarAddress]);

  const ensureFunded = useCallback(async () => {
    if (!stellarAddress) return;
    if (ensuredRef.current === stellarAddress) return;
    ensuredRef.current = stellarAddress;
    await applyFaucet(stellarAddress);
  }, [stellarAddress, applyFaucet]);

  // Restore a previously connected wallet on mount (the kit persists the chosen
  // wallet; getAddress() re-reads it). Best-effort — silent if none.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const saved = typeof window !== "undefined" ? window.localStorage.getItem(LS_KEY) : null;
      if (saved) {
        try {
          const kit = await getKit();
          const { address } = await kit.getAddress();
          if (!cancelled && address) setStellarAddress(address);
        } catch {
          if (!cancelled) window.localStorage.removeItem(LS_KEY);
        }
      }
      if (!cancelled) setReady(true);
    })();
    return () => { cancelled = true; };
  }, []);

  // Auto-faucet once whenever a wallet becomes connected.
  useEffect(() => {
    if (stellarAddress) void ensureFunded();
  }, [stellarAddress, ensureFunded]);

  const connect = useCallback(async () => {
    setConnecting(true);
    try {
      const kit = await getKit();
      const { address } = await kit.authModal();
      if (address) {
        window.localStorage.setItem(LS_KEY, address);
        setStellarAddress(address);
      }
    } finally {
      setConnecting(false);
    }
  }, []);

  const disconnect = useCallback(async () => {
    try {
      const kit = await getKit();
      await kit.disconnect();
    } catch {
      /* ignore */
    }
    window.localStorage.removeItem(LS_KEY);
    ensuredRef.current = null;
    setStellarAddress(null);
    setFunded(false);
    setBalanceXlm(null);
  }, []);

  const signTx = useCallback(
    async (xdr: string): Promise<string> => {
      if (!stellarAddress) throw new Error("Connect a Stellar wallet to sign");
      const kit = await getKit();
      const { signedTxXdr } = await kit.signTransaction(xdr, {
        address: stellarAddress,
        networkPassphrase: PASSPHRASE,
      });
      return signedTxXdr;
    },
    [stellarAddress],
  );

  const value = useMemo<WalletState>(
    () => ({
      stellarAddress,
      ready,
      connecting,
      funded,
      balanceXlm,
      connect,
      disconnect,
      ensureFunded,
      refreshBalance: () => applyFaucet(null),
      signTx,
    }),
    [stellarAddress, ready, connecting, funded, balanceXlm, connect, disconnect, ensureFunded, applyFaucet, signTx],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}
