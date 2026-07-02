/**
 * confidential.ts — confidential-escrow rail operator CLI (DESIGN.md §6.6,
 * PIVOT §3.3; rung R3 / CT-A).
 *
 * Drives the hook-caged escrow lifecycle on the Aegis fork of the OpenZeppelin
 * confidential token via `@ctd/sdk` (UltraHonk/Grumpkin — a different proving
 * stack from Aegis's Groth16, consumed strictly as a black box; guardrail 10).
 * Client state uses the SDK's node json-store backend under
 * `prover/out/ct-state/` (T26: openings must outlive the RPC's ~7-day event
 * retention — they are persisted here and in the per-shipment escrow file).
 *
 * Commands:
 *   setup-merchant --amount <units>
 *       Register relay-merchant on the token (auditor 0), `deposit` (the
 *       amount is PUBLIC on-chain — the merchant's aggregate float, an honest
 *       §6.6 residual leak), `merge` into spendable.
 *
 *   fund-escrow --id-hint <label> --amount <units>
 *       Fresh Stellar keypair E (friendbot-funded) + fresh Grumpkin keys;
 *       register E; confidential_transfer merchant→E (amount HIDDEN); merge E.
 *       Persists E's keys + the transfer opening (v, r) to
 *       prover/out/ships/<label>/escrow.json (gitignored — the packet home).
 *       Prints E's ADDRESS only, never its secrets.
 *
 *   create-shipment --escrow <file> --to-lat <deg> --to-lon <deg>
 *                   [--deadline-hours 24]
 *       Direct `create_shipment` invoke on the confidential rail: amount 0,
 *       milestones [10000], rail Confidential, escrow E (merchant.ts predates
 *       the rail/escrow params, so the confidential create lives here).
 *
 *   verify-escrow --escrow <file>
 *       Decrypt E's balance from the persisted opening and compare
 *       commit(v, r) against the ON-CHAIN commitment — the carrier-side
 *       packet-verify extended to funds (T12) plus the token-pin check (T25).
 *
 *   settle --id <n> --escrow <file> --payout <G...> [--payout-source <key>]
 *       confidential_transfer(E → payout) signed with E's key. Run AFTER
 *       registry `deliver`: the AegisEscrowHooks gate admits it only when
 *       `release_allowed(id, payout)` — premature attempts abort with #4302.
 *       Registers the payout's token account first if absent.
 *
 *   refund --id <n> --escrow <file>
 *       Same transfer to the merchant, admitted only after `refund_expired`.
 *
 *   withdraw-probe --escrow <file>
 *       Attempt a `withdraw` from E to the public rail — the hook must abort
 *       with #4301 unconditionally (T24 negative probe).
 *
 *   audit --tx <hash|last>
 *       Decrypt the dual auditor ciphertexts of a settlement transfer with
 *       the regulator key (prover/out/auditor-key.json) — the compliance beat:
 *       private to the world, transparent to the regulator.
 *
 * Never prints or persists any secret outside gitignored prover/out/.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { Keypair } from '@stellar/stellar-sdk';
import {
  ChainClient,
  keypairSigner,
  type Signer,
  type KeyPair,
  deriveKeys,
  deserializeKeys,
  serializeKeys,
  randomScalar,
  addressToField,
  commit,
  toHex32,
  CircuitProver,
  buildRegisterWitness,
  buildWithdrawWitness,
  buildTransferWitness,
  submitRegister,
  submitDeposit,
  submitMerge,
  submitWithdraw,
  submitTransfer,
  StateEngine,
  fetchEvents,
  auditTransfer,
  type TransferEvent,
} from '@ctd/sdk';
import { JsonFileStore } from '@ctd/sdk/state/json-store';
import type { CompiledCircuit } from '@noir-lang/noir_js';

import { buildInvoke, parseFlags, runInvoke, TESTNET } from './lib/contract.js';
import { buildShipment } from './merchant.js';
import { writePacket } from './lib/packet.js';

const PROVER_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(PROVER_ROOT, 'out');
const KEYS_DIR = join(OUT_DIR, 'ct-keys');
const STATE_PATH = join(OUT_DIR, 'ct-state', 'state.json');
const DEPLOYMENT_PATH = process.env.AEGIS_CT_DEPLOYMENT ?? join(OUT_DIR, 'ct-deployment.json');

const AUDITOR_ID = 0;
const FRIENDBOT = 'https://friendbot.stellar.org';

// ── Deployment + client plumbing ────────────────────────────────────────────

interface Deployment {
  cliNetwork: string;
  rpcUrl: string;
  passphrase: string;
  deployedAtLedger: number;
  contracts: {
    registry: string;
    credentials: string;
    airspace: string;
    ctVerifier: string;
    ctAuditor: string;
    ctToken: string;
    underlying: string;
  };
}

function loadDeployment(): Deployment {
  if (!existsSync(DEPLOYMENT_PATH)) {
    throw new Error(`no deployment record at ${DEPLOYMENT_PATH} — run prover/scripts/deploy-all.mjs`);
  }
  return JSON.parse(readFileSync(DEPLOYMENT_PATH, 'utf8')) as Deployment;
}

function makeClient(dep: Deployment): ChainClient {
  return new ChainClient({
    rpcUrl: dep.rpcUrl,
    networkPassphrase: dep.passphrase,
    contracts: { token: dep.contracts.ctToken, verifier: dep.contracts.ctVerifier, auditor: dep.contracts.ctAuditor },
  });
}

/** Keystore secret — memory only, NEVER printed or persisted by this CLI. */
function keystoreSecret(name: string): string {
  return execFileSync('stellar', ['keys', 'show', name], { encoding: 'utf8' }).trim();
}

function keystorePublic(name: string): string {
  return execFileSync('stellar', ['keys', 'public-key', name], { encoding: 'utf8' }).trim();
}

/** Parse a units amount, tolerating 3_000_000_000-style separators. */
function parseUnits(s: string): bigint {
  return BigInt(s.replaceAll('_', ''));
}

// ── Grumpkin key persistence (gitignored out/ct-keys/<role>.json) ───────────

function loadOrCreateRoleKeys(role: string, addrF: bigint): KeyPair {
  mkdirSync(KEYS_DIR, { recursive: true });
  const path = join(KEYS_DIR, `${role}.json`);
  if (existsSync(path)) {
    const keys = deserializeKeys(JSON.parse(readFileSync(path, 'utf8')));
    if (keys.addrF !== addrF) {
      throw new Error(`${path} is bound to a different token deployment (addr_f mismatch) — delete it to re-key`);
    }
    return keys;
  }
  const keys = deriveKeys(randomScalar(), addrF);
  writeFileSync(path, JSON.stringify(serializeKeys(keys), null, 2) + '\n');
  return keys;
}

// ── Circuit proving (Node: circuits ship inside @ctd/sdk) ───────────────────

function loadCircuitJson(name: 'register' | 'withdraw' | 'transfer'): CompiledCircuit {
  const url = import.meta.resolve(`@ctd/sdk/circuits/${name}.json`);
  return JSON.parse(readFileSync(fileURLToPath(url), 'utf8')) as CompiledCircuit;
}

// ── State engines (json-store backend, T26) ─────────────────────────────────

function engineFor(client: ChainClient, dep: Deployment, keys: KeyPair, address: string): StateEngine {
  mkdirSync(dirname(STATE_PATH), { recursive: true });
  return new StateEngine({
    client,
    store: new JsonFileStore(STATE_PATH),
    keys,
    address,
    fromLedger: dep.deployedAtLedger,
  });
}

// ── Escrow file (the packet home for E's keys + opening — T26) ──────────────

interface EscrowFile {
  version: 1;
  escrow: string;
  /** E's Stellar secret seed — packet material, gitignored, never stdout. */
  stellarSecret: string;
  /** E's Grumpkin keys, serialized (sk + addrF). */
  grumpkin: { sk: string; addrF: string };
  /** Post-merge spendable opening of E — the funds' only decryption handle. */
  opening: { v: string; r: string };
  token: string;
  registry: string;
  shipmentId?: string;
  txs: Record<string, string>;
}

function readEscrowFile(path: string): EscrowFile {
  const f = JSON.parse(readFileSync(path, 'utf8')) as EscrowFile;
  if (!f.escrow || !f.grumpkin || !f.opening) throw new Error(`${path} is not an escrow file`);
  return f;
}

function writeEscrowFile(path: string, f: EscrowFile): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(f, null, 2) + '\n');
}

// ── Registration helper (idempotent) ────────────────────────────────────────

async function ensureRegistered(
  client: ChainClient,
  signer: Signer,
  address: string,
  keys: KeyPair,
  label: string,
): Promise<string | undefined> {
  if (await client.isRegistered(address)) {
    console.log(`${label}: already registered on the token`);
    return undefined;
  }
  const prover = new CircuitProver(loadCircuitJson('register'));
  try {
    const w = buildRegisterWitness(keys);
    const { proof } = await prover.prove(w.inputs);
    const r = await submitRegister(client, signer, address, AUDITOR_ID, w, proof);
    console.log(`${label}: registered (auditor ${AUDITOR_ID}, tx ${r.hash})`);
    return r.hash;
  } finally {
    await prover.destroy();
  }
}

// ── Commands ────────────────────────────────────────────────────────────────

async function cmdSetupMerchant(flags: Record<string, string>): Promise<void> {
  if (!flags.amount) throw new Error('usage: setup-merchant --amount <units>');
  const amount = parseUnits(flags.amount);
  const dep = loadDeployment();
  const client = makeClient(dep);
  const addrF = addressToField(dep.contracts.ctToken);

  const merchantPub = keystorePublic('relay-merchant');
  const signer = keypairSigner(keystoreSecret('relay-merchant'), dep.passphrase);
  const keys = loadOrCreateRoleKeys('merchant', addrF);

  await ensureRegistered(client, signer, merchantPub, keys, 'merchant');

  console.log(
    `NOTE: this deposit of ${amount} units is PUBLIC on-chain — it is the merchant's ` +
      `aggregate float across shipments, not a per-shipment figure (DESIGN §6.6 residual leak, stated honestly).`,
  );
  const d = await submitDeposit(client, signer, merchantPub, merchantPub, amount);
  console.log(`deposit  tx ${d.hash}`);
  const m = await submitMerge(client, signer, merchantPub);
  console.log(`merge    tx ${m.hash}`);

  const engine = engineFor(client, dep, keys, merchantPub);
  const s = await engine.sync();
  const v = await engine.verifyAgainstChain();
  console.log(`merchant spendable = ${s.spendable.v} units (state matches chain: ${v.ok})`);
  if (!v.ok) throw new Error('merchant state does not re-commit to the on-chain balance');
}

async function cmdFundEscrow(flags: Record<string, string>): Promise<void> {
  const label = flags['id-hint'] ?? flags.label;
  if (!label || !flags.amount) throw new Error('usage: fund-escrow --id-hint <label> --amount <units>');
  const amount = parseUnits(flags.amount);
  const dep = loadDeployment();
  const client = makeClient(dep);
  const addrF = addressToField(dep.contracts.ctToken);

  // Fresh per-shipment escrow account E: Stellar keypair + Grumpkin keys.
  const eKp = Keypair.random();
  const res = await fetch(`${FRIENDBOT}/?addr=${encodeURIComponent(eKp.publicKey())}`);
  if (!res.ok && res.status !== 400) throw new Error(`friendbot failed for escrow account: ${res.status}`);
  const eSigner = keypairSigner(eKp.secret(), dep.passphrase);
  const eKeys = deriveKeys(randomScalar(), addrF);
  console.log(`escrow E = ${eKp.publicKey()}  (fresh account; secrets go to the escrow file only)`);

  const txs: Record<string, string> = {};
  const regTx = await ensureRegistered(client, eSigner, eKp.publicKey(), eKeys, 'escrow E');
  if (regTx) txs.register = regTx;

  // Merchant side: current spendable opening from the synced state engine.
  const merchantPub = keystorePublic('relay-merchant');
  const merchantSigner = keypairSigner(keystoreSecret('relay-merchant'), dep.passphrase);
  const merchantKeys = loadOrCreateRoleKeys('merchant', addrF);
  const merchantEngine = engineFor(client, dep, merchantKeys, merchantPub);
  const ms = await merchantEngine.sync();
  if (ms.spendable.v < amount) {
    throw new Error(`merchant spendable ${ms.spendable.v} < ${amount} — run setup-merchant first`);
  }

  // confidential_transfer merchant → E: the amount is HIDDEN from here on.
  const kAud = await client.auditorKey(AUDITOR_ID);
  const prover = new CircuitProver(loadCircuitJson('transfer'));
  let w;
  try {
    w = buildTransferWitness({
      keys: merchantKeys,
      v: ms.spendable.v,
      r: ms.spendable.r,
      amount,
      pvkB: eKeys.PVK,
      kAudR: kAud,
      kAudS: kAud,
    });
    const { proof } = await prover.prove(w.inputs);
    const t = await submitTransfer(client, merchantSigner, merchantPub, eKp.publicKey(), w, proof);
    txs.fund = t.hash;
    console.log(`confidential_transfer merchant→E: tx ${t.hash}  (amount hidden on-chain)`);
  } finally {
    await prover.destroy();
  }
  await merchantEngine.setSpendable(w.next); // optimistic; sync reconciles below

  // E folds the credit into its spendable balance.
  const mg = await submitMerge(client, eSigner, eKp.publicKey());
  txs.merge = mg.hash;
  console.log(`merge E: tx ${mg.hash}`);

  // Post-merge spendable opening of E = (amount, r_tx) — persist it (T26:
  // the only other copy lives in RPC events with ~7-day retention).
  const opening = { v: amount, r: w.recipientView.rTx };
  const onchain = await client.confidentialBalance(eKp.publicKey());
  const openingOk = onchain !== null && commit(opening.v, opening.r).equals(onchain.spendableBalance);
  if (!openingOk) throw new Error('persisted opening does not re-commit to E’s on-chain balance');

  const escrowPath = join(OUT_DIR, 'ships', label, 'escrow.json');
  writeEscrowFile(escrowPath, {
    version: 1,
    escrow: eKp.publicKey(),
    stellarSecret: eKp.secret(),
    grumpkin: serializeKeys(eKeys),
    opening: { v: opening.v.toString(), r: toHex32(opening.r) },
    token: dep.contracts.ctToken,
    registry: dep.contracts.registry,
    txs,
  });
  const merchantAfter = await merchantEngine.sync();
  console.log(`merchant spendable now ${merchantAfter.spendable.v} units (opening reconciled from chain)`);
  console.log(`escrow file: ${escrowPath}  (E keys + opening — packet material, gitignored)`);
  console.log(`escrow E address (share with the registry create): ${eKp.publicKey()}`);
}

async function cmdCreateShipment(flags: Record<string, string>): Promise<void> {
  if (!flags.escrow || flags['to-lat'] === undefined || flags['to-lon'] === undefined) {
    throw new Error('usage: create-shipment --escrow <file> --to-lat <deg> --to-lon <deg> [--deadline-hours 24]');
  }
  const dep = loadDeployment();
  const esc = readEscrowFile(flags.escrow);
  if (esc.token !== dep.contracts.ctToken) {
    throw new Error(`escrow file token ${esc.token} != deployed CT token ${dep.contracts.ctToken} (T25)`);
  }

  const built = await buildShipment({
    toLat: flags['to-lat'],
    toLon: flags['to-lon'],
    amount: '0', // the registry NEVER learns the confidential amount
    deadlineHours: Number(flags['deadline-hours'] ?? '24'),
    method: 'courier',
  });

  // create_shipment(merchant, c_s, token, amount, milestones, escrow_deadline,
  //                 method, rail, lane_id, escrow):
  //   --method 1 --rail 1 (u32 discriminants), lane_id omitted (None),
  //   --escrow '"G..."' (Option<Address> Some = JSON-quoted string),
  //   --token = the HOOKED CT token id (T25 pin).
  const argv = buildInvoke({
    fn: 'create_shipment',
    args: [
      ['merchant', TESTNET.merchant],
      ['c_s', BigInt(built.packet.c_s).toString()],
      ['token', dep.contracts.ctToken],
      ['amount', '0'],
      ['milestones', flags.milestones ?? '[10000]'],
      ['escrow_deadline', built.escrowDeadline],
      ['method', '1'],
      ['rail', '1'],
      ['escrow', JSON.stringify(esc.escrow)],
    ],
    source: 'relay-merchant',
    registryId: dep.contracts.registry,
    network: dep.cliNetwork,
  });
  console.log(`Submitting: ${argv.join(' ')}`);
  const res = runInvoke(argv);
  const id = res.stdout.trim().split(/\s+/).filter(Boolean).pop()!.replace(/"/g, '');
  if (!/^\d+$/.test(id)) throw new Error(`unexpected create_shipment output: ${res.stdout}`);

  built.packet.shipment_id = id;
  const packetPath = writePacket(id, built.packet);
  esc.shipmentId = id;
  esc.txs.create = '(see CLI output above)';
  writeEscrowFile(flags.escrow, esc);
  // Mirror the escrow file into the shipment's packet directory (its home).
  writeEscrowFile(join(OUT_DIR, 'ships', id, 'escrow.json'), esc);

  console.log(`shipment id      = ${id}  (rail Confidential, amount 0 on the registry)`);
  console.log(`C_S              = ${built.packet.c_s}`);
  console.log(`escrow_of(${esc.escrow.slice(0, 8)}…) = ${id}`);
  console.log(`packet: ${packetPath}`);
}

async function cmdVerifyEscrow(flags: Record<string, string>): Promise<void> {
  if (!flags.escrow) throw new Error('usage: verify-escrow --escrow <file>');
  const dep = loadDeployment();
  const client = makeClient(dep);
  const esc = readEscrowFile(flags.escrow);

  // T25: the packet's token id must be the deployment's hooked instance.
  const pinOk = esc.token === dep.contracts.ctToken;
  console.log(`token pin (T25)  : ${pinOk ? 'OK' : 'MISMATCH'} (${esc.token})`);

  const keys = deserializeKeys(esc.grumpkin);
  const v = BigInt(esc.opening.v);
  const r = BigInt(esc.opening.r);
  const onchain = await client.confidentialBalance(esc.escrow);
  if (!onchain) {
    console.log('VERDICT: MISMATCH — escrow account is not registered on the token');
    process.exit(2);
  }
  // The carrier-side check (T12 extended to funds): the packet's opening must
  // re-commit to the exact Pedersen point stored on-chain, and the packet's
  // Grumpkin keys must be the account's registered keys (else the opening
  // could be for someone else's account).
  const commitOk = commit(v, r).equals(onchain.spendableBalance);
  const keyOk = keys.Y.equals(onchain.spendingKey) && keys.PVK.equals(onchain.viewingPublicKey);
  console.log(`escrow account   : ${esc.escrow}`);
  console.log(`opening commit   : ${commitOk ? 'matches on-chain spendable' : 'DOES NOT match'}`);
  console.log(`packet keys      : ${keyOk ? 'match registered account keys' : 'DO NOT match'}`);
  if (commitOk && keyOk && pinOk) {
    console.log(`VERDICT: MATCH — escrow balance = ${v} units (visible to packet holders only)`);
  } else {
    console.log('VERDICT: MISMATCH — do NOT accept this shipment');
    process.exit(2);
  }
}

/** Shared E→to confidential transfer (settle + refund differ only in `to`). */
async function escrowTransfer(
  dep: Deployment,
  client: ChainClient,
  esc: EscrowFile,
  to: string,
): Promise<string> {
  const eKeys = deserializeKeys(esc.grumpkin);
  const eSigner = keypairSigner(esc.stellarSecret, dep.passphrase);
  const v = BigInt(esc.opening.v);
  const r = BigInt(esc.opening.r);

  const onchain = await client.confidentialBalance(esc.escrow);
  if (!onchain || !commit(v, r).equals(onchain.spendableBalance)) {
    throw new Error('escrow opening no longer matches the on-chain commitment — refusing to build a proof');
  }
  const toAccount = await client.confidentialBalance(to);
  if (!toAccount) throw new Error(`${to} is not registered on the token — register it first`);

  const kAud = await client.auditorKey(AUDITOR_ID);
  const prover = new CircuitProver(loadCircuitJson('transfer'));
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
    const { proof } = await prover.prove(w.inputs);
    const res = await submitTransfer(client, eSigner, esc.escrow, to, w, proof);
    return res.hash;
  } finally {
    await prover.destroy();
  }
}

async function cmdSettle(flags: Record<string, string>): Promise<void> {
  if (!flags.id || !flags.escrow || !flags.payout) {
    throw new Error('usage: settle --id <n> --escrow <file> --payout <G...> [--payout-source <keystore>]');
  }
  const dep = loadDeployment();
  const client = makeClient(dep);
  const esc = readEscrowFile(flags.escrow);
  const addrF = addressToField(dep.contracts.ctToken);

  // The payout account must exist on the token before it can be paid. For the
  // demo roles we can register it ourselves (relay-carrier by default).
  if (!(await client.isRegistered(flags.payout))) {
    const sourceName =
      flags['payout-source'] ?? (flags.payout === TESTNET.carrier ? 'relay-carrier' : undefined);
    if (!sourceName) {
      throw new Error(`payout ${flags.payout} is not registered and no --payout-source keystore given`);
    }
    if (keystorePublic(sourceName) !== flags.payout) {
      throw new Error(`keystore '${sourceName}' does not hold ${flags.payout}`);
    }
    const payoutSigner = keypairSigner(keystoreSecret(sourceName), dep.passphrase);
    const payoutKeys = loadOrCreateRoleKeys(sourceName.replace(/^relay-/, ''), addrF);
    await ensureRegistered(client, payoutSigner, flags.payout, payoutKeys, `payout ${sourceName}`);
  }

  console.log(`settle shipment #${flags.id}: confidential_transfer E → ${flags.payout} (amount hidden)`);
  console.log('(the AegisEscrowHooks gate cross-calls registry.release_allowed — DELIVERED ⇒ payout only)');
  const hash = await escrowTransfer(dep, client, esc, flags.payout);
  console.log(`SETTLED: tx ${hash}`);
  esc.txs.settle = hash;
  writeEscrowFile(flags.escrow, esc);

  // Confirm the payout's receiving balance if we hold its viewing keys.
  const roleFile = join(KEYS_DIR, 'carrier.json');
  if (flags.payout === TESTNET.carrier && existsSync(roleFile)) {
    const carrierKeys = deserializeKeys(JSON.parse(readFileSync(roleFile, 'utf8')));
    const engine = engineFor(client, dep, carrierKeys, flags.payout);
    const s = await engine.sync();
    const ver = await engine.verifyAgainstChain();
    console.log(`payout receiving balance = ${s.receiving.v} units (re-commits to chain: ${ver.receivingOk})`);
  }
}

async function cmdRefund(flags: Record<string, string>): Promise<void> {
  if (!flags.id || !flags.escrow) throw new Error('usage: refund --id <n> --escrow <file>');
  const dep = loadDeployment();
  const client = makeClient(dep);
  const esc = readEscrowFile(flags.escrow);
  const merchant = flags.merchant ?? TESTNET.merchant;

  console.log(`refund shipment #${flags.id}: confidential_transfer E → merchant ${merchant}`);
  console.log('(admitted by the hook only after refund_expired flipped the state to EXPIRED)');
  const hash = await escrowTransfer(dep, client, esc, merchant);
  console.log(`REFUNDED: tx ${hash}`);
  esc.txs.refund = hash;
  writeEscrowFile(flags.escrow, esc);
}

async function cmdWithdrawProbe(flags: Record<string, string>): Promise<void> {
  if (!flags.escrow) throw new Error('usage: withdraw-probe --escrow <file>');
  const dep = loadDeployment();
  const client = makeClient(dep);
  const esc = readEscrowFile(flags.escrow);
  const eKeys = deserializeKeys(esc.grumpkin);
  const eSigner = keypairSigner(esc.stellarSecret, dep.passphrase);
  const v = BigInt(esc.opening.v);
  const r = BigInt(esc.opening.r);

  console.log(`withdraw-probe: attempting withdraw of ${v} units from escrow E to the PUBLIC rail…`);
  console.log('(T24: on_withdraw must abort unconditionally for escrows — expecting hook error #4301)');
  const kAud = await client.auditorKey(AUDITOR_ID);
  const prover = new CircuitProver(loadCircuitJson('withdraw'));
  try {
    const w = buildWithdrawWitness({ keys: eKeys, v, r, amount: v, kAudS: kAud });
    const { proof } = await prover.prove(w.inputs);
    const res = await submitWithdraw(client, eSigner, esc.escrow, esc.escrow, v, w, proof);
    console.log(`UNEXPECTED: withdraw succeeded (tx ${res.hash}) — THE CAGE IS BROKEN`);
    process.exit(3);
  } catch (e) {
    console.log(`withdraw REJECTED as required: ${(e as Error).message}`);
  } finally {
    await prover.destroy();
  }
}

async function cmdAudit(flags: Record<string, string>): Promise<void> {
  const want = flags.tx ?? 'last';
  const dep = loadDeployment();
  const client = makeClient(dep);
  const keyPath = join(OUT_DIR, 'auditor-key.json');
  if (!existsSync(keyPath)) throw new Error(`no auditor key at ${keyPath} (deploy-all.mjs writes it)`);
  const k = BigInt((JSON.parse(readFileSync(keyPath, 'utf8')) as { secretHex: string }).secretHex);

  const { events } = await fetchEvents(client, { startLedger: dep.deployedAtLedger });
  const transfers = events.filter((ev): ev is TransferEvent => ev.type === 'transfer');
  const ev =
    want === 'last' ? transfers[transfers.length - 1] : transfers.find((t) => t.txHash === want);
  if (!ev) throw new Error(`no transfer event found for --tx ${want}`);

  const audit = auditTransfer(k, ev);
  console.log('=== REGULATOR AUDIT (auditor key 0 decrypts the on-chain ciphertexts) ===');
  console.log(`transfer tx      : ${ev.txHash} (ledger ${ev.ledger})`);
  console.log(`from             : ${ev.from}`);
  console.log(`to               : ${ev.to}`);
  console.log(`amount           : ${audit.amount} units  (${Number(audit.amount) / 1e7} XLM)`);
  console.log(`sender balance   : ${audit.senderBalance} units (post-transfer)`);
  console.log(`channels agree   : ${audit.channelsAgree} (sender + recipient ciphertexts decrypt to the same amount)`);
  console.log('private to the world, transparent to the regulator.');
  if (!audit.channelsAgree) process.exit(2);
}

// ── main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const flags = parseFlags(rest);
  switch (command) {
    case 'setup-merchant':
      await cmdSetupMerchant(flags);
      break;
    case 'fund-escrow':
      await cmdFundEscrow(flags);
      break;
    case 'create-shipment':
      await cmdCreateShipment(flags);
      break;
    case 'verify-escrow':
      await cmdVerifyEscrow(flags);
      break;
    case 'settle':
      await cmdSettle(flags);
      break;
    case 'refund':
      await cmdRefund(flags);
      break;
    case 'withdraw-probe':
      await cmdWithdrawProbe(flags);
      break;
    case 'audit':
      await cmdAudit(flags);
      break;
    default:
      console.error(
        'confidential commands: setup-merchant | fund-escrow | create-shipment | verify-escrow | settle | refund | withdraw-probe | audit',
      );
      process.exit(1);
  }
}

const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((e) => {
    console.error(String(e instanceof Error ? e.message : e));
    process.exit(1);
  });
}
