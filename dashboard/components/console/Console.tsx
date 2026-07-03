"use client";

/**
 * Console orchestrator. Gates on wallet connection (connect screen ↔ console),
 * then on a first-connect role pick. Once a Stellar wallet is connected it reads
 * the wallet's on-chain role binding + active service count (plan 001) and either
 * prompts a role via <RoleModal> (first connect) or lays out the top bar, role
 * switcher, per-role action panel and the persistent lifecycle board. The
 * connected wallet signs every on-chain action — no relayer.
 */

import { useEffect, useState } from "react";
import { useWallet } from "@/lib/wallet-context";
import { useSession } from "@/lib/session-context";
import { parseClaimedId } from "@/lib/console/deep-link";
import { api } from "@/lib/api";
import LoginScreen from "./LoginScreen";
import TopBar from "./TopBar";
import RoleSwitcher from "./RoleSwitcher";
import LifecycleBoard from "./LifecycleBoard";
import ActionPanel from "./RolePanels";
import RoleModal from "./RoleModal";
import { Spinner } from "./primitives";

export default function Console() {
  const { ready, stellarAddress } = useWallet();
  const {
    role, hasChosenRole, chooseRole, syncChosen, setActiveCount, shipment,
    toggleLens, setCurrentShipmentId, setRole,
  } = useSession();

  // Ledger Lens — key `L` re-renders the console as the chain sees it. Ignored
  // while typing in a field so it never fights text entry.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "l" && e.key !== "L") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      toggleLens();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleLens]);

  // Deep-link back from the market: `/console?claimed=<id>` (Task 11) focuses the
  // just-claimed shipment and switches to the Carrier station so Accept is
  // unlocked. One-shot on mount; the param is stripped so a refresh won't re-fire.
  // Both this write and SessionProvider's localStorage-restore write SHIPMENT_KEY,
  // so the focused id converges to <id> regardless of effect order.
  useEffect(() => {
    const id = parseClaimedId(window.location.search);
    if (id === null) return;
    setRole("carrier");
    setCurrentShipmentId(id);
    const url = new URL(window.location.href);
    url.searchParams.delete("claimed");
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }, [setRole, setCurrentShipmentId]);

  // Which address we have finished reading role info for — gates the modal so it
  // never flashes for a wallet that already has a (client- or chain-) role.
  const [checkedFor, setCheckedFor] = useState<string | null>(null);

  // Read role_of + active_count for the connected wallet on connect and after
  // every lifecycle mutation (`shipment` changes when an action re-reads chain
  // state), so the modal reflects an already-bound role and the switcher gate
  // unlocks promptly once a shipment reaches a terminal state.
  useEffect(() => {
    if (!stellarAddress) return;
    let cancelled = false;
    void (async () => {
      const res = await api.roleInfo(stellarAddress);
      if (cancelled) return;
      if (res.ok && res.data) {
        syncChosen(stellarAddress, res.data.role);
        setActiveCount(res.data.activeCount);
      } else {
        syncChosen(stellarAddress, null);
      }
      setCheckedFor(stellarAddress);
    })();
    return () => {
      cancelled = true;
    };
  }, [stellarAddress, shipment, syncChosen, setActiveCount]);

  if (!ready) {
    return (
      <div className="max-w-md mx-auto px-6 py-24 text-center">
        <Spinner size={20} />
      </div>
    );
  }

  if (!stellarAddress) return <LoginScreen />;

  // Wallet connected but the first role read for it is still in flight — hold a
  // spinner rather than flash the modal at a wallet that has already chosen.
  if (checkedFor !== stellarAddress && !hasChosenRole) {
    return (
      <div className="max-w-md mx-auto px-6 py-24 text-center">
        <Spinner size={20} />
      </div>
    );
  }

  if (!hasChosenRole) {
    return <RoleModal onPick={(r) => chooseRole(stellarAddress, r)} />;
  }

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
