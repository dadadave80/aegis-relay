"use client";

/**
 * Console orchestrator. Gates on auth (login screen ↔ console), shows the
 * friendbot funding state on first entry, then lays out the top bar, role
 * switcher, per-role action panel and the persistent lifecycle board.
 */

import { useAuth } from "@/app/providers";
import { useSession } from "@/lib/session-context";
import LoginScreen from "./LoginScreen";
import TopBar from "./TopBar";
import RoleSwitcher from "./RoleSwitcher";
import LifecycleBoard from "./LifecycleBoard";
import ActionPanel from "./RolePanels";
import { Spinner } from "./primitives";

function FundingScreen() {
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
        Funding testnet accounts…
      </h1>
      <p className="text-sm mt-2 leading-relaxed" style={{ color: "var(--text-dim)" }}>
        Minting per-session merchant and carrier keypairs and topping them up via
        friendbot. This takes a few seconds — no wallet, no extension, no popups.
      </p>
    </div>
  );
}

function SessionErrorBanner({ detail }: { detail: string }) {
  return (
    <div
      className="card p-4 text-sm"
      style={{ borderColor: "color-mix(in srgb, var(--amber) 40%, transparent)" }}
    >
      <span className="font-semibold" style={{ color: "var(--amber)" }}>
        Testnet accounts unavailable.
      </span>{" "}
      <span style={{ color: "var(--text-dim)" }}>
        {detail} — the console still works; live balances and on-chain actions
        will retry once the backend is reachable.
      </span>
    </div>
  );
}

export default function Console() {
  const { ready, authenticated } = useAuth();
  const { role, sessionStatus, session, sessionError } = useSession();

  if (!ready) {
    return (
      <div className="max-w-md mx-auto px-6 py-24 text-center">
        <Spinner size={20} />
      </div>
    );
  }

  if (!authenticated) return <LoginScreen />;

  const firstProvision =
    !session && (sessionStatus === "idle" || sessionStatus === "funding");
  if (firstProvision) return <FundingScreen />;

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-6">
      <div className="demo-fade-up" style={{ animationDelay: "0ms" }}>
        <TopBar />
      </div>

      {sessionStatus === "error" && sessionError && (
        <SessionErrorBanner detail={sessionError} />
      )}

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
