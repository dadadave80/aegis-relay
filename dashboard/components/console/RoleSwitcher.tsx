"use client";

/**
 * Prominent role switcher — flip Merchant → Carrier → Recipient → Auditor, one
 * session driving every role. Switching is gated on the wallet's live on-chain
 * `active_count`: while the wallet has an active service, every role but the
 * current one is disabled (the registry would reject the switch with RoleLocked /
 * WrongRole — this pre-empts that raw rejection). A one-line hint says who you're
 * acting as, or why switching is locked.
 */

import { useWallet } from "@/lib/wallet-context";
import { useSession } from "@/lib/session-context";
import { ROLES, roleMeta } from "./config";
import type { Role } from "@/lib/types";

export default function RoleSwitcher() {
  const { role, setRole, activeCount, chooseRole } = useSession();
  const { stellarAddress } = useWallet();
  const meta = roleMeta(role);
  const locked = activeCount > 0;

  return (
    <div>
      <div
        className="flex gap-1 rounded-2xl p-1 overflow-x-auto"
        role="tablist"
        aria-label="Acting role"
        style={{ background: "var(--bg)", border: "1px solid var(--border)" }}
      >
        {ROLES.map((r) => {
          const active = r.role === role;
          const disabled = locked && !active;
          const accent = "var(--mint)";
          const onPick = () => {
            if (disabled) return;
            setRole(r.role as Role);
            if (stellarAddress) chooseRole(stellarAddress, r.role as Role);
          };
          return (
            <button
              key={r.role}
              role="tab"
              aria-selected={active}
              aria-disabled={disabled}
              disabled={disabled}
              onClick={onPick}
              className="flex-1 min-w-[92px] rounded-xl px-2 py-2.5 text-sm font-semibold min-h-[44px] inline-flex items-center justify-center gap-2 transition-[transform,background,color] active:scale-[0.97]"
              style={
                active
                  ? {
                      background: accent,
                      color: "var(--on-mint)",
                    }
                  : {
                      background: "transparent",
                      color: "var(--text-dim)",
                      ...(disabled ? { opacity: 0.45, cursor: "not-allowed" } : {}),
                    }
              }
            >
              <span aria-hidden style={active ? undefined : { color: accent }}>
                {r.glyph}
              </span>
              {r.label}
            </button>
          );
        })}
      </div>
      {locked ? (
        <p
          className="text-sm mt-2.5"
          style={{ color: "var(--text-dim)" }}
          aria-live="polite"
        >
          You have an active shipment — finish or let it expire to switch roles.
        </p>
      ) : (
        <p
          className="text-sm mt-2.5"
          style={{ color: "var(--text-dim)" }}
          aria-live="polite"
        >
          You are now acting as{" "}
          <span className="font-semibold" style={{ color: "var(--mint)" }}>
            {meta.label}
          </span>{" "}
          — {meta.acting}
        </p>
      )}
    </div>
  );
}
