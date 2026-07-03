"use client";

/**
 * Console top bar: who you're logged in as, the connected non-custodial Stellar
 * wallet (address + live XLM balance + friendbot funding state), the deployed
 * contract links, and a logout.
 */

import { useState } from "react";
import Hash from "@/components/Hash";
import { useWallet } from "@/lib/wallet-context";
import { FALLBACK_CONTRACTS, accountLink, contractLink } from "./config";
import { Spinner } from "./primitives";

function Identity() {
  return (
    <div className="flex items-center gap-2.5 min-w-0">
      <span
        aria-hidden
        className="inline-block w-2 h-2 rounded-full shrink-0"
        style={{ background: "var(--mint)" }}
      />
      <div className="min-w-0">
        <p className="text-sm font-medium truncate">Wallet connected</p>
        <p className="text-xs" style={{ color: "var(--text-faint)" }}>
          Stellar testnet · non-custodial
        </p>
      </div>
    </div>
  );
}

function WalletChip({
  address,
  balanceXlm,
  funded,
}: {
  address: string | null;
  balanceXlm: string | null;
  funded: boolean;
}) {
  return (
    <div
      className="rounded-xl px-3.5 py-2 flex items-center gap-3"
      style={{ background: "var(--bg)", border: "1px solid var(--border)" }}
    >
      <div>
        <p
          className="text-[10px] uppercase tracking-wider"
          style={{ color: "var(--text-faint)" }}
        >
          Your wallet
        </p>
        <p
          className="mono text-sm font-semibold tabular-nums"
          style={{ color: funded ? "var(--mint)" : "var(--text-faint)" }}
        >
          {balanceXlm !== null ? `${balanceXlm} XLM` : "— XLM"}
        </p>
      </div>
      {address ? (
        <Hash value={address} href={accountLink(address)} />
      ) : (
        <span className="text-xs" style={{ color: "var(--text-faint)" }}>
          not connected
        </span>
      )}
    </div>
  );
}

export default function TopBar() {
  const { stellarAddress, balanceXlm, funded, refreshBalance, disconnect } = useWallet();
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

  return (
    <div className="card p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-4">
        <Identity />

        <div className="flex flex-wrap items-center gap-2.5">
          <WalletChip
            address={stellarAddress}
            balanceXlm={balanceXlm}
            funded={funded}
          />
          <button
            onClick={doRefresh}
            disabled={refreshing || !stellarAddress}
            aria-label="Refresh balance"
            className="rounded-lg min-h-[40px] px-3 text-sm border hairline transition-[transform,opacity] active:scale-[0.96] enabled:hover:text-white disabled:opacity-45"
            style={{ color: "var(--text-faint)" }}
          >
            {refreshing ? <Spinner /> : "↻"}
          </button>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => void disconnect()}
            className="text-sm rounded-lg min-h-[40px] px-3.5 border hairline transition-[transform,opacity] active:scale-[0.96] hover:text-white"
            style={{ color: "var(--text-dim)" }}
          >
            Disconnect
          </button>
        </div>
      </div>

      <div
        className="mt-4 pt-3 border-t hairline flex flex-wrap items-center gap-x-5 gap-y-2 text-xs"
        style={{ color: "var(--text-faint)" }}
      >
        <span>Stellar Testnet · deployed contracts</span>
        {links.map((l) => (
          <span key={l.label} className="inline-flex items-center gap-1.5">
            {l.label} <Hash value={l.id} href={contractLink(contracts, l.id)} />
          </span>
        ))}
      </div>
    </div>
  );
}
