"use client";

/**
 * Pre-connect screen. "Connect wallet" opens the Stellar Wallets Kit modal
 * (Freighter / Albedo / xBull / Lobstr / Hana / Rabet); once connected the
 * console takes over. Styled in the Two-Worlds design language.
 */

import { useWallet } from "@/lib/wallet-context";
import { Button } from "@/components/ds/Button";
import { Stamp } from "@/components/ds/Stamp";

const BEATS = [
  {
    glyph: "◆",
    title: "One wallet, one role",
    body: "Your wallet binds a role on-chain — merchant or carrier — and drives its part of the lifecycle. No relayer.",
  },
  {
    glyph: "▸",
    title: "Real proofs, real chain",
    body: "Groth16 proofs verify and settle in one Soroban transaction on Stellar testnet — every action links to the explorer.",
  },
  {
    glyph: "✓",
    title: "Watch what leaks",
    body: "A live visibility matrix shows exactly what the chain records — and everything it never learns.",
  },
];

export default function LoginScreen() {
  const { connect, connecting, ready } = useWallet();

  return (
    <div className="mx-auto" style={{ maxWidth: 860, padding: "72px 24px 96px" }}>
      <div className="text-center demo-fade-up" style={{ animationDelay: "0ms" }}>
        <span
          className="inline-flex items-center gap-2"
          style={{ border: "1px solid rgba(139,124,255,0.35)", borderRadius: "var(--r-pill)", padding: "4px 12px" }}
        >
          <span aria-hidden style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--seal)", display: "inline-block" }} />
          <Stamp tone="seal">The app</Stamp>
        </span>
        <h1 className="display" style={{ margin: "24px 0 0", fontSize: "var(--mk-xl)", fontWeight: 700, textWrap: "balance" }}>
          Prove the delivery. <span style={{ color: "var(--seal)" }}>Hide the map.</span>
        </h1>
        <p style={{ margin: "16px auto 0", maxWidth: "52ch", fontSize: "var(--mk-sm)", color: "var(--ink-dim)", lineHeight: "var(--lh-body)" }}>
          Drive a full private shipment on Stellar — created, carried, flown, delivered and settled —
          while the chain learns nothing but hashes.
        </p>
      </div>

      <div
        className="demo-fade-up"
        style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16, margin: "40px 0 0", animationDelay: "100ms" }}
      >
        {BEATS.map((b) => (
          <div key={b.title} className="panel" style={{ padding: 18 }}>
            <span aria-hidden className="mono" style={{ fontSize: "var(--text-lg)", color: "var(--seal)" }}>{b.glyph}</span>
            <p style={{ margin: "8px 0 0", fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--ink)" }}>{b.title}</p>
            <p style={{ margin: "6px 0 0", fontSize: "var(--text-xs)", color: "var(--ink-dim)", lineHeight: "var(--lh-body)" }}>{b.body}</p>
          </div>
        ))}
      </div>

      <div className="demo-fade-up flex flex-col items-center" style={{ gap: 12, margin: "40px 0 0", animationDelay: "200ms" }}>
        <Button
          onClick={() => void connect()}
          disabled={!ready || connecting}
          loading={!ready || connecting}
          loadingLabel={connecting ? "Connecting…" : "Loading…"}
          style={{ padding: "14px 32px", fontSize: "var(--mk-sm)" }}
        >
          Connect wallet ↗
        </Button>
        <p className="mono" style={{ textAlign: "center", fontSize: "var(--text-xs)", color: "var(--ink-dim)", maxWidth: "56ch", lineHeight: "var(--lh-mono)" }}>
          Freighter, Albedo, xBull, Lobstr, Hana or Rabet — your wallet signs every action
          (non-custodial). It auto-funds via friendbot on connect.
        </p>
      </div>
    </div>
  );
}
