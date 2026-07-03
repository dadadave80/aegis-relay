"use client";

/**
 * /market — the carrier-facing marketplace board (Task 7). Browsing is public
 * (spec §9): the board loads and polls with no wallet connected. Claiming a
 * shipment binds it to a caller identity, so <WalletProvider> is mounted here
 * (scoped to this route, same pattern as app/console/page.tsx) purely to read
 * the connected address for api.market.claim — no on-chain signing happens on
 * this page.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Stamp, type StampTone } from "@/components/ds/Stamp";
import { Button } from "@/components/ds/Button";
import { Segmented } from "@/components/ds/Segmented";
import { ToastProvider, useToast } from "@/components/console/toast";
import { WalletProvider, useWallet } from "@/lib/wallet-context";
import { api } from "@/lib/api";
import type { Listing, Method, ShipmentState } from "@/lib/types";
import {
  filterListings,
  newlyAppeared,
  utcDay,
  EMPTY_FILTERS,
  type BoardFilters,
} from "@/lib/market/board";

const POLL_MS = 8000;
const GRID = "70px 110px 70px 150px 120px 110px";

// Toast enter animation — the console defines these keyframes in its layout;
// /market is a standalone route, so it ships its own copy.
const FADE_CSS = `
@keyframes demoFadeUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
.demo-fade-up { animation: demoFadeUp 0.4s cubic-bezier(0.2,0,0,1) both; }`;

const STATE_TONE: Record<ShipmentState, StampTone> = {
  OPEN: "chain",
  IN_TRANSIT: "ink",
  DELIVERED: "verified",
  EXPIRED: "danger",
  UNKNOWN: "dim",
};

const inputStyle: CSSProperties = {
  minHeight: 38,
  padding: "8px 10px",
  background: "var(--void-1)",
  border: "1px solid var(--hairline)",
  borderRadius: "var(--r-control)",
  color: "var(--ink)",
  fontSize: "var(--text-sm)",
  width: 120,
};

/** The onboarding CTA shape returned inline in a non-credentialed claim result
 *  (lib/market/claim-gate.ts CARRIER_ONBOARD_CTA) — rendered verbatim, not
 *  hardcoded, since Task 8 owns its copy. */
interface OnboardCta {
  title: string;
  cta: string;
  href: string;
}

export default function MarketPage() {
  return (
    <WalletProvider>
      <ToastProvider>
        <style dangerouslySetInnerHTML={{ __html: FADE_CSS }} />
        <MarketBoard />
      </ToastProvider>
    </WalletProvider>
  );
}

function MarketBoard() {
  const router = useRouter();
  const { toast } = useToast();
  const { stellarAddress, connect, connecting } = useWallet();

  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [claiming, setClaiming] = useState<number | null>(null);
  const [onboardCta, setOnboardCta] = useState<OnboardCta | null>(null);
  const [filters, setFilters] = useState<BoardFilters>({ ...EMPTY_FILTERS });
  // `Date.now()` is impure (react-hooks/purity), so "now" lives in state,
  // refreshed only from inside the poll effect below — never read at render time.
  const [nowSec, setNowSec] = useState(0);
  const seenRef = useRef<number[] | null>(null);

  // Poll api.market.list() on an interval. The fetch + its setState calls are
  // wrapped in a plain (not useCallback'd) async closure defined and invoked
  // directly inside the effect — the same shape as Console.tsx's role-info
  // effect — so react-hooks/set-state-in-effect doesn't (mis)read this as
  // "setState synchronously in the effect body" (it isn't: everything here
  // runs after the internal `await`, in response to the poll tick).
  useEffect(() => {
    let cancelled = false;
    const tick = () => {
      void (async () => {
        const res = await api.market.list();
        if (cancelled) return;
        if (!res.ok) {
          setError(res.error ?? "Could not reach the board");
          setLoading(false);
          return;
        }
        const next = res.data ?? [];
        setError(null);
        setListings(next);
        setLoading(false);
        setNowSec(Math.floor(Date.now() / 1000));
        const nextIds = next.map((l) => l.shipmentId);
        const fresh = newlyAppeared(seenRef.current, nextIds);
        seenRef.current = nextIds;
        if (fresh.length > 0) {
          toast({
            tone: "mint",
            title: fresh.length === 1 ? "New shipment on the board" : `${fresh.length} new shipments`,
            detail: `#${fresh.join(", #")} just opened — claim before another carrier does.`,
          });
        }
      })();
    };
    tick();
    const t = window.setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, [toast]);

  const rows = useMemo(
    () => filterListings(listings, filters, nowSec).sort((a, b) => b.createdAt - a.createdAt),
    [listings, filters, nowSec],
  );

  const onClaim = useCallback(
    async (id: number) => {
      if (!stellarAddress) {
        // Row buttons only call onClaim once connected (see render below), but
        // guard anyway — a stale closure or fast double-click shouldn't crash.
        toast({ tone: "amber", title: "Connect a wallet first", detail: "Claiming binds this shipment to your on-chain identity." });
        return;
      }
      setClaiming(id);
      try {
        const res = await api.market.claim(id, stellarAddress);
        if (!res.ok || !res.data) {
          toast({ tone: "red", title: `Couldn't claim #${id}`, detail: res.error ?? "Try another shipment." });
          return;
        }
        if (res.data.credentialed) {
          setOnboardCta(null);
          toast({ tone: "mint", title: `Claimed #${id}`, detail: "Verify T12 and accept custody in the console." });
          router.push(`/console?claimed=${id}`);
          return;
        }
        setOnboardCta(res.data.onboard);
        toast({
          tone: "amber",
          title: res.data.onboard.title,
          detail: "This wallet isn't a credentialed carrier yet.",
        });
      } finally {
        setClaiming(null);
      }
    },
    [stellarAddress, router, toast],
  );

  const setLane = (v: string) => {
    const n = Number(v);
    setFilters((f) => ({ ...f, laneId: v === "" || Number.isNaN(n) ? null : n }));
  };
  const setMin = (v: string) => {
    const n = Number(v);
    setFilters((f) => ({ ...f, minAmount: v === "" || Number.isNaN(n) ? null : n }));
  };

  const shortAddr = stellarAddress ? `${stellarAddress.slice(0, 4)}…${stellarAddress.slice(-4)}` : null;

  return (
    <div className="mx-auto" style={{ maxWidth: 1000, padding: "40px 24px 72px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap", marginBottom: 6 }}>
        <h1 className="display" style={{ margin: 0, fontSize: "var(--text-xl)" }}>Open shipments</h1>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 12 }}>
          {shortAddr ? (
            <Stamp tone="chain">{shortAddr}</Stamp>
          ) : (
            <Button
              variant="ghost"
              loading={connecting}
              loadingLabel="Connecting…"
              onClick={() => void connect()}
              style={{ minHeight: 32, padding: "6px 12px", fontSize: "var(--text-xs)" }}
            >
              Connect wallet
            </Button>
          )}
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <span aria-hidden style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--verified)" }} />
            <Stamp tone="dim">Live · polling every {POLL_MS / 1000}s</Stamp>
          </span>
        </span>
      </div>
      <p style={{ margin: "0 0 20px", fontSize: "var(--text-sm)", color: "var(--ink-dim)", lineHeight: "var(--lh-body)", maxWidth: 640 }}>
        Every row is an on-chain OPEN escrow. The board shows only what the chain already exposes —
        method, lane, deadline, and (transparent rail only) the escrow. Claim one to pull its sealed
        packet and accept custody first-come.
      </p>

      {onboardCta && (
        <div className="panel-cold" style={{ padding: 16, marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", borderColor: "rgba(240,180,76,0.4)" }}>
          <div>
            <Stamp tone="caution">{onboardCta.title}</Stamp>
            <p style={{ margin: "4px 0 0", fontSize: "var(--text-sm)", color: "var(--ink-dim)" }}>
              Only credentialed carriers can pull a packet and accept custody.
            </p>
          </div>
          <Link href={onboardCta.href} style={{ textDecoration: "none" }}>
            <Button variant="seal">{onboardCta.cta}</Button>
          </Link>
        </div>
      )}

      <div className="panel-cold" style={{ padding: 14, marginBottom: 16, display: "flex", gap: 18, alignItems: "flex-end", flexWrap: "wrap" }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <Stamp tone="dim">Lane</Stamp>
          <input className="mono" inputMode="numeric" placeholder="any" value={filters.laneId ?? ""} onChange={(e) => setLane(e.target.value)} style={inputStyle} />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <Stamp tone="dim">Min escrow (XLM)</Stamp>
          <input className="mono" inputMode="decimal" placeholder="any" value={filters.minAmount ?? ""} onChange={(e) => setMin(e.target.value)} style={inputStyle} />
        </label>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <Stamp tone="dim">Method</Stamp>
          <Segmented<"all" | Method>
            value={filters.method}
            size="sm"
            options={[
              { value: "all", label: "All" },
              { value: "courier", label: "Courier" },
              { value: "drone", label: "Drone" },
            ]}
            onChange={(m) => setFilters((f) => ({ ...f, method: m }))}
          />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <Stamp tone="dim">Deadline</Stamp>
          <Segmented<"any" | "24" | "72">
            value={filters.withinHours === null ? "any" : (String(filters.withinHours) as "24" | "72")}
            size="sm"
            options={[
              { value: "any", label: "Any" },
              { value: "24", label: "≤24h" },
              { value: "72", label: "≤72h" },
            ]}
            onChange={(v) => setFilters((f) => ({ ...f, withinHours: v === "any" ? null : Number(v) }))}
          />
        </div>
      </div>

      {error && (
        <div className="panel-cold" style={{ padding: 14, marginBottom: 16, borderColor: "rgba(255,92,92,0.4)" }}>
          <Stamp tone="danger">Board unreachable</Stamp>
          <p style={{ margin: "4px 0 0", fontSize: "var(--text-sm)", color: "var(--ink-dim)" }}>
            {error} — retrying every {POLL_MS / 1000}s.
          </p>
        </div>
      )}

      {rows.length > 0 ? (
        <div style={{ overflowX: "auto" }}>
          <div style={{ minWidth: 720 }}>
            <div style={{ display: "grid", gridTemplateColumns: GRID, gap: 12, padding: "0 14px 8px" }}>
              <Stamp tone="dim">#</Stamp>
              <Stamp tone="dim">Method</Stamp>
              <Stamp tone="dim">Lane</Stamp>
              <Stamp tone="dim">Escrow</Stamp>
              <Stamp tone="dim">Deadline</Stamp>
              <span />
            </div>
            {rows.map((l) => (
              <div key={l.shipmentId} className="panel-cold demo-fade-up" style={{ display: "grid", gridTemplateColumns: GRID, gap: 12, alignItems: "center", padding: 14, marginBottom: 8 }}>
                <Link href={`/track/${l.shipmentId}`} className="mono" style={{ color: "var(--chain)", fontSize: "var(--text-sm)", textDecoration: "none" }}>
                  #{l.shipmentId}
                </Link>
                <span style={{ fontSize: "var(--text-sm)", color: "var(--ink)" }}>{l.method === "drone" ? "Drone" : "Courier"}</span>
                <span className="mono" style={{ fontSize: "var(--text-sm)", color: "var(--ink-dim)" }}>{l.laneId ?? "—"}</span>
                <span className="mono" style={{ fontSize: "var(--text-sm)", color: l.amount === null ? "var(--ink-dim)" : "var(--chain)" }}>
                  {l.amount === null ? "confidential" : `${l.amount} XLM`}
                </span>
                <span className="mono" style={{ fontSize: "var(--text-sm)", color: "var(--ink-dim)" }}>{utcDay(l.escrowDeadline)}</span>
                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  {l.state === "OPEN" ? (
                    stellarAddress ? (
                      <Button
                        variant="seal"
                        loading={claiming === l.shipmentId}
                        loadingLabel="Claiming…"
                        onClick={() => void onClaim(l.shipmentId)}
                        style={{ minHeight: 38, padding: "8px 16px" }}
                      >
                        Claim
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        loading={connecting}
                        loadingLabel="Connecting…"
                        onClick={() => void connect()}
                        style={{ minHeight: 38, padding: "8px 16px" }}
                      >
                        Connect to claim
                      </Button>
                    )
                  ) : (
                    <Stamp tone={STATE_TONE[l.state]}>{l.state.replace("_", " ")}</Stamp>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : loading ? (
        <div className="panel-cold" style={{ padding: 24, textAlign: "center" }}>
          <Stamp tone="dim">Loading the board…</Stamp>
        </div>
      ) : (
        <div className="panel-cold" style={{ padding: 32, textAlign: "center" }}>
          <p className="display" style={{ margin: 0, fontSize: "var(--text-md)" }}>
            {listings.length === 0 ? "No open shipments yet" : "Nothing matches these filters"}
          </p>
          <p style={{ margin: "6px 0 0", fontSize: "var(--text-sm)", color: "var(--ink-dim)" }}>
            {listings.length === 0
              ? "A merchant creates one in the console — it appears here within a few seconds."
              : "Widen the lane, escrow, method, or deadline filters."}
          </p>
        </div>
      )}
    </div>
  );
}
