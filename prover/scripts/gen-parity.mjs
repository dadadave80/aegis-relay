#!/usr/bin/env node
/**
 * gen-parity.mjs — generates fixtures/parity.json, the shared-truth parity
 * vectors for Aegis Relay (DESIGN.md §5/§6).
 *
 * One fixed, fully deterministic sample input set is hashed into every
 * normative Poseidon structure. The resulting decimal strings are the ONLY
 * source of pinned constants for:
 *   - contracts/aegis-common  (Rust unit tests — decimals hardcoded there)
 *   - prover/src/lib/*.test.ts (read this JSON at test time)
 *   - circuits/test/parity.test.mjs (witness outputs vs `expected` here)
 *
 * Poseidon = circomlibjs buildPoseidon() (circomlib parameters), the same
 * function proven CAP-0075-parity-compatible in v1.
 *
 * Run: node prover/scripts/gen-parity.mjs   (from anywhere; paths are absolute)
 *
 * Sample-input provenance (all arbitrary but FROZEN — changing any value
 * invalidates every pinned constant downstream):
 *   carrier eddsa seed    = bytes 0x01..0x20  (Baby Jubjub key via circomlibjs eddsa)
 *   recipient eddsa seed  = bytes 0x21..0x40
 *   pk_blind              = 12345
 *   shipment_id           = 42
 *   sku_hash              = 31337              (stand-in contents-doc hash)
 *   qty                   = 3
 *   weight_g              = 1500
 *   value_units           = 250000000          (25 XLM in stroops)
 *   origin_cell           = 123456789          (< 2^30, RC_RES=15 Morton cell)
 *   dest_region_root      = 424242424242       (stand-in depth-6 RD-tree root)
 *   method                = 3                  (METHOD_DRONE)
 *   deadline_ts           = 1900000000
 *   shipment_secret       = 1234567890123456789012345678901234567890
 *   cred_class            = 3                  (drone)
 *   payload_limit_g       = 5000               (DRONE_MAX_G)
 *   expiry_ts             = 1893456000
 *   cell_id               = 987654321          (< 2^34, RD_RES=17 Morton cell)
 *   cell_rd               = 555555555
 *   pod_ts                = 1750000000
 *   waypoint 0            = (lat_q 8388608, lon_q 8388608, alt_dm 500, t 1750000000)
 *   waypoint 1            = (lat_q 8388708, lon_q 8388658, alt_dm 520, t 1750000010)
 *   merkle4 leaves        = P(DOM_CELL, 101), P(DOM_CELL, 202), P(DOM_CELL, 303), PAD
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPoseidon, buildEddsa } from 'circomlibjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../..');
const OUT_PATH = join(REPO_ROOT, 'fixtures/parity.json');

// ── Normative constants (DESIGN.md §5.2 / PIVOT) ─────────────────────────────

const DOM = {
  DOM_SHIP: 1n,
  DOM_ACCEPT: 2n,
  DOM_HANDOFF: 3n,
  DOM_HANDMSG: 4n,
  DOM_PODMSG: 5n,
  DOM_NULL: 6n,
  DOM_PKC: 7n,
  DOM_CRED: 8n,
  DOM_CELL: 9n,
  DOM_FLIGHT: 10n,
  DOM_COND: 11n,
  DOM_EMPTY: 12n, // reserved, unused
};

const PARAMS = {
  WINDOW_SEC: 600,
  GAP_MAX_SEC: 30,
  ALT_MAX_DM: 1200,
  VMAX_MPS: 25,
  VMAX_U: 20, // floor(25 / 1.194)
  RC_RES: 15,
  RD_RES: 17,
  CORRIDOR_DEPTH: 12,
  DEST_DEPTH: 6,
  CRED_DEPTH: 10,
  DRONE_MAX_G: 5000,
  METHOD_COURIER: 1,
  METHOD_LOCKER: 2,
  METHOD_DRONE: 3,
};

// ── Main ─────────────────────────────────────────────────────────────────────

const poseidon = await buildPoseidon();
const F = poseidon.F;
/** Poseidon over 1..16 field inputs → decimal string. */
const P = (...inputs) => F.toString(poseidon(inputs.map(BigInt)));

const eddsa = await buildEddsa();
const bjF = eddsa.babyJub.F;
/** Baby Jubjub public key [x, y] (decimal strings) from a 32-byte seed. */
function keyFromSeed(firstByte) {
  const seed = Buffer.from(Array.from({ length: 32 }, (_, i) => firstByte + i));
  const [x, y] = eddsa.prv2pub(seed);
  return [bjF.toObject(x).toString(), bjF.toObject(y).toString()];
}

const [pk_x, pk_y] = keyFromSeed(0x01); // carrier key
const [recipient_pk_x, recipient_pk_y] = keyFromSeed(0x21); // recipient key

// 1. PAD = P(0, 0) — canonical zero leaf, same everywhere.
const PAD = P(0, 0);

// 2. pk_commit = P(DOM_PKC, pk_x, pk_y, pk_blind)
const pk_blind = '12345';
const pk_commit = P(DOM.DOM_PKC, pk_x, pk_y, pk_blind);

// 3. custody head = P2(P2(DOM_ACCEPT, shipment_id), pk_commit) — nested arity-2
const shipment_id = '42';
const head_inner = P(DOM.DOM_ACCEPT, shipment_id);
const custody_head = P(head_inner, pk_commit);

// 4. C_S — 12-input shipment commitment
const cs_inputs = {
  sku_hash: '31337',
  qty: '3',
  weight_g: '1500',
  value_units: '250000000',
  origin_cell: '123456789',
  dest_region_root: '424242424242',
  recipient_pk_x,
  recipient_pk_y,
  method: String(PARAMS.METHOD_DRONE),
  deadline_ts: '1900000000',
  shipment_secret: '1234567890123456789012345678901234567890',
};
const c_s = P(
  DOM.DOM_SHIP,
  cs_inputs.sku_hash,
  cs_inputs.qty,
  cs_inputs.weight_g,
  cs_inputs.value_units,
  cs_inputs.origin_cell,
  cs_inputs.dest_region_root,
  cs_inputs.recipient_pk_x,
  cs_inputs.recipient_pk_y,
  cs_inputs.method,
  cs_inputs.deadline_ts,
  cs_inputs.shipment_secret,
);

// 5. nullifier = P(DOM_NULL, shipment_secret)
const nullifier = P(DOM.DOM_NULL, cs_inputs.shipment_secret);

// 6. cred_leaf = P(DOM_CRED, pk_x, pk_y, class, payload_limit_g, expiry_ts)
const cred_inputs = {
  pk_x,
  pk_y,
  cred_class: '3',
  payload_limit_g: String(PARAMS.DRONE_MAX_G),
  expiry_ts: '1893456000',
};
const cred_leaf = P(
  DOM.DOM_CRED,
  cred_inputs.pk_x,
  cred_inputs.pk_y,
  cred_inputs.cred_class,
  cred_inputs.payload_limit_g,
  cred_inputs.expiry_ts,
);

// 7. cell_leaf = P(DOM_CELL, cell_id)
const cell_id = '987654321';
const cell_leaf = P(DOM.DOM_CELL, cell_id);

// 8. pod_msg = P(DOM_PODMSG, shipment_id, carrier_pk_commit, cell_rd, ts)
const pod_inputs = {
  shipment_id,
  carrier_pk_commit: pk_commit,
  cell_rd: '555555555',
  ts: '1750000000',
};
const pod_msg = P(
  DOM.DOM_PODMSG,
  pod_inputs.shipment_id,
  pod_inputs.carrier_pk_commit,
  pod_inputs.cell_rd,
  pod_inputs.ts,
);

// 9. Flight running digest: d0 = P(DOM_FLIGHT, shipment_id);
//    d_i = P(d_{i-1}, lat_q, lon_q, alt_dm, t_i)
const waypoints = [
  { lat_q: '8388608', lon_q: '8388608', alt_dm: '500', t: '1750000000' },
  { lat_q: '8388708', lon_q: '8388658', alt_dm: '520', t: '1750000010' },
];
const d0 = P(DOM.DOM_FLIGHT, shipment_id);
const d1 = P(d0, waypoints[0].lat_q, waypoints[0].lon_q, waypoints[0].alt_dm, waypoints[0].t);
const d2 = P(d1, waypoints[1].lat_q, waypoints[1].lon_q, waypoints[1].alt_dm, waypoints[1].t);

// 10. merkle4_root over [L0, L1, L2, PAD] — poseidon-merkle convention:
//     pairwise poseidon2, even index = left child, zero-leaf padding.
const L0 = P(DOM.DOM_CELL, 101);
const L1 = P(DOM.DOM_CELL, 202);
const L2 = P(DOM.DOM_CELL, 303);
const merkle4_root = P(P(L0, L1), P(L2, PAD));

// ── Emit ─────────────────────────────────────────────────────────────────────

const fixture = {
  _comment:
    'AUTO-GENERATED by prover/scripts/gen-parity.mjs — DO NOT EDIT. ' +
    'Shared-truth Poseidon parity vectors (DESIGN.md §5/§6); all values decimal strings.',
  constants: {
    ...Object.fromEntries(Object.entries(DOM).map(([k, v]) => [k, v.toString()])),
    ...Object.fromEntries(Object.entries(PARAMS).map(([k, v]) => [k, String(v)])),
    PAD,
  },
  structures: {
    pad: { inputs: {}, expected: PAD },
    pk_commit: { inputs: { pk_x, pk_y, pk_blind }, expected: pk_commit },
    custody_head: {
      inputs: { shipment_id, carrier_pk_commit: pk_commit },
      expected: custody_head,
    },
    c_s: { inputs: cs_inputs, expected: c_s },
    nullifier: {
      inputs: { shipment_secret: cs_inputs.shipment_secret },
      expected: nullifier,
    },
    cred_leaf: { inputs: cred_inputs, expected: cred_leaf },
    cell_leaf: { inputs: { cell_id }, expected: cell_leaf },
    pod_msg: { inputs: pod_inputs, expected: pod_msg },
    flight_digest: {
      inputs: { shipment_id, waypoints },
      expected: { d0, d1, d2 },
    },
    merkle4_root: { inputs: { leaves: [L0, L1, L2] }, expected: merkle4_root },
  },
};

mkdirSync(dirname(OUT_PATH), { recursive: true });
writeFileSync(OUT_PATH, JSON.stringify(fixture, null, 2) + '\n');
console.log(`Written: ${OUT_PATH}`);
console.log(`PAD          : ${PAD}`);
console.log(`pk_commit    : ${pk_commit}`);
console.log(`custody_head : ${custody_head}`);
console.log(`merkle4_root : ${merkle4_root}`);
process.exit(0);
