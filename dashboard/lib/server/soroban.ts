/**
 * dashboard/lib/server/soroban.ts — the two-step, key-less transaction engine.
 *
 * The server NEVER holds a Stellar signing key. It:
 *   1. builds the invoke with the connected wallet as the source account,
 *   2. runs `prepareTransaction` (simulate + assemble — this validates every
 *      ScVal against the live contract), caches the prepared tx, and returns
 *      its hash for the wallet to sign,
 *   3. attaches the wallet's raw-ed25519 signature over that hash and submits.
 *
 * A raw ed25519 signature over `tx.hash()` IS a valid Stellar envelope
 * signature — which is exactly what Privy's `signRawHash({hash})` returns. That
 * equivalence is the whole non-custodial design.
 */

import "server-only";
import {
  rpc,
  Account,
  Address,
  Contract,
  Keypair,
  TransactionBuilder,
  Transaction,
  nativeToScVal,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";
import { randomUUID } from "node:crypto";
import { bigintToU256ScVal, encodeProof, proofToScVal, type SnarkjsProof } from "./prover-dist/lib/bn254.js";
import { RPC_URL, NETWORK_PASSPHRASE, REGISTRY_ID } from "./artifacts";

// A valid but unfunded ed25519 key, used only to build read-only simulation txs.
const DUMMY_PK = "GC5Z644P4L2WUHLAK37KAO6OWF6NH3DUIH3Y5EVOQWHQ2BSHBBCE4NWN";

export function server(): rpc.Server {
  return new rpc.Server(RPC_URL, { allowHttp: RPC_URL.startsWith("http://") });
}

// ── ScVal builders ─────────────────────────────────────────────────────────

export const scU64 = (v: number | bigint | string): xdr.ScVal =>
  nativeToScVal(BigInt(v), { type: "u64" });
export const scU32 = (v: number): xdr.ScVal => nativeToScVal(v, { type: "u32" });
export const scI128 = (v: number | bigint | string): xdr.ScVal =>
  nativeToScVal(BigInt(v), { type: "i128" });
export const scAddr = (a: string): xdr.ScVal => new Address(a).toScVal();
export const scU256 = (dec: bigint | string): xdr.ScVal => bigintToU256ScVal(dec);
export const scVecU32 = (arr: number[]): xdr.ScVal => nativeToScVal(arr, { type: ["u32"] });
export const scNone = (): xdr.ScVal => xdr.ScVal.scvVoid();
export const scSomeU32 = (v: number): xdr.ScVal => scU32(v);
export const scProof = (proof: SnarkjsProof): xdr.ScVal => proofToScVal(encodeProof(proof));

// ── Build (simulate + assemble + cache) ──────────────────────────────────────

export interface BuiltTx {
  buildId: string;
  xdr: string;
  hashHex: string;
}

/**
 * Build an invoke of `fnName(args)` on the registry with `source` as the tx
 * source account, then `prepareTransaction` (which SIMULATES against the live
 * contract — a wrong ScVal type or a failing guard shows up here). Returns the
 * assembled XDR + the hash to sign. Throws with the simulation error verbatim
 * on failure (used to capture attack rejections).
 */
export async function buildInvoke(
  fnName: string,
  source: string,
  args: xdr.ScVal[],
): Promise<BuiltTx> {
  const s = server();
  const acct = await s.getAccount(source);
  const c = new Contract(REGISTRY_ID);
  const tx0 = new TransactionBuilder(acct, {
    fee: "10000000",
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(c.call(fnName, ...args))
    .setTimeout(180)
    .build();
  const prepared = await s.prepareTransaction(tx0); // throws on sim error
  return {
    buildId: randomUUID(),
    xdr: prepared.toXDR(),
    hashHex: prepared.hash().toString("hex"),
  };
}

// ── Submit (attach wallet signature, send, poll) ─────────────────────────────

export interface SubmitResult {
  hash: string;
  status: string;
  returnValue: unknown;
}

/**
 * Submit a transaction the wallet already fully signed (Stellar Wallets Kit
 * `signTransaction` returns a complete signed XDR), and poll until it lands.
 * `expectXdr` is the unsigned tx the server built for this buildId; we require
 * the signed tx to be that exact transaction (same hash) so a client cannot
 * swap in a different tx than the one whose packet/proof the server holds.
 */
export async function submitSignedXdr(
  signedXdr: string,
  expectXdr: string,
): Promise<SubmitResult> {
  const s = server();
  const tx = TransactionBuilder.fromXDR(signedXdr, NETWORK_PASSPHRASE) as Transaction;
  const expected = TransactionBuilder.fromXDR(expectXdr, NETWORK_PASSPHRASE) as Transaction;
  if (tx.hash().toString("hex") !== expected.hash().toString("hex")) {
    throw new Error("signed transaction does not match the built transaction");
  }

  const sent = await s.sendTransaction(tx);
  if (sent.status === "ERROR") {
    throw new Error(
      `sendTransaction ERROR: ${JSON.stringify(sent.errorResult?.result?.() ?? sent.errorResult ?? sent)}`,
    );
  }

  const hash = sent.hash;
  const start = Date.now();
  let got = await s.getTransaction(hash);
  while (got.status === rpc.Api.GetTransactionStatus.NOT_FOUND && Date.now() - start < 60_000) {
    await new Promise((r) => setTimeout(r, 1500));
    got = await s.getTransaction(hash);
  }

  if (got.status === rpc.Api.GetTransactionStatus.SUCCESS) {
    let returnValue: unknown = null;
    try {
      if (got.returnValue) returnValue = scValToNative(got.returnValue);
    } catch {
      returnValue = null;
    }
    return { hash, status: "SUCCESS", returnValue };
  }

  if (got.status === rpc.Api.GetTransactionStatus.FAILED) {
    throw new Error(`transaction FAILED (${hash}): ${JSON.stringify(got.resultXdr?.toXDR?.("base64") ?? got)}`);
  }
  throw new Error(`transaction not confirmed within timeout (${hash}), status=${got.status}`);
}

// ── Simulate-only (capture a contract rejection verbatim) ────────────────────

/**
 * Simulate an invoke without submitting, returning the contract error verbatim
 * on rejection. Used by the attack beats — permissionless entrypoints (deliver)
 * run their full guard + proof-verify logic under simulation, so a rejection is
 * captured with its exact `Error(Contract, #n)`.
 */
export async function simulateInvoke(
  fnName: string,
  source: string | undefined,
  args: xdr.ScVal[],
): Promise<{ ok: boolean; error?: string }> {
  const s = server();
  const acct = new Account(source ?? DUMMY_PK, "0"); // sequence irrelevant to sim
  const c = new Contract(REGISTRY_ID);
  const tx = new TransactionBuilder(acct, {
    fee: "10000000",
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(c.call(fnName, ...args))
    .setTimeout(180)
    .build();
  const sim = await s.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) return { ok: false, error: sim.error };
  return { ok: true };
}

// ── Reads (simulate `status`, read native balance) ───────────────────────────

/** Raw decoded `Shipment` record from `status(id)`, or a not-found/error tag. */
export type StatusResult =
  | { ok: true; raw: Record<string, unknown> }
  | { ok: false; reason: "notfound" }
  | { ok: false; reason: "rpc"; detail: string };

export async function readShipmentRaw(id: number | string): Promise<StatusResult> {
  try {
    const s = server();
    const acct = new Account(DUMMY_PK, "0");
    const c = new Contract(REGISTRY_ID);
    const tx = new TransactionBuilder(acct, {
      fee: "100",
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(c.call("status", scU64(id)))
      .setTimeout(30)
      .build();
    const sim = await s.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(sim)) {
      if (/#11\b/.test(sim.error)) return { ok: false, reason: "notfound" };
      return { ok: false, reason: "rpc", detail: sim.error };
    }
    const retval = sim.result?.retval;
    if (!retval) return { ok: false, reason: "notfound" };
    return { ok: true, raw: scValToNative(retval) as Record<string, unknown> };
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    if (/#11\b/.test(detail)) return { ok: false, reason: "notfound" };
    return { ok: false, reason: "rpc", detail };
  }
}

/**
 * Read the wallet's on-chain role binding + active service count from the
 * registry (plan 001 entrypoints). `role_of(addr)` returns `Option<Role>` — a
 * u32-tagged unit enum (`0 → "merchant"`, `1 → "carrier"`) or None (`scvVoid`
 * → null) when the wallet has never bound a role. `active_count(addr)` returns
 * a u32. On any read error, degrade to `{ role: null, activeCount: 0 }` so the
 * modal/switcher treat the wallet as unbound rather than crash.
 */
export async function readRole(
  address: string,
): Promise<{ role: string | null; activeCount: number }> {
  try {
    const s = server();
    const acct = new Account(DUMMY_PK, "0");
    const c = new Contract(REGISTRY_ID);

    const build = (fn: string) =>
      new TransactionBuilder(acct, {
        fee: "100",
        networkPassphrase: NETWORK_PASSPHRASE,
      })
        .addOperation(c.call(fn, scAddr(address)))
        .setTimeout(30)
        .build();

    let role: string | null = null;
    const roleSim = await s.simulateTransaction(build("role_of"));
    if (!rpc.Api.isSimulationError(roleSim) && roleSim.result?.retval) {
      const native = scValToNative(roleSim.result.retval);
      if (native === 0 || native === 0n) role = "merchant";
      else if (native === 1 || native === 1n) role = "carrier";
      // null/None or any unexpected value → leave role unbound (null)
    }

    let activeCount = 0;
    const countSim = await s.simulateTransaction(build("active_count"));
    if (!rpc.Api.isSimulationError(countSim) && countSim.result?.retval) {
      activeCount = Number(scValToNative(countSim.result.retval)) || 0;
    }

    return { role, activeCount };
  } catch {
    return { role: null, activeCount: 0 };
  }
}

/** Native XLM balance (as a decimal XLM string) via a ledger-entry read. */
export async function nativeBalanceXlm(address: string): Promise<string | null> {
  try {
    const s = server();
    const key = xdr.LedgerKey.account(
      new xdr.LedgerKeyAccount({ accountId: Keypair.fromPublicKey(address).xdrAccountId() }),
    );
    const resp = await s.getLedgerEntries(key);
    const entry = resp.entries?.[0];
    if (!entry) return null;
    const stroops = entry.val.account().balance().toString();
    return (Number(BigInt(stroops)) / 1e7).toString();
  } catch {
    return null;
  }
}

/** Does the account exist on-chain (is it funded)? */
export async function accountExists(address: string): Promise<boolean> {
  try {
    await server().getAccount(address);
    return true;
  } catch {
    return false;
  }
}
