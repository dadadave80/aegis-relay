import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Console — Aegis Relay",
  description:
    "Drive a full private shipment on Stellar testnet — create, carry, fly, deliver and settle — switching roles freely while the chain learns nothing but hashes.",
};

export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  return children;
}
