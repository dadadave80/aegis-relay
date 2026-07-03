"use client";

/**
 * Console orchestrator. Gates on wallet connection (connect screen ↔ console).
 * Once a Stellar wallet is connected it lays out the top bar, role switcher,
 * per-role action panel and the persistent lifecycle board. The connected
 * wallet signs every on-chain action — no relayer.
 */

import { useWallet } from "@/lib/wallet-context";
import { useSession } from "@/lib/session-context";
import LoginScreen from "./LoginScreen";
import TopBar from "./TopBar";
import RoleSwitcher from "./RoleSwitcher";
import LifecycleBoard from "./LifecycleBoard";
import ActionPanel from "./RolePanels";
import { Spinner } from "./primitives";

export default function Console() {
  const { ready, stellarAddress } = useWallet();
  const { role } = useSession();

  if (!ready) {
    return (
      <div className="max-w-md mx-auto px-6 py-24 text-center">
        <Spinner size={20} />
      </div>
    );
  }

  if (!stellarAddress) return <LoginScreen />;

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
