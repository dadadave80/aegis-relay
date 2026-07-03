"use client";

import { useState, type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from "react";

/**
 * Action button (Aegis Relay Design System). Violet `--seal` owns every privacy
 * verb: Seal & fund escrow · Accept custody · Submit flight proof · Sign proof
 * of delivery · Decrypt as regulator. Variants: seal (primary) / ghost / danger
 * / chain. Press → scale(.98) + --seal-deep.
 */
export type ButtonVariant = "seal" | "ghost" | "danger" | "chain";

const VARIANTS: Record<ButtonVariant, CSSProperties> = {
  seal: { background: "var(--seal)", color: "#0B0716", border: "1px solid transparent" },
  ghost: { background: "var(--void-1)", color: "var(--ink)", border: "1px solid var(--hairline)" },
  danger: { background: "rgba(255,92,92,0.12)", color: "var(--danger)", border: "1px solid rgba(255,92,92,0.45)" },
  chain: { background: "rgba(125,223,242,0.08)", color: "var(--chain)", border: "1px solid rgba(125,223,242,0.35)" },
};

export function Spinner({ size = 14 }: { size?: number }) {
  return (
    <span
      aria-hidden
      style={{
        display: "inline-block",
        width: size,
        height: size,
        borderRadius: "50%",
        border: "2px solid rgba(255,255,255,0.25)",
        borderTopColor: "currentColor",
        animation: "aegis-spin 0.7s linear infinite",
      }}
    >
      <style>{"@keyframes aegis-spin { to { transform: rotate(360deg); } }"}</style>
    </span>
  );
}

type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  children: ReactNode;
  variant?: ButtonVariant;
  loading?: boolean;
  loadingLabel?: ReactNode;
  full?: boolean;
};

export function Button({
  children,
  variant = "seal",
  loading = false,
  loadingLabel,
  disabled = false,
  full = false,
  style,
  onMouseDown,
  onMouseUp,
  onMouseLeave,
  ...rest
}: ButtonProps) {
  const [pressed, setPressed] = useState(false);
  const isDisabled = disabled || loading;
  const v = VARIANTS[variant];
  return (
    <button
      {...rest}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      onMouseDown={(e) => { setPressed(true); onMouseDown?.(e); }}
      onMouseUp={(e) => { setPressed(false); onMouseUp?.(e); }}
      onMouseLeave={(e) => { setPressed(false); onMouseLeave?.(e); }}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        minHeight: 44,
        padding: "10px 18px",
        width: full ? "100%" : undefined,
        borderRadius: "var(--r-control)",
        fontFamily: "var(--font-body)",
        fontSize: "var(--text-sm)",
        fontWeight: 600,
        cursor: isDisabled ? "not-allowed" : "pointer",
        opacity: isDisabled ? 0.45 : 1,
        transform: pressed && !isDisabled ? "scale(0.98)" : "none",
        transition:
          "transform var(--dur-micro) var(--ease-micro), opacity var(--dur-micro) var(--ease-micro), background var(--dur-micro) var(--ease-micro)",
        ...v,
        ...(variant === "seal" && pressed && !isDisabled ? { background: "var(--seal-deep)", color: "var(--ink)" } : {}),
        ...style,
      }}
    >
      {loading && <Spinner />}
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {loading ? loadingLabel || children : children}
      </span>
    </button>
  );
}
