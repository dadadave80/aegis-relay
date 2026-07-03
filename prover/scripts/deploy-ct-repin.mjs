#!/usr/bin/env node
/**
 * deploy-ct-repin.mjs — redeploy the CT stack (verifier + auditor + hooked
 * token) PINNED to the CURRENT registry, reusing everything else.
 *
 * Why: the registry↔token address pin is set-once/immutable. The role-binding
 * redeploy produced a fresh registry (CAROLAUW…) whose `set_ct_token` was never
 * called, while the old token (CAIRUFAA…) is permanently pinned to the previous
 * registry (CC4HXX…). To make the confidential rail live against the current
 * registry we deploy a NEW token pinned to it, register the VK set + auditor key,
 * and close the pin with `set_ct_token` on the current registry.
 *
 * This is a trimmed `deploy-all.mjs`: it SKIPS the Aegis workspace build +
 * credentials/airspace/registry deploy + corridor/root setup, and reuses the
 * existing registry constant below.
 *
 * Network: uses env AEGIS_NETWORK (a stellar-cli network name; default
 * "alchemy") for the CLI and STELLAR_TESTNET_RPC_URL for the @ctd/sdk client.
 *
 * Usage: STELLAR_TESTNET_RPC_URL=<rpc> AEGIS_NETWORK=alchemy \
 *        node prover/scripts/deploy-ct-repin.mjs
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { xdr, Address } from '@stellar/stellar-sdk';
import {
  ChainClient, keypairSigner, addressToField, randomScalar, toHex32,
  H, scalarMul, pointToBytes, pointCoords, fromBytesBE, CIRCUIT_TYPE,
} from '@ctd/sdk';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OUT_DIR = join(REPO_ROOT, 'prover', 'out');

const NETWORK = process.env.AEGIS_NETWORK || 'alchemy';
const RPC_URL = process.env.STELLAR_TESTNET_RPC_URL;
if (!RPC_URL) throw new Error('set STELLAR_TESTNET_RPC_URL (the SDK client needs a raw RPC url)');
const PASSPHRASE = 'Test SDF Network ; September 2015';

/** The CURRENT registry (role-binding redeploy) — reused, NOT redeployed. */
const REGISTRY = 'CAROLAUWCNZGSLSAISY5OVY5GZDZ6ULPBAO3U4FKTU3OIAOVPO6ZKPZL';
const NATIVE_SAC = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';

const CT_WASM = {
  verifier: join(REPO_ROOT, 'contracts-ct/target/wasm32v1-none/release/confidential_verifier_contract.wasm'),
  auditor: join(REPO_ROOT, 'contracts-ct/target/wasm32v1-none/release/confidential_auditor_contract.wasm'),
  token: join(REPO_ROOT, 'contracts-ct/target/wasm32v1-none/release/aegis_ct_token.wasm'),
};

const VK_FILES = [
  ['register', CIRCUIT_TYPE.Register],
  ['withdraw', CIRCUIT_TYPE.Withdraw],
  ['transfer', CIRCUIT_TYPE.Transfer],
  ['spender_transfer', CIRCUIT_TYPE.SpenderTransfer],
  ['set_spender', CIRCUIT_TYPE.SetSpender],
  ['revoke_spender', CIRCUIT_TYPE.RevokeSpender],
];

function stellar(args) {
  return execFileSync('stellar', args, {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024,
  }).trim();
}
const publicKey = (name) => stellar(['keys', 'public-key', name]);
const secretOf = (name) => stellar(['keys', 'show', name]);

function deploy(wasmPath, source, ctorArgs) {
  const out = stellar([
    'contract', 'deploy', '--wasm', wasmPath, '--source-account', source,
    '--network', NETWORK, '--optimize=false', '--', ...ctorArgs,
  ]);
  const id = out.split(/\s+/).filter(Boolean).pop();
  if (!id?.startsWith('C')) throw new Error(`unexpected deploy output: ${out}`);
  return id;
}
function invoke(contractId, source, fnAndArgs) {
  return stellar(['contract', 'invoke', '--id', contractId, '--source-account', source, '--network', NETWORK, '--', ...fnAndArgs]);
}
function readCtVk(name) {
  const url = import.meta.resolve(`@ctd/sdk/circuits/vks/${name}.vk.bin`);
  return new Uint8Array(readFileSync(fileURLToPath(url)));
}
async function withRetry(label, fn, attempts = 4) {
  for (let i = 1; ; i++) {
    try { return await fn(); }
    catch (e) {
      if (i >= attempts) throw e;
      console.warn(`  retry ${i}/${attempts - 1} for ${label}: ${e.message ?? e}`);
      await new Promise((r) => setTimeout(r, 4000 * i));
    }
  }
}
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

async function main() {
  const adminPub = publicKey('relay-admin');
  console.log(`[keys] admin=${adminPub}`);
  console.log(`[reuse] registry = ${REGISTRY} (NOT redeployed)`);

  console.log('[ct] deploying verifier / auditor / hooked token (pinned to current registry)…');
  const verifier = deploy(CT_WASM.verifier, 'relay-admin', ['--admin', adminPub, '--manager', adminPub]);
  console.log(`  verifier = ${verifier}`);
  const auditor = deploy(CT_WASM.auditor, 'relay-admin', ['--admin', adminPub, '--manager', adminPub]);
  console.log(`  auditor  = ${auditor}`);

  const client = new ChainClient({ rpcUrl: RPC_URL, networkPassphrase: PASSPHRASE, contracts: { token: '', verifier, auditor } });
  const ledgerBeforeToken = await client.latestLedger();

  const token = deploy(CT_WASM.token, 'relay-admin', [
    '--underlying_asset', NATIVE_SAC, '--verifier', verifier, '--auditor', auditor, '--registry', REGISTRY,
  ]);
  console.log(`  token    = ${token}  (hooked AegisEscrowHooks, pinned to ${REGISTRY})`);
  client.cfg.contracts.token = token;

  const signer = keypairSigner(secretOf('relay-admin'), PASSPHRASE);

  for (const [name, circuitType] of VK_FILES) {
    const vk = readCtVk(name);
    await withRetry(`register VK ${name}`, () =>
      client.invoke(verifier, 'register_verification_key',
        [xdr.ScVal.scvU32(circuitType), xdr.ScVal.scvBytes(Buffer.from(vk)), new Address(adminPub).toScVal()], signer));
    console.log(`  registered VK ${name} (circuit ${circuitType}, ${vk.length}B)`);
  }

  const auditorSecret = randomScalar();
  const kAud = scalarMul(auditorSecret, H);
  await withRetry('register auditor key 0', () =>
    client.invoke(auditor, 'register_key',
      [xdr.ScVal.scvU32(0), xdr.ScVal.scvBytes(Buffer.from(pointToBytes(kAud))), new Address(adminPub).toScVal()], signer));
  const kAudCoords = pointCoords(kAud);
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, 'auditor-key.json'),
    JSON.stringify({ id: 0, secretHex: toHex32(auditorSecret), keyXHex: toHex32(kAudCoords.x), keyYHex: toHex32(kAudCoords.y) }, null, 2) + '\n');
  console.log('  registered auditor key id 0 (secret → prover/out/auditor-key.json, gitignored)');

  const sdkAddrF = addressToField(token);
  const onchainAddrF = await readAddressAsField(client, ledgerBeforeToken);
  if (onchainAddrF === null) console.warn('  ! no AddressAsFieldSet event; skipping parity assert');
  else if (onchainAddrF !== sdkAddrF) throw new Error(`addr_f MISMATCH — SDK ${toHex32(sdkAddrF)} != contract ${toHex32(onchainAddrF)}`);
  else console.log(`  addr_f parity OK: ${toHex32(sdkAddrF)}`);

  invoke(REGISTRY, 'relay-admin', ['set_ct_token', '--token', token]);
  console.log(`[pin] registry.set_ct_token(${token}) — pin closed on the current registry`);

  const record = { registry: REGISTRY, ctToken: token, ctVerifier: verifier, ctAuditor: auditor, underlyingSac: NATIVE_SAC, rpcUrl: RPC_URL, passphrase: PASSPHRASE, deployedAtLedger: ledgerBeforeToken };
  writeFileSync(join(OUT_DIR, 'ct-repin-deployment.json'), JSON.stringify(record, null, 2) + '\n');
  console.log('\n=== CT re-pin complete ===');
  console.log(`ctToken   = ${token}`);
  console.log(`ctVerifier= ${verifier}`);
  console.log(`ctAuditor = ${auditor}`);
  console.log('record → prover/out/ct-repin-deployment.json');
}

main().catch((e) => { console.error(e); process.exit(1); });
