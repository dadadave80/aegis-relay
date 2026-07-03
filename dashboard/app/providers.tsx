"use client";

/**
 * Global providers. Wallet connection (Stellar Wallets Kit) is scoped to the
 * console (mounted in app/console/page.tsx via <WalletProvider>), so there is
 * no app-wide auth provider — this is a thin pass-through that also exports the
 * shared mint accent used across the console.
 */

export const MINT = "#4EF0B5";

export default function Providers({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
