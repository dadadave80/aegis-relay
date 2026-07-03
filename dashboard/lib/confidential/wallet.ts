/**
 * Browser confidential wallet — the client-side port of the merchant + escrow
 * flow in prover/src/confidential.ts, driven by the connected Freighter wallet.
 *
 * All proving is bb.js UltraHonk IN THE BROWSER (Phase A′ proved this works).
 * The merchant's confidential `sk` is derived deterministically from a Freighter
 * `signMessage` (derive-key.ts) and never leaves the device. The per-shipment
 * escrow account E is app-managed: a fresh Stellar keypair + Grumpkin key, whose
 * record (E's secret + Grumpkin + opening) is handed back for the SERVER MAILBOX
 * (store.ts) — holding E's key is a hook-caged capability, not spending authority
 * (the token's AegisEscrowHooks reject any move the registry state machine
 * disallows, error 4302).
 *
 * Mirrors the CLI 1:1: only the signer (kit vs keystore), the persistence
 * (returned record vs escrow.json), and the prover backend (browser vs node)
 * differ — the witness params, submit calls, and opening checks are identical.
 */

import {
  ChainClient,
  StateEngine,
  LocalStorageStore,
  keypairSigner,
  deriveKeys,
  serializeKeys,
  deserializeKeys,
  randomScalar,
  addressToField,
  commit,
  toHex32,
  proverFromArtifact,
  buildRegisterWitness,
  buildTransferWitness,
  submitRegister,
  submitDeposit,
  submitMerge,
  submitTransfer,
  type Signer,
  type KeyPair,
  type CircuitProver,
  type SerializedKeyPair,
} from "@ctd/sdk";
import registerCircuit from "@ctd/sdk/circuits/register.json";
import transferCircuit from "@ctd/sdk/circuits/transfer.json";
import { Keypair } from "@stellar/stellar-sdk";

import { CT_DEPLOYMENT } from "./deployment";
import { keyDerivationMessage, skFromSignature } from "./derive-key";
import { kitMessageSigner, type KitLike, type MessageSigner } from "./wallet-signer";
import { ensureBrowserBackend } from "./bb-loader";

type Log = (msg: string) => void;
const noop: Log = () => {};

/** Coarse progress for UI button labels. */
export type TxPhase = "proving" | "submitting";

/**
 * Per-shipment escrow packet — E's keys + the funds' only decryption handle.
 * Persisted in the SERVER mailbox (store.ts), NEVER committed. Shape mirrors the
 * CLI's escrow.json (prover/src/confidential.ts EscrowFile).
 */
export interface EscrowRecord {
  version: 1;
  /** E's Stellar address (G…). */
  escrow: string;
  /** E's Stellar secret seed — mailbox material, never printed/committed. */
  stellarSecret: string;
  /** E's Grumpkin keys (sk + addrF), serialized. */
  grumpkin: SerializedKeyPair;
  /** Post-merge spendable opening of E — the funds' decryption handle. */
  opening: { v: string; r: string };
  token: string;
  registry: string;
  txs: Record<string, string>;
}

function circuits() {
  return {
    register: registerCircuit as unknown as { bytecode: string } & Record<string, unknown>,
    transfer: transferCircuit as unknown as { bytecode: string } & Record<string, unknown>,
  };
}

/** Register `address` on the token if not already (idempotent). Signed by `signer`. */
async function ensureRegistered(
  client: ChainClient,
  signer: Signer,
  address: string,
  keys: KeyPair,
  label: string,
  log: Log,
): Promise<string | undefined> {
  if (await client.isRegistered(address)) {
    log(`${label}: already registered`);
    return undefined;
  }
  const prover: CircuitProver = proverFromArtifact(circuits().register);
  try {
    const w = buildRegisterWitness(keys);
    log(`${label}: proving register…`);
    const { proof } = await prover.prove(w.inputs);
    log(`${label}: submitting register…`);
    const r = await submitRegister(client, signer, address, CT_DEPLOYMENT.auditorId, w, proof);
    log(`${label}: registered (tx ${r.hash.slice(0, 10)}…)`);
    return r.hash;
  } finally {
    await prover.destroy();
  }
}

/**
 * The connected merchant's confidential identity + balance, wallet-driven.
 * `connect` derives the key (one Freighter signMessage, cached per token+account)
 * and syncs the balance; `ensureFloat`/`fundEscrow` mirror the CLI's
 * setup-merchant + fund-escrow.
 */
export class ConfidentialMerchant {
  private transferProver?: CircuitProver;

  private constructor(
    readonly address: string,
    private signer: MessageSigner,
    private keys: KeyPair,
    private client: ChainClient,
    private engine: StateEngine,
    private log: Log,
  ) {}

  static async connect(kit: KitLike, address: string, log: Log = noop): Promise<ConfidentialMerchant> {
    ensureBrowserBackend();
    const { networkPassphrase, deployedAtLedger, contracts } = CT_DEPLOYMENT;
    const signer = kitMessageSigner(kit, address, networkPassphrase);

    const client = new ChainClient({
      rpcUrl: CT_DEPLOYMENT.rpcUrl,
      networkPassphrase,
      contracts: { token: contracts.token, verifier: contracts.verifier, auditor: contracts.auditor },
    });

    const addrF = addressToField(contracts.token);
    const skKey = `aegis:ct:sk:${contracts.token}:${address}`;
    const stored = typeof window !== "undefined" ? window.localStorage.getItem(skKey) : null;
    let sk: bigint;
    if (stored) {
      sk = BigInt(stored);
    } else {
      log("sign the key-derivation message in Freighter…");
      const signature = await signer.signMessage(keyDerivationMessage(networkPassphrase, contracts.token));
      sk = await skFromSignature(signature);
      if (typeof window !== "undefined") window.localStorage.setItem(skKey, toHex32(sk));
      log("derived confidential key from wallet signature (cached)");
    }
    const keys = deriveKeys(sk, addrF);

    const engine = new StateEngine({
      client,
      store: new LocalStorageStore(`aegis:ct:${contracts.token}`),
      keys,
      address,
      fromLedger: deployedAtLedger,
    });

    return new ConfidentialMerchant(address, signer, keys, client, engine, log);
  }

  private prover(): CircuitProver {
    if (!this.transferProver) this.transferProver = proverFromArtifact(circuits().transfer);
    return this.transferProver;
  }

  /** Current confidential spendable balance (units), reconstructed from chain. */
  async spendable(): Promise<bigint> {
    return (await this.engine.sync()).spendable.v;
  }

  /**
   * Ensure the merchant has ≥ `amount` confidential spendable balance, minting
   * the shortfall via a PUBLIC deposit (the merchant's aggregate float — a §6.6
   * residual leak, stated honestly) + merge. Registers first if needed.
   */
  async ensureFloat(amount: bigint, onPhase?: (p: TxPhase) => void): Promise<void> {
    await ensureRegistered(this.client, this.signer, this.address, this.keys, "merchant", this.log);
    let s = await this.engine.sync();
    if (s.spendable.v >= amount) return;
    const shortfall = amount - s.spendable.v;
    onPhase?.("submitting");
    this.log(`depositing ${shortfall} units (PUBLIC float) + merging…`);
    await submitDeposit(this.client, this.signer, this.address, this.address, shortfall);
    await submitMerge(this.client, this.signer, this.address);
    s = await this.engine.sync();
    if (s.spendable.v < amount) {
      throw new Error(`merchant spendable ${s.spendable.v} still < ${amount} after deposit`);
    }
  }

  /**
   * Fund a fresh escrow account E with `amount` (HIDDEN via confidential_transfer
   * merchant→E). Ports cmdFundEscrow: fresh E, friendbot, register E, merchant→E
   * transfer, merge E, verify the persisted opening re-commits to E's on-chain
   * balance. Returns E's record for the mailbox — never the secret to any log.
   */
  async fundEscrow(amount: bigint, onPhase?: (p: TxPhase) => void): Promise<EscrowRecord> {
    const { networkPassphrase, friendbotUrl, contracts } = CT_DEPLOYMENT;
    const addrF = addressToField(contracts.token);
    await this.ensureFloat(amount, onPhase);

    // Fresh per-shipment E: Stellar keypair + Grumpkin key.
    const eKp = Keypair.random();
    const res = await fetch(`${friendbotUrl}/?addr=${encodeURIComponent(eKp.publicKey())}`);
    if (!res.ok && res.status !== 400) throw new Error(`friendbot failed for escrow account: ${res.status}`);
    const eSigner = keypairSigner(eKp.secret(), networkPassphrase);
    const eKeys = deriveKeys(randomScalar(), addrF);
    this.log(`escrow E = ${eKp.publicKey().slice(0, 8)}… (fresh account)`);

    const txs: Record<string, string> = {};
    const regTx = await ensureRegistered(this.client, eSigner, eKp.publicKey(), eKeys, "escrow E", this.log);
    if (regTx) txs.register = regTx;

    // confidential_transfer merchant → E: the amount is HIDDEN from here on.
    const s = await this.engine.sync();
    if (s.spendable.v < amount) throw new Error(`merchant spendable ${s.spendable.v} < ${amount}`);
    const kAud = await this.client.auditorKey(CT_DEPLOYMENT.auditorId);
    const w = buildTransferWitness({
      keys: this.keys,
      v: s.spendable.v,
      r: s.spendable.r,
      amount,
      pvkB: eKeys.PVK,
      kAudR: kAud,
      kAudS: kAud,
    });
    onPhase?.("proving");
    this.log("proving confidential_transfer merchant→E…");
    const { proof } = await this.prover().prove(w.inputs);
    onPhase?.("submitting");
    this.log("submitting confidential_transfer merchant→E (amount hidden)…");
    const t = await submitTransfer(this.client, this.signer, this.address, eKp.publicKey(), w, proof);
    txs.fund = t.hash;
    await this.engine.setSpendable(w.next);

    // E folds the credit into its spendable balance.
    const mg = await submitMerge(this.client, eSigner, eKp.publicKey());
    txs.merge = mg.hash;

    // Post-merge spendable opening of E = (amount, r_tx). Verify it re-commits.
    const rTx = w.recipientView.rTx;
    const onchain = await this.client.confidentialBalance(eKp.publicKey());
    if (!onchain || !commit(amount, rTx).equals(onchain.spendableBalance)) {
      throw new Error("persisted opening does not re-commit to E’s on-chain balance");
    }

    return {
      version: 1,
      escrow: eKp.publicKey(),
      stellarSecret: eKp.secret(),
      grumpkin: serializeKeys(eKeys),
      opening: { v: amount.toString(), r: toHex32(rTx) },
      token: contracts.token,
      registry: CT_DEPLOYMENT.registry,
      txs,
    };
  }

  async destroy(): Promise<void> {
    await this.transferProver?.destroy();
  }
}

/**
 * Settle (or refund) an escrow: confidential_transfer E → `to`, signed by E's
 * keypair, proved in the browser. Ports escrowTransfer/cmdSettle. The token's
 * AegisEscrowHooks admit it ONLY when the registry says release is allowed
 * (Delivered ⇒ payout; Expired ⇒ merchant) — a premature attempt aborts #4302.
 * The caller must have registered `to` on the token first (payout account).
 */
export async function settleEscrow(record: EscrowRecord, to: string, log: Log = noop): Promise<string> {
  ensureBrowserBackend();
  const { networkPassphrase, contracts } = CT_DEPLOYMENT;
  const client = new ChainClient({
    rpcUrl: CT_DEPLOYMENT.rpcUrl,
    networkPassphrase,
    contracts: { token: contracts.token, verifier: contracts.verifier, auditor: contracts.auditor },
  });

  const eKeys = deserializeKeys(record.grumpkin);
  const eSigner = keypairSigner(record.stellarSecret, networkPassphrase);
  const v = BigInt(record.opening.v);
  const r = BigInt(record.opening.r);

  const onchain = await client.confidentialBalance(record.escrow);
  if (!onchain || !commit(v, r).equals(onchain.spendableBalance)) {
    throw new Error("escrow opening no longer matches the on-chain commitment — refusing to build a proof");
  }
  const toAccount = await client.confidentialBalance(to);
  if (!toAccount) throw new Error(`${to} is not registered on the token — register it first`);

  const kAud = await client.auditorKey(CT_DEPLOYMENT.auditorId);
  const prover = proverFromArtifact(circuits().transfer);
  try {
    const w = buildTransferWitness({
      keys: eKeys,
      v,
      r,
      amount: v, // single milestone [10000]: the full escrow moves
      pvkB: toAccount.viewingPublicKey,
      kAudR: kAud,
      kAudS: kAud,
    });
    log("proving confidential_transfer E→payout…");
    const { proof } = await prover.prove(w.inputs);
    log("submitting settle (hook gate: Delivered ⇒ payout only)…");
    const res = await submitTransfer(client, eSigner, record.escrow, to, w, proof);
    return res.hash;
  } finally {
    await prover.destroy();
  }
}
