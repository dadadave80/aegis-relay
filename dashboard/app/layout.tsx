import type { Metadata } from "next";
import { Archivo, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import Providers from "./providers";

// The Archivo superfamily (variable width axis for the Expanded display cut)
// + IBM Plex Mono (400/500 with true italic — the annotation voice). Exposed
// as CSS vars the design tokens in globals.css point --font-body/display/mono at.
const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  axes: ["wdth"],
});
const plex = IBM_Plex_Mono({
  variable: "--font-plex",
  subsets: ["latin"],
  weight: ["400", "500"],
  style: ["normal", "italic"],
});

export const metadata: Metadata = {
  title: "Aegis Relay — Prove the delivery. Hide the map.",
  description:
    "Privacy-preserving supply-chain custody & delivery settlement on Stellar. Groth16 proofs advance the shipment state machine and release escrow atomically — without revealing contents, recipients, or routes.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${archivo.variable} ${plex.variable} min-h-screen flex flex-col antialiased`}>
        <Providers>
          <Nav />
          <main className="flex-1">{children}</main>
          <Footer />
        </Providers>
      </body>
    </html>
  );
}
