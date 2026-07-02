"use client";

/**
 * Wallet-signed on-chain flows — the orchestration layer for every mutating
 * Stellar action in the console. Each flow is the two-step non-custodial dance:
 *
 *   1. api.buildTx  — the STATELESS server builds + prepares the invoke with the
 *                     connected wallet as source, returns { buildId, hashHex }.
 *   2. signHash     — the connected Privy Stellar wallet signs that 32-byte hash
 *                     (pops the wallet confirmation — that IS the authorization).
 *   3. api.submitTx — the server attaches the signature + submits. It holds no
 *                     keys and cannot forge; the signature is the wallet's.
 *
 * Role panels call THESE for create/accept/submitFlight/deliver/refund, and the
 * plain api.* wrappers for the stateless server work (verify/fly/prove/pod/…).
 */

import { api } from "./api";
import { useWallet } from "./wallet-context";
import type {
  ActionResult,
  CreateParams,
  SubmitTxRes,
  TxAction,
} from "./types";

export interface WalletFlows {
  create: (params: CreateParams) => Promise<ActionResult<SubmitTxRes>>;
  accept: (shipmentId: number) => Promise<ActionResult<SubmitTxRes>>;
  submitFlight: (shipmentId: number) => Promise<ActionResult<SubmitTxRes>>;
  deliver: (shipmentId: number) => Promise<ActionResult<SubmitTxRes>>;
  refund: (shipmentId: number) => Promise<ActionResult<SubmitTxRes>>;
}

export function useWalletFlows(): WalletFlows {
  const { stellarAddress, signHash } = useWallet();

  async function run(
    action: TxAction,
    opts: { shipmentId?: number; params?: Record<string, unknown> },
  ): Promise<ActionResult<SubmitTxRes>> {
    if (!stellarAddress) {
      return { ok: false, error: "Connect your Stellar wallet first" };
    }

    const built = await api.buildTx({
      action,
      source: stellarAddress,
      shipmentId: opts.shipmentId,
      params: opts.params,
    });
    if (!built.ok || !built.data) {
      return { ok: false, error: built.error ?? "Could not build the transaction" };
    }

    let signatureHex: string;
    try {
      signatureHex = await signHash(built.data.hashHex);
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : "Wallet signing was cancelled",
      };
    }

    return api.submitTx({
      buildId: built.data.buildId,
      signatureHex,
      pubkey: stellarAddress,
    });
  }

  return {
    create: (params) =>
      run("create", { params: params as unknown as Record<string, unknown> }),
    accept: (shipmentId) => run("accept", { shipmentId }),
    submitFlight: (shipmentId) => run("submitFlight", { shipmentId }),
    deliver: (shipmentId) => run("deliver", { shipmentId }),
    refund: (shipmentId) => run("refund", { shipmentId }),
  };
}
