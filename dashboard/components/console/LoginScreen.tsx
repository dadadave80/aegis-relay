"use client";

/**
 * Pre-connect screen. "Connect wallet" opens the Stellar Wallets Kit modal
 * (Freighter / Albedo / xBull / Lobstr / Hana / Rabet); once connected the
 * console takes over.
 */

import { useWallet } from "@/lib/wallet-context";
import { ActionButton } from "./primitives";

const BEATS = [
  {
    glyph: "◆",
    title: "One session, every role",
    body: "Switch between merchant, carrier, recipient and auditor — you drive the entire lifecycle.",
  },
  {
    glyph: "▸",
    title: "Real proofs, real chain",
    body: "Groth16 proofs verify and settle in one Soroban transaction on Stellar testnet — every action links to the explorer.",
  },
  {
    glyph: "✓",
    title: "Watch what leaks",
    body: "A live seen-vs-hidden panel shows exactly what the chain records — and everything it never learns.",
  },
];

export default function LoginScreen() {
  const { connect, connecting, ready } = useWallet();

  return (
    <div className="max-w-3xl mx-auto px-6 py-16 sm:py-24">
      <div className="text-center demo-fade-up" style={{ animationDelay: "0ms" }}>
        <span
          className="inline-flex items-center gap-2 text-xs uppercase tracking-wider px-3 py-1 rounded-full"
          style={{
            color: "var(--mint)",
            border: "1px solid color-mix(in srgb, var(--mint) 35%, transparent)",
          }}
        >
          <span
            className="inline-block w-1.5 h-1.5 rounded-full"
            style={{ background: "var(--mint)" }}
            aria-hidden
          />
          The app
        </span>
        <h1
          className="mt-6 text-3xl sm:text-4xl font-bold tracking-tight"
          style={{ textWrap: "balance" }}
        >
          Prove the delivery.{" "}
          <span style={{ color: "var(--mint)" }}>Hide the map.</span>
        </h1>
        <p
          className="mt-4 text-sm sm:text-base max-w-xl mx-auto leading-relaxed"
          style={{ color: "var(--text-dim)", textWrap: "pretty" }}
        >
          Drive a full private shipment on Stellar — created, carried, flown,
          delivered and settled — while the chain learns nothing but hashes.
        </p>
      </div>

      <div
        className="mt-10 grid sm:grid-cols-3 gap-4 demo-fade-up"
        style={{ animationDelay: "100ms" }}
      >
        {BEATS.map((b) => (
          <div key={b.title} className="card p-5">
            <span aria-hidden className="text-lg" style={{ color: "var(--mint)" }}>
              {b.glyph}
            </span>
            <p className="mt-2 text-sm font-semibold">{b.title}</p>
            <p
              className="mt-1.5 text-xs leading-relaxed"
              style={{ color: "var(--text-faint)" }}
            >
              {b.body}
            </p>
          </div>
        ))}
      </div>

      <div
        className="mt-10 flex flex-col items-center gap-3 demo-fade-up"
        style={{ animationDelay: "200ms" }}
      >
        <ActionButton
          onClick={connect}
          disabled={!ready || connecting}
          loading={!ready || connecting}
          loadingLabel={connecting ? "Connecting…" : "Loading…"}
          className="px-8 py-3.5 text-base"
        >
          Connect wallet →
        </ActionButton>
        <p className="text-xs text-center" style={{ color: "var(--text-faint)" }}>
          Freighter, Albedo, xBull, Lobstr, Hana or Rabet — your wallet signs
          every action (non-custodial). It auto-funds via friendbot on connect
          (a few seconds).
        </p>
      </div>
    </div>
  );
}
