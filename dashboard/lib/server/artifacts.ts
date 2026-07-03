/**
 * dashboard/lib/server/artifacts.ts — server-only constants: contract ids,
 * RPC endpoint, network passphrase, explorer bases, and the on-disk locations
 * of the Groth16 proving artifacts + the (gitignored) auditor key.
 *
 * This module holds NO Stellar signing keys. The only "secret" it can surface
 * is the mock-regulator auditor key, used solely to decrypt an already-settled
 * confidential amount for the compliance beat (never a Stellar key).
 */

import "server-only";
import path from "node:path";
import fs from "node:fs";

/** Repo root — dashboard/ is one level down. Only the (gitignored, optional)
 *  auditor key is read from here; the Groth16 proving artifacts are served as
 *  static assets from dashboard/public/circuits and proved in the browser. */
export const REPO_ROOT = path.resolve(process.cwd(), "..");

// ── Deployed testnet contracts (docs/testnet.md — final deployment) ──────────

export const REGISTRY_ID =
  process.env.AEGIS_REGISTRY_ID ||
  process.env.NEXT_PUBLIC_REGISTRY_ID ||
  "CAROLAUWCNZGSLSAISY5OVY5GZDZ6ULPBAO3U4FKTU3OIAOVPO6ZKPZL";

export const AIRSPACE_ID =
  process.env.AEGIS_AIRSPACE_ID ||
  process.env.NEXT_PUBLIC_AIRSPACE_ID ||
  "CCOEGSF3BSLXYKZMMX2OCSOJONAGORRWSI33TIUX3EHPVVHNMVHNENOY";

export const CREDENTIALS_ID =
  process.env.AEGIS_CREDENTIALS_ID ||
  process.env.NEXT_PUBLIC_CREDENTIALS_ID ||
  "CBEDJCSBU3IKHW34HAZPL55CFJ5AZOTBJUGFXR5TS5JMRJN7W37K4FQF";

export const NATIVE_SAC =
  process.env.AEGIS_NATIVE_SAC ||
  process.env.NEXT_PUBLIC_NATIVE_SAC ||
  "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";

export const CT_TOKEN_ID =
  process.env.AEGIS_CT_TOKEN_ID ||
  process.env.NEXT_PUBLIC_CT_TOKEN_ID ||
  "CCKUW6LFVRZZ7AYQ3HXW3MP4CYW4ZZO6LZRIPKUH7MX2GJVXPWYHYOHC";

export const CT_AUDITOR_ID =
  process.env.AEGIS_CT_AUDITOR_ID ||
  process.env.NEXT_PUBLIC_CT_AUDITOR_ID ||
  "CDCOI5E6FZQGUPD2DSYA6EEYFFXPYUHHYV3FSSG3N3LWWD3WZVYU3SNN";

export const CT_VERIFIER_ID =
  process.env.AEGIS_CT_VERIFIER_ID ||
  process.env.NEXT_PUBLIC_CT_VERIFIER_ID ||
  "CCZIHLG6KBNVRRM2QKP6HFSLJXV356ASA2XHPCRIDXNB6PAEZ7QGO756";

/** Ledger the re-pinned CT token was deployed at — the event-scan start point. */
export const CT_DEPLOYED_LEDGER = Number(
  process.env.AEGIS_CT_DEPLOYED_LEDGER || process.env.NEXT_PUBLIC_CT_DEPLOYED_LEDGER || "3407219",
);

// ── Network ──────────────────────────────────────────────────────────────────

/** RPC endpoint. Prefers an explicit AEGIS_RPC_URL, then the user's keyed
 * provider (e.g. Alchemy) in STELLAR_TESTNET_RPC_URL, then the public RPC. */
export const RPC_URL =
  process.env.AEGIS_RPC_URL ||
  process.env.STELLAR_TESTNET_RPC_URL ||
  "https://soroban-testnet.stellar.org";

export const NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";

/** Friendbot base (overridable so the local pinned-IP proxy can stand in). */
export const FRIENDBOT_URL =
  process.env.AEGIS_FRIENDBOT_URL || "https://friendbot.stellar.org";

export const EXPLORER_CONTRACT_BASE =
  "https://stellar.expert/explorer/testnet/contract/";
export const EXPLORER_TX_BASE = "https://stellar.expert/explorer/testnet/tx/";

export function explorerTx(hash: string): string {
  return `${EXPLORER_TX_BASE}${hash}`;
}

// ── Method / Rail discriminants (u32 enums on the registry) ──────────────────

export const METHOD_U32 = { courier: 1, drone: 3 } as const;
export const RAIL_U32 = { transparent: 0, confidential: 1 } as const;

// ── Mock-regulator auditor key (NOT a Stellar key) ───────────────────────────

export interface AuditorKey {
  id: number;
  secretHex: string;
  keyXHex: string;
  keyYHex: string;
}

/** Load the mock-regulator auditor key from prover/out (gitignored), if present. */
export function loadAuditorKey(): AuditorKey | null {
  const p = path.join(REPO_ROOT, "prover", "out", "auditor-key.json");
  try {
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, "utf8")) as AuditorKey;
  } catch {
    return null;
  }
}
