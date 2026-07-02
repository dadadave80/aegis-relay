#!/usr/bin/env node
/**
 * deploy-all.mjs — the FINAL reproducible testnet deployment of the whole
 * Aegis Relay system (P4 / rung R3 CT-A), in dependency order:
 *
 *   1. (unless --skip-build) `cargo build --workspace --target wasm32v1-none
 *      --release --offline` — the Aegis workspace (registry with the
 *      confidential rail: escrow map + release_allowed + set_ct_token).
 *   2. aegis-credentials  (issuer  = relay-issuer)
 *      aegis-airspace     (authority = relay-authority)
 *      aegis-registry     (admin = relay-admin, vk_delivery + vk_flight from
 *                          circuits/fixtures/{delivery,flight}/verification_key.json
 *                          via vk-to-invoke-json.mjs, credentials + airspace ids)
 *   3. CT stack (contracts-ct wasms, adapting ct-demo/scripts/deploy.ts):
 *      verifier (+ all six VKs from @ctd/sdk/circuits/vks), auditor (+ Grumpkin
 *      key id 0 — secret persisted to prover/out/auditor-key.json, gitignored),
 *      aegis_ct_token (underlying = native XLM SAC, verifier, auditor,
 *      + trailing aegis-registry address — the T25 pin), addr_f parity check.
 *   4. registry.set_ct_token(token) — closes the mutual pin (set-once).
 *   5. Authority approves corridor lane 7 (root from
 *      circuits/fixtures/flight/corridor.json, valid now→now+30d);
 *      issuer publishes credential root epoch 1 (PAD — no real leaves yet).
 *   6. Writes prover/out/ct-deployment.json (ids + deploy ledger; no secrets)
 *      and prints the id block for docs/testnet.md.
 *
 * Network: `proxied` for the stellar CLI (local forward proxy at
 * http://127.0.0.1:8971 → soroban-testnet over pinned TLS — the system DNS
 * resolver is flaky for soroban-testnet.stellar.org). The @ctd/sdk RPC client
 * uses the same proxy URL directly.
 *
 * Secrets: signer keys stay in the stellar keystore; the relay-admin secret is
 * read into memory for SDK invokes and NEVER printed. The auditor Grumpkin
 * secret goes to prover/out/auditor-key.json only (gitignored).
 *
 * Usage: node prover/scripts/deploy-all.mjs [--skip-build]
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { xdr, Address } from '@stellar/stellar-sdk';
import {
  ChainClient,
  keypairSigner,
  addressToField,
  randomScalar,
  toHex32,
  H,
  scalarMul,
  pointToBytes,
  pointCoords,
  fromBytesBE,
  CIRCUIT_TYPE,
} from '@ctd/sdk';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OUT_DIR = join(REPO_ROOT, 'prover', 'out');

const NETWORK = 'proxied'; // stellar CLI network name (local RPC forward proxy)
const RPC_URL = 'http://127.0.0.1:8971'; // same proxy, for the SDK client
const PASSPHRASE = 'Test SDF Network ; September 2015';

/** Native XLM SAC on testnet — the underlying SEP-41 for the CT token. */
const NATIVE_SAC = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';

/** PAD = poseidon2(0,0) — canonical zero leaf; epoch-1 credential root. */
const PAD = '14744269619966411208579211824598458697587494354926760081771325075741142829156';

const AEGIS_WASM = {
  credentials: join(REPO_ROOT, 'target/wasm32v1-none/release/aegis_credentials.wasm'),
  airspace: join(REPO_ROOT, 'target/wasm32v1-none/release/aegis_airspace.wasm'),
  registry: join(REPO_ROOT, 'target/wasm32v1-none/release/aegis_registry.wasm'),
};
const CT_WASM = {
  verifier: join(REPO_ROOT, 'contracts-ct/target/wasm32v1-none/release/confidential_verifier_contract.wasm'),
  auditor: join(REPO_ROOT, 'contracts-ct/target/wasm32v1-none/release/confidential_auditor_contract.wasm'),
  token: join(REPO_ROOT, 'contracts-ct/target/wasm32v1-none/release/aegis_ct_token.wasm'),
};

// vk.bin filename → CircuitType discriminant (same set as ct-demo deploy.ts).
const VK_FILES = [
  ['register', CIRCUIT_TYPE.Register],
  ['withdraw', CIRCUIT_TYPE.Withdraw],
  ['transfer', CIRCUIT_TYPE.Transfer],
  ['spender_transfer', CIRCUIT_TYPE.SpenderTransfer],
  ['set_spender', CIRCUIT_TYPE.SetSpender],
  ['revoke_spender', CIRCUIT_TYPE.RevokeSpender],
];

// ── CLI helpers ──────────────────────────────────────────────────────────────

function stellar(args) {
  return execFileSync('stellar', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 32 * 1024 * 1024,
  }).trim();
}

const publicKey = (name) => stellar(['keys', 'public-key', name]);
/** Secret seed for a keystore identity — held in memory only, never printed. */
const secretOf = (name) => stellar(['keys', 'show', name]);

/** `stellar contract deploy` with constructor args; returns the contract id. */
function deploy(wasmPath, source, ctorArgs) {
  const out = stellar([
    'contract', 'deploy',
    '--wasm', wasmPath,
    '--source-account', source,
    '--network', NETWORK,
    '--optimize=false',
    '--', ...ctorArgs,
  ]);
  const id = out.split(/\s+/).filter(Boolean).pop();
  if (!id?.startsWith('C')) throw new Error(`unexpected deploy output: ${out}`);
  return id;
}

/** `stellar contract invoke` (throws on failure). */
function invoke(contractId, source, fnAndArgs) {
  return stellar([
    'contract', 'invoke',
    '--id', contractId,
    '--source-account', source,
    '--network', NETWORK,
    '--', ...fnAndArgs,
  ]);
}

/** snarkjs verification_key.json → registry constructor JSON (bn254.ts encoding). */
function vkInvokeJson(fixture) {
  const script = join(REPO_ROOT, 'prover/scripts/vk-to-invoke-json.mjs');
  const vkPath = join(REPO_ROOT, `circuits/fixtures/${fixture}/verification_key.json`);
  return execFileSync('node', [script, vkPath], { encoding: 'utf8' }).trim();
}

/** Read a shipped CT verification key out of the @ctd/sdk package. */
function readCtVk(name) {
  const url = import.meta.resolve(`@ctd/sdk/circuits/vks/${name}.vk.bin`);
  return new Uint8Array(readFileSync(fileURLToPath(url)));
}

/** Retry an async op — the testnet RPC pool occasionally lags an account
 *  write by a node, surfacing as a transient "Account not found". */
async function withRetry(label, fn, attempts = 4) {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i >= attempts) throw e;
      console.warn(`  retry ${i}/${attempts - 1} for ${label}: ${e.message ?? e}`);
      await new Promise((r) => setTimeout(r, 4000 * i));
    }
  }
}

/** Scan token events for `address_as_field_set` (the demo's parity guard). */
async function readAddressAsField(client, fromLedger) {
  const resp = await client.server.getEvents({
    startLedger: fromLedger,
    filters: [{ type: 'contract', contractIds: [client.cfg.contracts.token] }],
    limit: 50,
  });
  for (const ev of resp.events) {
    if (ev.topic[0]?.sym().toString() !== 'address_as_field_set') continue;
    for (const entry of ev.value.map() ?? []) {
      if (entry.key().sym().toString() === 'address_as_field') {
        return fromBytesBE(new Uint8Array(entry.val().bytes()));
      }
    }
  }
  return null;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const skipBuild = process.argv.includes('--skip-build');

  // 1. Rebuild the Aegis workspace (picks up the P4a registry).
  if (!skipBuild) {
    console.log('[build] cargo build --workspace --target wasm32v1-none --release --offline');
    execFileSync('cargo', ['build', '--workspace', '--target', 'wasm32v1-none', '--release', '--offline'], {
      cwd: REPO_ROOT,
      stdio: 'inherit',
    });
  }

  const adminPub = publicKey('relay-admin');
  const issuerPub = publicKey('relay-issuer');
  const authorityPub = publicKey('relay-authority');
  console.log(`[keys] admin=${adminPub} issuer=${issuerPub} authority=${authorityPub}`);

  // 2. Aegis contracts (deployer/admin = relay-admin).
  console.log('[aegis] deploying credentials / airspace / registry…');
  const credentials = deploy(AEGIS_WASM.credentials, 'relay-admin', ['--issuer', issuerPub]);
  console.log(`  credentials = ${credentials}`);
  const airspace = deploy(AEGIS_WASM.airspace, 'relay-admin', ['--authority', authorityPub]);
  console.log(`  airspace    = ${airspace}`);

  const vkDelivery = vkInvokeJson('delivery');
  const vkFlight = vkInvokeJson('flight');
  const registry = deploy(AEGIS_WASM.registry, 'relay-admin', [
    '--admin', adminPub,
    '--vk_delivery', vkDelivery,
    '--vk_flight', vkFlight,
    '--credentials', credentials,
    '--airspace', airspace,
  ]);
  console.log(`  registry    = ${registry}  (VKs A1+A2 baked, immutable — I6)`);

  // 3. CT stack (adapting ct-demo/scripts/deploy.ts; deployer = relay-admin).
  console.log('[ct] deploying verifier / auditor / hooked token…');
  const verifier = deploy(CT_WASM.verifier, 'relay-admin', ['--admin', adminPub, '--manager', adminPub]);
  console.log(`  verifier = ${verifier}`);
  const auditor = deploy(CT_WASM.auditor, 'relay-admin', ['--admin', adminPub, '--manager', adminPub]);
  console.log(`  auditor  = ${auditor}`);

  const client = new ChainClient({
    rpcUrl: RPC_URL,
    networkPassphrase: PASSPHRASE,
    contracts: { token: '', verifier, auditor },
  });
  const ledgerBeforeToken = await client.latestLedger();

  // Trailing registry address: the single constructor delta vs the demo (T25).
  const token = deploy(CT_WASM.token, 'relay-admin', [
    '--underlying_asset', NATIVE_SAC,
    '--verifier', verifier,
    '--auditor', auditor,
    '--registry', registry,
  ]);
  console.log(`  token    = ${token}  (hooked AegisEscrowHooks fork, registry pinned)`);
  client.cfg.contracts.token = token;

  const signer = keypairSigner(secretOf('relay-admin'), PASSPHRASE);

  // 3a. Register the six shipped verification keys (guardrail 10: VK set
  // consumed as-is from the demo SDK, circuits untouched).
  for (const [name, circuitType] of VK_FILES) {
    const vk = readCtVk(name);
    await withRetry(`register VK ${name}`, () =>
      client.invoke(
        verifier,
        'register_verification_key',
        [xdr.ScVal.scvU32(circuitType), xdr.ScVal.scvBytes(Buffer.from(vk)), new Address(adminPub).toScVal()],
        signer,
      ),
    );
    console.log(`  registered VK ${name} (circuit ${circuitType}, ${vk.length}B)`);
  }

  // 3b. Auditor key 0 — the mock-regulator Grumpkin key. K_aud = a·H.
  const auditorSecret = randomScalar();
  const kAud = scalarMul(auditorSecret, H);
  await withRetry('register auditor key 0', () =>
    client.invoke(
      auditor,
      'register_key',
      [xdr.ScVal.scvU32(0), xdr.ScVal.scvBytes(Buffer.from(pointToBytes(kAud))), new Address(adminPub).toScVal()],
      signer,
    ),
  );
  const kAudCoords = pointCoords(kAud);
  mkdirSync(OUT_DIR, { recursive: true });
  const auditorKeyPath = join(OUT_DIR, 'auditor-key.json');
  writeFileSync(
    auditorKeyPath,
    JSON.stringify(
      {
        id: 0,
        secretHex: toHex32(auditorSecret),
        keyXHex: toHex32(kAudCoords.x),
        keyYHex: toHex32(kAudCoords.y),
      },
      null,
      2,
    ) + '\n',
  );
  console.log(`  registered auditor key id 0 (secret → ${auditorKeyPath}, gitignored)`);

  // 3c. addr_f parity guard (Poseidon2 SDK ↔ contract), as in the demo deploy.
  const sdkAddrF = addressToField(token);
  const onchainAddrF = await readAddressAsField(client, ledgerBeforeToken);
  if (onchainAddrF === null) {
    console.warn('  ! could not find AddressAsFieldSet event; skipping parity assert');
  } else if (onchainAddrF !== sdkAddrF) {
    throw new Error(`addr_f MISMATCH — SDK ${toHex32(sdkAddrF)} != contract ${toHex32(onchainAddrF)}`);
  } else {
    console.log(`  addr_f parity OK: ${toHex32(sdkAddrF)}`);
  }

  // 4. Close the mutual pin: registry ↔ token (set-once, admin-gated).
  invoke(registry, 'relay-admin', ['set_ct_token', '--token', token]);
  console.log(`[pin] registry.set_ct_token(${token}) — mutual address pin closed (T25)`);

  // 5. Corridor lane 7 (authority) + credential root epoch 1 (issuer).
  const corridor = JSON.parse(
    readFileSync(join(REPO_ROOT, 'circuits/fixtures/flight/corridor.json'), 'utf8'),
  );
  const now = Math.floor(Date.now() / 1000);
  const validFrom = now - 60; // small back-dating: cover ledger-time skew
  const validTo = now + 30 * 86400;
  invoke(airspace, 'relay-authority', [
    'approve_corridor',
    '--lane_id', String(corridor.lane_id),
    '--root', BigInt(corridor.root).toString(),
    '--valid_from', String(validFrom),
    '--valid_to', String(validTo),
  ]);
  console.log(`[airspace] lane ${corridor.lane_id} approved, window ${validFrom}..${validTo}`);

  invoke(credentials, 'relay-issuer', ['set_root', '--root', PAD, '--epoch', '1']);
  console.log('[credentials] epoch 1 root published (PAD — empty tree)');

  // 6. Persist the deployment record (public ids only — no secrets).
  const deployment = {
    network: 'testnet',
    cliNetwork: NETWORK,
    rpcUrl: RPC_URL,
    passphrase: PASSPHRASE,
    deployedAt: new Date().toISOString(),
    deployedAtLedger: ledgerBeforeToken,
    contracts: {
      registry,
      credentials,
      airspace,
      ctVerifier: verifier,
      ctAuditor: auditor,
      ctToken: token,
      underlying: NATIVE_SAC,
    },
    auditorKeyId: 0,
    addrF: toHex32(sdkAddrF),
    corridor: { laneId: corridor.lane_id, validFrom, validTo },
  };
  const deploymentPath = join(OUT_DIR, 'ct-deployment.json');
  writeFileSync(deploymentPath, JSON.stringify(deployment, null, 2) + '\n');
  console.log(`\nwrote ${deploymentPath}`);

  console.log('\n=== FINAL DEPLOYMENT (paste into docs/testnet.md) ===');
  for (const [k, v] of Object.entries(deployment.contracts)) console.log(`${k.padEnd(12)} ${v}`);
  console.log(`deployedAtLedger ${deployment.deployedAtLedger}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
