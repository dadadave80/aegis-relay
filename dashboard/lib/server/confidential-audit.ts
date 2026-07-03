/**
 * Server-side regulator audit — the real decrypt (ports prover/src/confidential.ts
 * cmdAudit). The auditor's Grumpkin SECRET stays on the server (prover/out/
 * auditor-key.json, gitignored); it decrypts the dual auditor ciphertexts of a
 * confidential settlement transfer. This is the ONE @ctd/sdk consumer on the
 * server, and it only reads events + decrypts — no proving, no bb.js.
 *
 * "private to the world, transparent to the regulator" (DESIGN §6.6).
 */
import "server-only";
import {
  ChainClient,
  fetchEvents,
  auditTransfer,
  type TransferEvent,
} from "@ctd/sdk";

import {
  CT_TOKEN_ID,
  CT_VERIFIER_ID,
  CT_AUDITOR_ID,
  CT_DEPLOYED_LEDGER,
  RPC_URL,
  NETWORK_PASSPHRASE,
  loadAuditorKey,
} from "./artifacts";

export interface AuditDecrypt {
  amountXlm: string;
  amountUnits: string;
  txHash: string;
  from: string;
  to: string;
  channelsAgree: boolean;
}

function client(): ChainClient {
  return new ChainClient({
    rpcUrl: RPC_URL,
    networkPassphrase: NETWORK_PASSPHRASE,
    contracts: { token: CT_TOKEN_ID, verifier: CT_VERIFIER_ID, auditor: CT_AUDITOR_ID },
  });
}

/**
 * Decrypt the last confidential transfer on the current CT token (or the one at
 * `txHash`). Returns null when the auditor key is absent or no transfer exists
 * yet — the caller renders an honest note, never a canned amount.
 */
export async function auditLastTransfer(txHash?: string): Promise<AuditDecrypt | null> {
  const key = loadAuditorKey();
  if (!key) return null;

  const { events } = await fetchEvents(client(), { startLedger: CT_DEPLOYED_LEDGER });
  const transfers = events.filter((ev): ev is TransferEvent => ev.type === "transfer");
  const ev = txHash ? transfers.find((t) => t.txHash === txHash) : transfers[transfers.length - 1];
  if (!ev) return null;

  const audit = auditTransfer(BigInt(key.secretHex), ev);
  return {
    amountXlm: (Number(audit.amount) / 1e7).toString(),
    amountUnits: audit.amount.toString(),
    txHash: ev.txHash,
    from: ev.from,
    to: ev.to,
    channelsAgree: audit.channelsAgree,
  };
}
