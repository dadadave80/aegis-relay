"use client";

/**
 * Console top bar (Two-Worlds design): wordmark + network strip, the wallet chip
 * (XLM balance is private-world ivory — it's your wallet, not the shipment), the
 * Ledger Lens toggle (violet, key L), the deployed-contract strip (chain cyan),
 * and disconnect. The connected non-custodial wallet signs every action.
 */

import { useState } from "react";
import { useWallet } from "@/lib/wallet-context";
import { useSession } from "@/lib/session-context";
import { Stamp } from "@/components/ds/Stamp";
import { ChainDatum } from "@/components/ds/ChainDatum";
import { Spinner } from "@/components/ds/Button";
import Mark from "@/components/ds/Mark";
import { FALLBACK_CONTRACTS, accountLink, contractLink } from "./config";

function LensToggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      aria-pressed={on}
      title="Ledger Lens — see this screen as the chain does (L)"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        minHeight: 40,
        padding: "8px 14px",
        borderRadius: "var(--r-control)",
        cursor: "pointer",
        fontFamily: "var(--font-body)",
        fontSize: "var(--text-sm)",
        fontWeight: 600,
        whiteSpace: "nowrap",
        background: on ? "var(--seal)" : "rgba(139,124,255,0.10)",
        color: on ? "#0B0716" : "var(--seal)",
        border: `1px solid ${on ? "var(--seal)" : "rgba(139,124,255,0.45)"}`,
        transition: "background var(--dur-micro) var(--ease-micro), color var(--dur-micro) var(--ease-micro)",
      }}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
        <circle cx="12" cy="12" r="3.5" fill="currentColor" />
      </svg>
      Ledger Lens
      <span className="mono" style={{ fontSize: "var(--text-xs)", opacity: 0.7 }}>L</span>
    </button>
  );
}

export default function TopBar() {
  const { stellarAddress, balanceXlm, funded, refreshBalance, disconnect } = useWallet();
  const { lens, toggleLens } = useSession();
  const [refreshing, setRefreshing] = useState(false);
  const contracts = FALLBACK_CONTRACTS;

  const doRefresh = async () => {
    setRefreshing(true);
    await refreshBalance();
    setRefreshing(false);
  };

  const links: { label: string; id: string }[] = [
    { label: "registry", id: contracts.registry },
    { label: "airspace", id: contracts.airspace },
    { label: "credentials", id: contracts.credentials },
    ...(contracts.ctToken ? [{ label: "ct-token", id: contracts.ctToken }] : []),
  ];

  const shortAddr = stellarAddress ? `${stellarAddress.slice(0, 4)}…${stellarAddress.slice(-4)}` : "—";

  return (
    <div className="panel" style={{ overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap", padding: "12px 18px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
          <span className="display" style={{ display: "inline-flex", alignItems: "center", gap: 9, fontSize: "var(--text-md)", fontWeight: 700 }}>
            <Mark size={26} />
            <span>AEGIS<span style={{ color: "var(--seal)" }}>&nbsp;RELAY</span></span>
          </span>
          <span className="mono" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: "var(--text-xs)", color: "var(--chain-dim)" }}>
            <span aria-hidden style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--verified)", display: "inline-block" }} />
            Stellar Testnet · non-custodial
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div
            style={{ display: "flex", alignItems: "center", gap: 12, padding: "6px 12px", background: "var(--void-0)", border: "1px solid var(--hairline)", borderRadius: "var(--r-control)" }}
          >
            <div>
              <Stamp>Your wallet</Stamp>
              <p className="mono" style={{ margin: 0, fontSize: "var(--text-sm)", fontWeight: 500, color: funded ? "var(--ink)" : "var(--ink-dim)" }}>
                {balanceXlm !== null ? `${balanceXlm} XLM` : "— XLM"}
              </p>
            </div>
            {stellarAddress ? (
              <a href={accountLink(stellarAddress)} target="_blank" rel="noopener noreferrer" className="mono" style={{ fontSize: "var(--text-xs)", color: "var(--ink-dim)", textDecoration: "none" }}>
                {shortAddr} ↗
              </a>
            ) : (
              <span className="mono" style={{ fontSize: "var(--text-xs)", color: "var(--ink-dim)" }}>not connected</span>
            )}
            <button
              onClick={doRefresh}
              disabled={refreshing || !stellarAddress}
              aria-label="Refresh balance"
              className="mono"
              style={{ minHeight: 28, padding: "0 8px", borderRadius: "var(--r-control)", border: "1px solid var(--hairline)", background: "transparent", color: "var(--ink-dim)", cursor: refreshing ? "default" : "pointer" }}
            >
              {refreshing ? <Spinner size={12} /> : "↻"}
            </button>
          </div>

          <LensToggle on={lens} onToggle={toggleLens} />

          <button
            onClick={() => void disconnect()}
            style={{ minHeight: 40, padding: "0 14px", borderRadius: "var(--r-control)", border: "1px solid var(--hairline)", background: "var(--void-1)", color: "var(--ink-dim)", fontSize: "var(--text-sm)", cursor: "pointer" }}
          >
            Disconnect
          </button>
        </div>
      </div>

      <div style={{ display: "flex", gap: 20, flexWrap: "wrap", alignItems: "center", padding: "0 18px 12px", borderTop: "1px solid var(--hairline)", paddingTop: 10 }}>
        {links.map((l) => (
          <span key={l.label} style={{ display: "inline-flex", alignItems: "baseline", gap: 8 }}>
            <Stamp tone="chain">{l.label}</Stamp>
            <ChainDatum value={l.id} href={contractLink(contracts, l.id)} />
          </span>
        ))}
      </div>
    </div>
  );
}
