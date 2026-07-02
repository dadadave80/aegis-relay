"use client";

import { WalletProvider } from "@/lib/wallet-context";
import { SessionProvider } from "@/lib/session-context";
import { ToastProvider } from "@/components/demo/toast";
import Console from "@/components/demo/Console";

// Scoped enter animation for the console. The global prefers-reduced-motion
// rule in app/globals.css neutralises it for users who opt out.
const CONSOLE_CSS = `
@keyframes demoFadeUp {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: none; }
}
.demo-fade-up { animation: demoFadeUp 0.4s cubic-bezier(0.2, 0, 0, 1) both; }
`;

export default function DemoPage() {
  return (
    <WalletProvider>
      <SessionProvider>
        <ToastProvider>
          <style dangerouslySetInnerHTML={{ __html: CONSOLE_CSS }} />
          <Console />
        </ToastProvider>
      </SessionProvider>
    </WalletProvider>
  );
}
