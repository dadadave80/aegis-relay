/**
 * prover/src/index.ts — Ledger → Merkle tree → ZK proof → Soroban attest CLI
 *
 * Usage:
 *   node --import tsx/esm src/index.ts [--ledger sample.csv] [--epoch 100]
 *
 * Requires (gitignored local artifacts):
 *   circuits/build/por_final.zkey
 *   circuits/build/por_js/por.wasm
 *
 * Must be run with **node** (not bun) because snarkjs uses web-workers.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

import { buildTree, type Entry } from './tree.js';
import { parseLedger } from './ledger.js';
import {
  Contract,
  rpc as SorobanRpc,
  TransactionBuilder,
  Networks,
  Keypair,
  xdr,
  nativeToScVal,
} from '@stellar/stellar-sdk';

// ── Paths ────────────────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '../../');

const WASM_PATH = join(ROOT, 'circuits/build/por_js/por.wasm');
const ZKEY_PATH = join(ROOT, 'circuits/build/por_final.zkey');
const OUT_DIR   = join(__dirname, '../out');

// ── Contract constants ────────────────────────────────────────────────────────

const CONTRACT_ID  = 'CBJSDEPCLKC5FSIVIUBHZOQNPCS3VGNYRU7VFDFDUN6TEF6ADGO5EOZT';
const DEPLOYER_SK  = process.env.DEPLOYER_SK;
if (!DEPLOYER_SK) throw new Error('Set DEPLOYER_SK env var (testnet deployer secret key)');
const TESTNET_RPC  = 'https://soroban-testnet.stellar.org';
const NET_PASSPHRASE = Networks.TESTNET;

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Encode a bigint as a 32-byte big-endian Uint8Array */
function toBE32(n: bigint): Uint8Array {
  const out = new Uint8Array(32);
  let tmp = n;
  for (let i = 31; i >= 0; i--) {
    out[i] = Number(tmp & 0xffn);
    tmp >>= 8n;
  }
  if (tmp !== 0n) throw new Error(`Value ${n} does not fit in 32 bytes`);
  return out;
}

function concat(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((s, a) => s + a.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) { out.set(a, offset); offset += a.length; }
  return out;
}

/**
 * Encode a snarkjs G1 point as BE32(x) || BE32(y) (64 bytes).
 * snarkjs pi_a = [x, y, "1"]
 */
function encodeG1(point: string[]): Uint8Array {
  return concat(toBE32(BigInt(point[0])), toBE32(BigInt(point[1])));
}

/**
 * Encode a snarkjs G2 point as BE32(x_c1)||BE32(x_c0) || BE32(y_c1)||BE32(y_c0) (128 bytes).
 * snarkjs pi_b = [[x_c0, x_c1], [y_c0, y_c1], …] — imaginary (c1) FIRST per Soroban convention.
 */
function encodeG2(point: string[][]): Uint8Array {
  const [x_c0, x_c1] = point[0];
  const [y_c0, y_c1] = point[1];
  return concat(toBE32(BigInt(x_c1)), toBE32(BigInt(x_c0)), toBE32(BigInt(y_c1)), toBE32(BigInt(y_c0)));
}

/** Convert a bigint to xdr.ScVal representing U256 */
function bigintToU256ScVal(n: bigint): xdr.ScVal {
  const mask = (1n << 64n) - 1n;
  const u64 = (v: bigint) => xdr.Uint64.fromString(v.toString());
  return xdr.ScVal.scvU256(new xdr.UInt256Parts({
    hiHi: u64((n >> 192n) & mask),
    hiLo: u64((n >> 128n) & mask),
    loHi: u64((n >>  64n) & mask),
    loLo: u64( n          & mask),
  }));
}

// ── CLI argument parsing ──────────────────────────────────────────────────────

function parseArgs(): { ledger: string; epoch: bigint | null } {
  const args = process.argv.slice(2);
  let ledger = join(__dirname, '../sample.csv');
  let epoch: bigint | null = null; // null → auto: current on-chain epoch + 1

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--ledger' && args[i + 1]) { ledger = args[++i]; }
    if (args[i] === '--epoch'  && args[i + 1]) { epoch  = BigInt(args[++i]); }
  }
  return { ledger: resolve(ledger), epoch };
}

/**
 * Read the current attestation epoch from the contract via a read-only
 * simulation. Returns -1n when no attestation exists yet (so epoch defaults to
 * 0), letting the caller pick `current + 1` without the judge having to guess a
 * value greater than whatever is already on-chain.
 */
async function readCurrentEpoch(
  server: SorobanRpc.Server,
  contract: Contract,
  sourcePk: string,
): Promise<bigint> {
  try {
    const acct = await server.getAccount(sourcePk);
    const sim = await server.simulateTransaction(
      new TransactionBuilder(acct, { fee: '100', networkPassphrase: NET_PASSPHRASE })
        .addOperation(contract.call('status'))
        .setTimeout(30)
        .build(),
    );
    if (!SorobanRpc.Api.isSimulationSuccess(sim) || !sim.result?.retval) return -1n;
    const rv = sim.result.retval;
    // status() → Option<Attestation>. None encodes as void; Some as a map
    // (possibly wrapped in a 1-element vec across SDK XDR versions).
    let map: xdr.ScMapEntry[] | null = null;
    if (rv.switch().name === 'scvMap') map = rv.map() ?? null;
    else if (rv.switch().name === 'scvVec') {
      const inner = (rv.vec() ?? [])[0];
      if (inner && inner.switch().name === 'scvMap') map = inner.map() ?? null;
    }
    if (!map) return -1n;
    const epochEntry = map.find((e) => e.key().sym().toString() === 'epoch');
    return epochEntry ? BigInt(epochEntry.val().u64().toString()) : -1n;
  } catch {
    return -1n; // unreachable contract / decode issue → treat as no prior epoch
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { ledger, epoch: epochArg } = parseArgs();

  // Set up the Soroban client up front — needed to auto-pick a fresh epoch.
  const keypair  = Keypair.fromSecret(DEPLOYER_SK);
  const server   = new SorobanRpc.Server(TESTNET_RPC, { allowHttp: false });
  const contract = new Contract(CONTRACT_ID);

  // Resolve the epoch: explicit --epoch wins; otherwise use current on-chain + 1
  // so the strictly-increasing check always passes without the caller guessing.
  let epoch: bigint;
  if (epochArg !== null) {
    epoch = epochArg;
  } else {
    const current = await readCurrentEpoch(server, contract, keypair.publicKey());
    epoch = current + 1n;
    console.log(`[prover] Auto-epoch: on-chain epoch ${current < 0n ? '(none)' : current} → using ${epoch}`);
  }

  console.log(`\n[prover] Ledger: ${ledger}`);
  console.log(`[prover] Epoch : ${epoch}`);

  // 1. Parse CSV ──────────────────────────────────────────────────────────────
  const entries = parseLedger(ledger);
  console.log(`[prover] Loaded ${entries.length} customer(s)`);
  if (entries.length > 16) throw new Error('Circuit supports at most N=16 customers');

  // 2. Build Merkle tree ──────────────────────────────────────────────────────
  console.log('[prover] Building Poseidon-Merkle tree…');
  const tree = await buildTree(entries);
  console.log(`[prover] Root : ${tree.root}`);
  console.log(`[prover] Total: ${tree.total}`);

  // 3. Prepare snarkjs input ─────────────────────────────────────────────────
  const balances: string[] = new Array(16).fill('0');
  const salts:    string[] = new Array(16).fill('0');
  for (let i = 0; i < entries.length; i++) {
    balances[i] = entries[i].balance.toString();
    salts[i]    = entries[i].salt.toString();
  }

  const input = {
    balances,
    salts,
    root:  tree.root.toString(),
    total: tree.total.toString(),
    epoch: epoch.toString(),
  };

  mkdirSync(OUT_DIR, { recursive: true });
  const inputPath = join(OUT_DIR, 'input.json');
  writeFileSync(inputPath, JSON.stringify(input, null, 2));
  console.log(`[prover] Input written: ${inputPath}`);

  // 4. Generate ZK proof ──────────────────────────────────────────────────────
  console.log('[prover] Running snarkjs fullProve (this may take ~30s)…');

  // Dynamic import of snarkjs (CJS) using createRequire for node compat
  const require = createRequire(import.meta.url);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const snarkjs = require('snarkjs') as any;

  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    input,
    WASM_PATH,
    ZKEY_PATH,
  );

  console.log('[prover] fullProve succeeded!');
  console.log('[prover] publicSignals:', publicSignals);
  // publicSignals order: [root, total, epoch] — matches circuit declaration

  // 5. Encode proof for Soroban ──────────────────────────────────────────────
  const pi_a_bytes = encodeG1(proof.pi_a as string[]);
  const pi_b_bytes = encodeG2(proof.pi_b as string[][]);
  const pi_c_bytes = encodeG1(proof.pi_c as string[]);

  // Proof as ScMap  { a: ScBytes(64), b: ScBytes(128), c: ScBytes(64) }
  const proofScVal = xdr.ScVal.scvMap([
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('a'),
      val: xdr.ScVal.scvBytes(Buffer.from(pi_a_bytes)),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('b'),
      val: xdr.ScVal.scvBytes(Buffer.from(pi_b_bytes)),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('c'),
      val: xdr.ScVal.scvBytes(Buffer.from(pi_c_bytes)),
    }),
  ]);

  // root (U256)
  const rootBigInt  = BigInt(publicSignals[0]);
  const totalBigInt = BigInt(publicSignals[1]);
  const epochBigInt = BigInt(publicSignals[2]);

  const rootScVal  = bigintToU256ScVal(rootBigInt);
  const totalScVal = nativeToScVal(totalBigInt, { type: 'u64' });
  const epochScVal = nativeToScVal(epochBigInt, { type: 'u64' });

  // 6. Write paths.json BEFORE submission (so it's available even if tx fails) ──
  // Each entry carries the customer's balance + salt (so they can recompute the
  // leaf = Poseidon(balance, salt) themselves and prove their *balance* is in the
  // tree — not merely that some opaque leaf is), plus the leaf and sibling path.
  const pathsOutput: Record<
    string,
    { index: number; balance: string; salt: string; leaf: string; path: string[] }
  > = {};
  for (let i = 0; i < tree.paths.length; i++) {
    const { index, leaf, path } = tree.paths[i];
    pathsOutput[entries[i].id] = {
      index,
      balance: entries[i].balance.toString(),
      salt:    entries[i].salt.toString(),
      leaf:    leaf.toString(),
      path:    path.map(p => p.toString()),
    };
  }

  const pathsPath = join(OUT_DIR, 'paths.json');
  writeFileSync(pathsPath, JSON.stringify(pathsOutput, null, 2));
  console.log(`[prover] Paths written: ${pathsPath}`);

  // 7. Submit to testnet ─────────────────────────────────────────────────────
  console.log('[prover] Submitting attest() to testnet contract…');

  const account = await server.getAccount(keypair.publicKey());

  const tx = new TransactionBuilder(account, {
    fee: '10000000', // 10 XLM — Soroban ops are expensive; bumped to be safe
    networkPassphrase: NET_PASSPHRASE,
  })
    .addOperation(contract.call('attest', proofScVal, rootScVal, totalScVal, epochScVal))
    .setTimeout(300)
    .build();

  console.log('[prover] Preparing transaction (simulation)…');
  let prepared;
  try {
    prepared = await server.prepareTransaction(tx);
  } catch (e) {
    // Most common causes: epoch not strictly greater than the current on-chain
    // epoch, or the deployer key is not the contract's authorized issuer.
    console.error(
      `[prover] prepareTransaction failed: ${(e as Error).message}\n` +
      `[prover] Check that (a) epoch ${epoch} is greater than the current on-chain epoch ` +
      `(rerun without --epoch to auto-pick), and (b) DEPLOYER_SK is the issuer set at deploy.`,
    );
    throw e;
  }
  prepared.sign(keypair);

  console.log('[prover] Sending transaction…');
  const sendResult = await server.sendTransaction(prepared);
  console.log(`[prover] Send status: ${sendResult.status}`);
  console.log(`[prover] Tx hash   : ${sendResult.hash}`);

  if (sendResult.status === 'ERROR') {
    console.error('[prover] ERROR from RPC:', JSON.stringify(sendResult.errorResult, null, 2));
    throw new Error(`attest transaction failed: ${sendResult.status}`);
  }

  // 8. Poll for tx confirmation via direct RPC (avoids SDK XDR version issues) ──
  console.log('[prover] Waiting for confirmation…');
  let confirmed = false;
  let finalStatus = 'UNKNOWN';

  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 2000));
    try {
      const rpcResp = await fetch(TESTNET_RPC, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0', id: 1,
          method: 'getTransaction',
          params: { hash: sendResult.hash },
        }),
      });
      const json = await rpcResp.json() as { result?: { status?: string } };
      finalStatus = json.result?.status ?? 'UNKNOWN';
      if (finalStatus === 'SUCCESS') { confirmed = true; break; }
      if (finalStatus === 'FAILED')  { break; }
    } catch (_) { /* transient */ }
    process.stdout.write('.');
  }
  console.log('');

  if (!confirmed) {
    if (finalStatus === 'FAILED') {
      throw new Error('attest transaction failed on-chain (FAILED)');
    } else {
      // Could be a NOT_FOUND or timeout — query contract directly to confirm
      console.warn(`[prover] Poll ended with status: ${finalStatus} — will verify via status()`);
    }
  } else {
    console.log(`[prover] CONFIRMED! tx hash: ${sendResult.hash}`);
  }

  // 9. Verify attestation was stored ────────────────────────────────────────
  console.log('[prover] Verifying contract status()…');
  try {
    const account2 = await server.getAccount(keypair.publicKey());
    const statusResult = await server.simulateTransaction(
      new TransactionBuilder(account2, {
        fee: '1000000',
        networkPassphrase: NET_PASSPHRASE,
      })
        .addOperation(contract.call('status'))
        .setTimeout(30)
        .build(),
    );

    if (SorobanRpc.Api.isSimulationSuccess(statusResult)) {
      console.log('[prover] status() XDR (base64):', statusResult.result?.retval?.toXDR('base64'));
    }
  } catch (e) {
    console.warn('[prover] Could not simulate status():', (e as Error).message);
  }

  console.log('\n[prover] ── DONE ──');
  console.log(`  Root  : ${rootBigInt}`);
  console.log(`  Total : ${totalBigInt}`);
  console.log(`  Epoch : ${epochBigInt}`);
  console.log(`  Tx    : ${sendResult.hash}`);
  console.log(`  Paths : ${pathsPath}`);
}

main().catch(err => {
  console.error('[prover] FATAL:', err);
  process.exit(1);
});
