"use client";

/**
 * Prominent role switcher — the founder flips Merchant → Carrier → Recipient →
 * Auditor → Attacker freely, one session driving every role. Switching is
 * instant; a one-line hint says who you're now acting as.
 */

import { useSession } from "@/lib/session-context";
import { ROLES, roleMeta } from "./config";
import type { Role } from "@/lib/types";

export default function RoleSwitcher() {
  const { role, setRole } = useSession();
  const meta = roleMeta(role);

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
          const isAttacker = r.role === "attacker";
          const accent = isAttacker ? "var(--red)" : "var(--mint)";
          return (
            <button
              key={r.role}
              role="tab"
              aria-selected={active}
              onClick={() => setRole(r.role as Role)}
              className="flex-1 min-w-[92px] rounded-xl px-2 py-2.5 text-sm font-semibold min-h-[44px] inline-flex items-center justify-center gap-2 transition-[transform,background,color] active:scale-[0.97]"
              style={
                active
                  ? {
                      background: accent,
                      color: isAttacker ? "#1A0808" : "var(--on-mint)",
                    }
                  : { background: "transparent", color: "var(--text-dim)" }
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
      <p
        className="text-sm mt-2.5"
        style={{ color: "var(--text-dim)" }}
        aria-live="polite"
      >
        You are now acting as{" "}
        <span
          className="font-semibold"
          style={{
            color: role === "attacker" ? "var(--red)" : "var(--mint)",
          }}
        >
          {meta.label}
        </span>{" "}
        — {meta.acting}
      </p>
    </div>
  );
}
