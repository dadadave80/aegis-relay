"use client";

/**
 * Console orchestrator. Gates on auth (login screen ↔ console) and, in Privy
 * mode, on the embedded Stellar wallet being provisioned. Once connected it
 * lays out the top bar, role switcher, per-role action panel and the persistent
 * lifecycle board. The connected wallet signs every on-chain action — no relayer.
 */

import { useAuth } from "@/app/providers";
import { useWallet } from "@/lib/wallet-context";
import { useSession } from "@/lib/session-context";
import LoginScreen from "./LoginScreen";
import TopBar from "./TopBar";
import RoleSwitcher from "./RoleSwitcher";
import LifecycleBoard from "./LifecycleBoard";
import ActionPanel from "./RolePanels";
import { Spinner } from "./primitives";

function ProvisioningScreen() {
  return (
    <div className="max-w-md mx-auto px-6 py-24 text-center">
      <div
        className="inline-flex items-center justify-center w-14 h-14 rounded-2xl mb-5"
        style={{
          color: "var(--mint)",
          background: "color-mix(in srgb, var(--mint) 10%, transparent)",
          border: "1px solid color-mix(in srgb, var(--mint) 30%, transparent)",
        }}
      >
        <Spinner size={22} />
      </div>
      <h1 className="text-xl font-semibold tracking-tight">
        Provisioning your Stellar wallet…
      </h1>
      <p className="text-sm mt-2 leading-relaxed" style={{ color: "var(--text-dim)" }}>
        Creating a non-custodial embedded wallet and topping it up via friendbot.
        You hold the keys — every on-chain action is signed by this wallet, never
        a server. This takes a few seconds.
      </p>
    </div>
  );
}

export default function Console() {
  const { ready, authenticated, mode } = useAuth();
  const { stellarAddress } = useWallet();
  const { role } = useSession();

  if (!ready) {
    return (
      <div className="max-w-md mx-auto px-6 py-24 text-center">
        <Spinner size={20} />
      </div>
    );
  }

  if (!authenticated) return <LoginScreen />;

  // In Privy mode the Stellar wallet is provisioned right after login; wait for
  // it before showing the console. Guest mode has no wallet — browse read-only.
  if (mode === "privy" && !stellarAddress) return <ProvisioningScreen />;

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-6">
      <div className="demo-fade-up" style={{ animationDelay: "0ms" }}>
        <TopBar />
      </div>

      <div className="demo-fade-up" style={{ animationDelay: "60ms" }}>
        <RoleSwitcher />
      </div>

      <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] gap-6 items-start">
        <div className="demo-fade-up" style={{ animationDelay: "120ms" }}>
          <ActionPanel role={role} />
        </div>
        <div className="demo-fade-up lg:sticky lg:top-6" style={{ animationDelay: "180ms" }}>
          <LifecycleBoard />
        </div>
      </div>
    </div>
  );
}
