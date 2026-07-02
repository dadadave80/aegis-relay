/**
 * bn254.test.ts — byte-encoder unit tests.
 *
 * The G2 limb-order vector is synthetic and load-bearing: snarkjs JSON order
 * is [[x_c0, x_c1], [y_c0, y_c1]] but Soroban bytes put the imaginary limb
 * (c1) FIRST. If someone "simplifies" encodeG2, this test fails first.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  toBE32,
  concatBytes,
  encodeG1,
  encodeG2,
  encodeProof,
  encodePublics,
  bigintToU256ScVal,
} from './bn254.js';

// BN254 base-field modulus minus 1 — the largest canonical coordinate value.
const FIELD_MAX =
  21888242871839275222246405745257275088696311157297823662689037894645226208583n - 1n;

function be32(n: bigint): Uint8Array {
  const out = new Uint8Array(32);
  let v = n;
  for (let i = 31; i >= 0; i--) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

test('toBE32(0) is 32 zero bytes', () => {
  assert.deepEqual(toBE32(0n), new Uint8Array(32));
  assert.deepEqual(toBE32('0'), new Uint8Array(32));
});

test('toBE32 handles field-max and round-trips big-endian', () => {
  const bytes = toBE32(FIELD_MAX);
  assert.equal(bytes.length, 32);
  let back = 0n;
  for (const b of bytes) back = (back << 8n) | BigInt(b);
  assert.equal(back, FIELD_MAX);
});

test('toBE32 rejects values that do not fit in 32 bytes', () => {
  assert.throws(() => toBE32(1n << 256n));
  assert.throws(() => toBE32(-1n));
});

test('encodeG1 is BE32(x) || BE32(y)', () => {
  const enc = encodeG1(['5', '6', '1']);
  assert.equal(enc.length, 64);
  assert.deepEqual(enc, concatBytes(be32(5n), be32(6n)));
});

test('encodeG2 puts the imaginary limb FIRST (inverse of snarkjs JSON order)', () => {
  // snarkjs order: [[x_c0, x_c1], [y_c0, y_c1]] = [[1, 2], [3, 4]]
  // expected bytes: BE32(2) || BE32(1) || BE32(4) || BE32(3)
  const enc = encodeG2([
    ['1', '2'],
    ['3', '4'],
    ['1', '0'],
  ]);
  assert.equal(enc.length, 128);
  assert.deepEqual(enc, concatBytes(be32(2n), be32(1n), be32(4n), be32(3n)));
});

test('encodeProof wires pi_a/pi_b/pi_c through the right encoders', () => {
  const { a, b, c } = encodeProof({
    pi_a: ['5', '6', '1'],
    pi_b: [
      ['1', '2'],
      ['3', '4'],
      ['1', '0'],
    ],
    pi_c: ['7', '8', '1'],
  });
  assert.deepEqual(a, concatBytes(be32(5n), be32(6n)));
  assert.deepEqual(b, concatBytes(be32(2n), be32(1n), be32(4n), be32(3n)));
  assert.deepEqual(c, concatBytes(be32(7n), be32(8n)));
});

test('encodePublics normalizes to decimal strings', () => {
  assert.deepEqual(encodePublics(['12', 34n, 56]), ['12', '34', '56']);
});

test('bigintToU256ScVal splits into the four 64-bit limbs', () => {
  const n = (1n << 192n) * 2n + (1n << 128n) * 3n + (1n << 64n) * 5n + 7n;
  const scv = bigintToU256ScVal(n);
  const parts = scv.u256();
  assert.equal(parts.hiHi().toString(), '2');
  assert.equal(parts.hiLo().toString(), '3');
  assert.equal(parts.loHi().toString(), '5');
  assert.equal(parts.loLo().toString(), '7');
  assert.throws(() => bigintToU256ScVal(1n << 256n));
});
