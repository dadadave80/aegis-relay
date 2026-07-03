/**
 * Client-side fallbacks + link helpers for the console.
 *
 * The connected wallet acts on a fixed testnet deployment. Contract ids +
 * explorer bases live here (mirroring WalletInfo.contracts / lib/contract.ts)
 * so the board renders live explorer links without pulling the heavy Stellar
 * SDK into the client bundle.
 */

import type { Role, WalletInfo } from "@/lib/types";

export type Contracts = WalletInfo["contracts"];

export const FALLBACK_CONTRACTS: Contracts = {
  registry: "CAROLAUWCNZGSLSAISY5OVY5GZDZ6ULPBAO3U4FKTU3OIAOVPO6ZKPZL",
  airspace: "CCOEGSF3BSLXYKZMMX2OCSOJONAGORRWSI33TIUX3EHPVVHNMVHNENOY",
  credentials: "CBEDJCSBU3IKHW34HAZPL55CFJ5AZOTBJUGFXR5TS5JMRJN7W37K4FQF",
  ctToken: "CCKUW6LFVRZZ7AYQ3HXW3MP4CYW4ZZO6LZRIPKUH7MX2GJVXPWYHYOHC",
  ctAuditor: "CDCOI5E6FZQGUPD2DSYA6EEYFFXPYUHHYV3FSSG3N3LWWD3WZVYU3SNN",
  explorerBase: "https://stellar.expert/explorer/testnet/contract/",
  txBase: "https://stellar.expert/explorer/testnet/tx/",
};

export const ACCOUNT_BASE = "https://stellar.expert/explorer/testnet/account/";

export function contractLink(c: Contracts, id: string): string {
  return c.explorerBase + id;
}
export function txLink(c: Contracts, hash: string): string {
  return c.txBase + hash;
}
export function accountLink(addr: string): string {
  return ACCOUNT_BASE + addr;
}

// ── Role metadata ────────────────────────────────────────────────────────────

export interface RoleMeta {
  role: Role;
  label: string;
  glyph: string;
  acting: string;
}

export const ROLES: RoleMeta[] = [
  {
    role: "merchant",
    label: "Merchant",
    glyph: "◆",
    acting: "the merchant — you escrow payment against an opaque commitment.",
  },
  {
    role: "carrier",
    label: "Carrier",
    glyph: "▸",
    acting: "the carrier — you take custody and prove you obeyed the rules.",
  },
  {
    role: "recipient",
    label: "Recipient",
    glyph: "✓",
    acting: "the recipient — your device signs receipt, binding it to this moment.",
  },
  {
    role: "auditor",
    label: "Auditor",
    glyph: "⊙",
    acting: "the regulator — you hold the one key that opens confidential amounts.",
  },
];

export function roleMeta(role: Role): RoleMeta {
  return ROLES.find((r) => r.role === role) ?? ROLES[0];
}
