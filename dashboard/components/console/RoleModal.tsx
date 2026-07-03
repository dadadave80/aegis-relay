"use client";

/**
 * First-connect role picker. A fixed, dimmed overlay with a native <select>
 * (accessible, no new dependency) over the four roles. Selection is client-side
 * only — no transaction is sent; the registry auto-binds the wallet's role on
 * its first create/accept (plan 001). Rendered by Console only after the wallet
 * is connected and the wallet has not yet chosen a role, so it cannot be
 * dismissed into a role-less console.
 */

import { useState } from "react";
import { ROLES, roleMeta } from "./config";
import { ActionButton } from "./primitives";
import type { Role } from "@/lib/types";

export default function RoleModal({ onPick }: { onPick: (r: Role) => void }) {
  const [sel, setSel] = useState<Role>("merchant");
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Choose your role"
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "color-mix(in srgb, black 65%, transparent)" }}
    >
      <div className="card p-6 w-full max-w-md">
        <h2 className="text-xl font-semibold tracking-tight">Choose your role</h2>
        <p className="text-sm mt-1.5" style={{ color: "var(--text-dim)" }}>
          A wallet holds one role at a time. You can switch later once you have no
          active shipment.
        </p>
        <label
          htmlFor="role-select"
          className="block text-sm mt-5 mb-1"
          style={{ color: "var(--text-dim)" }}
        >
          Role
        </label>
        <select
          id="role-select"
          value={sel}
          onChange={(e) => setSel(e.target.value as Role)}
          className="w-full rounded-xl px-3 min-h-[44px] text-sm"
          style={{
            background: "var(--bg)",
            border: "1px solid var(--border)",
            color: "var(--text)",
          }}
        >
          {ROLES.map((r) => (
            <option key={r.role} value={r.role}>
              {r.label}
            </option>
          ))}
        </select>
        <p className="text-sm mt-3" style={{ color: "var(--text-faint)" }}>
          {roleMeta(sel).acting}
        </p>
        <ActionButton className="w-full mt-6" onClick={() => onPick(sel)}>
          Continue →
        </ActionButton>
      </div>
    </div>
  );
}
