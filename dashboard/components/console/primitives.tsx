"use client";

/**
 * Small, shared building blocks for the console — spinners, action buttons with
 * loading/step labels, inline error cards, form fields and a segmented control.
 * Styled in the Two-Worlds design language (Aegis Relay Design System): violet
 * --seal owns primary verbs, sharp 4px control radii, STAMP labels, hairline
 * borders. Signatures are unchanged so every station composes them as before.
 */

import type { ButtonHTMLAttributes, ReactNode } from "react";

// ── Spinner ────────────────────────────────────────────────────────────────

export function Spinner({ size = 14 }: { size?: number }) {
  return (
    <span
      aria-hidden
      className="inline-block animate-spin rounded-full align-[-2px]"
      style={{
        width: size,
        height: size,
        border: "2px solid color-mix(in srgb, currentColor 25%, transparent)",
        borderTopColor: "currentColor",
      }}
    />
  );
}

// ── Section label — STAMP ────────────────────────────────────────────────────

export function SectionLabel({ children }: { children: ReactNode }) {
  return <p className="stamp" style={{ color: "var(--ink-dim)" }}>{children}</p>;
}

// ── Action button ────────────────────────────────────────────────────────────

type Variant = "primary" | "danger" | "ghost";

const VARIANT: Record<Variant, React.CSSProperties> = {
  primary: { background: "var(--seal)", color: "#0B0716", border: "1px solid transparent" },
  danger: {
    background: "rgba(255,92,92,0.12)",
    color: "var(--danger)",
    border: "1px solid rgba(255,92,92,0.45)",
  },
  ghost: { background: "var(--void-1)", color: "var(--ink)", border: "1px solid var(--hairline)" },
};

interface ActionButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  children: ReactNode;
  loading?: boolean;
  loadingLabel?: string;
  variant?: Variant;
}

export function ActionButton({
  children,
  loading = false,
  loadingLabel,
  variant = "primary",
  disabled,
  className = "",
  style,
  ...rest
}: ActionButtonProps) {
  const isDisabled = disabled || loading;
  return (
    <button
      {...rest}
      disabled={isDisabled}
      aria-busy={loading}
      className={
        "inline-flex items-center justify-center gap-2 rounded-[var(--r-control)] px-[18px] py-2.5 " +
        "text-sm font-semibold min-h-[44px] transition-[transform,opacity] " +
        "active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45 " +
        "enabled:hover:opacity-90 " +
        className
      }
      style={{ ...VARIANT[variant], ...style }}
    >
      {loading && <Spinner />}
      <span className="truncate">{loading ? (loadingLabel ?? children) : children}</span>
    </button>
  );
}

// ── Inline error / notice cards — instrument voice ───────────────────────────

export function InlineError({
  title = "Something went wrong",
  detail,
}: {
  title?: string;
  detail: string;
}) {
  return (
    <div
      role="alert"
      className="panel p-4 text-sm"
      style={{ borderColor: "rgba(255,92,92,0.45)" }}
    >
      <p className="font-semibold" style={{ color: "var(--danger)" }}>{title}</p>
      <p className="mono mt-1 break-words" style={{ color: "var(--ink-dim)", fontSize: "var(--text-xs)" }}>
        {detail}
      </p>
    </div>
  );
}

export function Honesty({ children }: { children: ReactNode }) {
  return (
    <p className="honesty" style={{ display: "flex", alignItems: "flex-start", gap: 8, margin: 0 }}>
      <span aria-hidden style={{ fontStyle: "normal" }}>⚠</span>
      <span>{children}</span>
    </p>
  );
}

// ── Form field ────────────────────────────────────────────────────────────────

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="stamp" style={{ color: "var(--ink-dim)" }}>{label}</span>
      <div className="mt-1.5">{children}</div>
      {hint && (
        <span className="mt-1 block" style={{ color: "var(--ink-dim)", fontSize: "var(--text-xs)" }}>{hint}</span>
      )}
    </label>
  );
}

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const { className = "", ...rest } = props;
  return (
    <input
      {...rest}
      className={
        "mono w-full min-w-0 rounded-[var(--r-control)] px-3 py-2.5 text-sm outline-none border " +
        "hairline transition-colors focus:[border-color:var(--seal)] " +
        className
      }
      style={{ background: "var(--void-0)", color: "var(--ink)" }}
    />
  );
}

// ── Segmented control ────────────────────────────────────────────────────────

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  size = "md",
}: {
  value: T;
  options: { value: T; label: string; glyph?: ReactNode }[];
  onChange: (v: T) => void;
  size?: "sm" | "md";
}) {
  const pad = size === "sm" ? "px-3 py-1.5 text-xs" : "px-3.5 py-2 text-sm";
  return (
    <div
      role="tablist"
      className="inline-flex flex-wrap gap-1 rounded-[var(--r-panel)] p-1"
      style={{ background: "var(--void-0)", border: "1px solid var(--hairline)" }}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.value)}
            className={
              "rounded-[var(--r-control)] font-medium min-h-[36px] transition-[transform,background,color] " +
              "active:scale-[0.98] inline-flex items-center gap-1.5 " +
              pad
            }
            style={
              active
                ? { background: "rgba(139,124,255,0.16)", color: "var(--seal)", border: "1px solid rgba(139,124,255,0.5)" }
                : { background: "transparent", color: "var(--ink-dim)", border: "1px solid transparent" }
            }
          >
            {o.glyph && <span aria-hidden>{o.glyph}</span>}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
