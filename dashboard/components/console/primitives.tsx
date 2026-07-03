"use client";

/**
 * Small, shared building blocks for the console — spinners, action
 * buttons with loading/step labels, inline error cards, form fields and a
 * segmented control. All styling matches the existing dark / mint system in
 * app/globals.css (Tailwind for layout, CSS vars for colour).
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

// ── Section label ──────────────────────────────────────────────────────────

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <p
      className="text-xs uppercase tracking-wider"
      style={{ color: "var(--text-faint)" }}
    >
      {children}
    </p>
  );
}

// ── Action button ────────────────────────────────────────────────────────────

type Variant = "primary" | "danger" | "ghost";

const VARIANT: Record<Variant, React.CSSProperties> = {
  primary: { background: "var(--mint)", color: "var(--on-mint)" },
  danger: {
    background: "color-mix(in srgb, var(--red) 12%, transparent)",
    color: "var(--red)",
    border: "1px solid color-mix(in srgb, var(--red) 45%, transparent)",
  },
  ghost: {
    background: "var(--surface)",
    color: "var(--text)",
    border: "1px solid var(--border)",
  },
};

interface ActionButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
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
        "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 " +
        "text-sm font-semibold min-h-[40px] transition-[transform,opacity] " +
        "active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-45 " +
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

// ── Inline error / notice cards ──────────────────────────────────────────────

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
      className="card p-4 text-sm"
      style={{ borderColor: "color-mix(in srgb, var(--red) 45%, transparent)" }}
    >
      <p className="font-semibold" style={{ color: "var(--red)" }}>
        {title}
      </p>
      <p className="mt-1 break-words" style={{ color: "var(--text-dim)" }}>
        {detail}
      </p>
    </div>
  );
}

export function Honesty({ children }: { children: ReactNode }) {
  return (
    <p
      className="text-xs leading-relaxed flex items-start gap-2"
      style={{ color: "var(--amber)" }}
    >
      <span aria-hidden className="mt-px">
        ⚠
      </span>
      <span style={{ color: "color-mix(in srgb, var(--amber) 82%, var(--text-dim))" }}>
        {children}
      </span>
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
      <span
        className="text-xs uppercase tracking-wider"
        style={{ color: "var(--text-faint)" }}
      >
        {label}
      </span>
      <div className="mt-1.5">{children}</div>
      {hint && (
        <span className="text-xs mt-1 block" style={{ color: "var(--text-faint)" }}>
          {hint}
        </span>
      )}
    </label>
  );
}

export function TextInput(
  props: React.InputHTMLAttributes<HTMLInputElement>,
) {
  const { className = "", ...rest } = props;
  return (
    <input
      {...rest}
      className={
        "mono w-full min-w-0 rounded-lg px-3 py-2.5 text-sm outline-none border " +
        "hairline focus:border-[var(--mint)] transition-colors " +
        className
      }
      style={{ background: "var(--bg)", color: "var(--text)" }}
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
  options: { value: T; label: string; glyph?: string }[];
  onChange: (v: T) => void;
  size?: "sm" | "md";
}) {
  const pad = size === "sm" ? "px-3 py-1.5 text-xs" : "px-3.5 py-2 text-sm";
  return (
    <div
      role="tablist"
      className="inline-flex flex-wrap gap-1 rounded-xl p-1"
      style={{ background: "var(--bg)", border: "1px solid var(--border)" }}
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
              "rounded-lg font-medium min-h-[36px] transition-[transform,background,color] " +
              "active:scale-[0.96] inline-flex items-center gap-1.5 " +
              pad
            }
            style={
              active
                ? { background: "var(--mint)", color: "var(--on-mint)" }
                : { background: "transparent", color: "var(--text-dim)" }
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
