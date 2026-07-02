/**
 * Client-side fallbacks + link helpers for the demo console.
 *
 * When the backend session provisions, real contract ids + explorer bases come
 * from SessionInfo.contracts. Until then (or if provisioning fails in guest
 * mode) we fall back to the known testnet deployment so the board still renders
 * live explorer links. These mirror the defaults in lib/contract.ts; we don't
 * import that module to keep the heavy Stellar SDK out of the client bundle.
 */

import type { Role, SessionInfo } from "@/lib/types";

export type Contracts = SessionInfo["contracts"];

export const FALLBACK_CONTRACTS: Contracts = {
  registry: "CC4HXXHUE6ZCIVVN4XAHPV4JMYHEWK7ZIKILQMG5WCJ4V67NWLFTVGCA",
  airspace: "CCOEGSF3BSLXYKZMMX2OCSOJONAGORRWSI33TIUX3EHPVVHNMVHNENOY",
  credentials: "CBEDJCSBU3IKHW34HAZPL55CFJ5AZOTBJUGFXR5TS5JMRJN7W37K4FQF",
  ctToken: "",
  ctAuditor: "",
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
  {
    role: "attacker",
    label: "Attacker",
    glyph: "✕",
    acting: "an attacker — every shortcut you try is meant to be rejected.",
  },
];

export function roleMeta(role: Role): RoleMeta {
  return ROLES.find((r) => r.role === role) ?? ROLES[0];
}
