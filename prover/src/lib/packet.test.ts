/**
 * packet.test.ts — X25519 sealed-box roundtrip + tamper/wrong-key rejection.
 * All node built-in crypto; no network, no npm deps.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  generatePacketKeypair,
  openX25519,
  sealX25519,
  PACKET_VERSION,
  type Sealed,
} from './packet.js';

test('sealX25519 / openX25519 roundtrips a structured object', () => {
  const { publicKeyPem, privateKeyPem } = generatePacketKeypair();
  const obj = { hello: 'aegis', n: 42, nested: { a: [1, 2, 3], b: 'x' }, big: '987654321987654321' };
  const sealed = sealX25519(publicKeyPem, obj);
  assert.equal(sealed.v, PACKET_VERSION);
  assert.equal(sealed.alg, 'x25519-chacha20poly1305');
  assert.deepEqual(openX25519(privateKeyPem, sealed), obj);
});

test('tampered ciphertext is rejected (Poly1305)', () => {
  const { publicKeyPem, privateKeyPem } = generatePacketKeypair();
  const sealed = sealX25519(publicKeyPem, { secret: 'launch-codes' });
  const ct = Buffer.from(sealed.ct, 'hex');
  ct[0] ^= 0xff;
  const tampered: Sealed = { ...sealed, ct: ct.toString('hex') };
  assert.throws(() => openX25519(privateKeyPem, tampered));
});

test('tampered auth tag is rejected', () => {
  const { publicKeyPem, privateKeyPem } = generatePacketKeypair();
  const sealed = sealX25519(publicKeyPem, { secret: 'launch-codes' });
  const tag = Buffer.from(sealed.tag, 'hex');
  tag[0] ^= 0xff;
  const tampered: Sealed = { ...sealed, tag: tag.toString('hex') };
  assert.throws(() => openX25519(privateKeyPem, tampered));
});

test('a swapped ephemeral public key is rejected', () => {
  const recipient = generatePacketKeypair();
  const other = generatePacketKeypair();
  const sealed = sealX25519(recipient.publicKeyPem, { secret: 'x' });
  // Replace epk with a foreign ephemeral pub → derived key + AAD both change.
  const foreign = sealX25519(other.publicKeyPem, { secret: 'y' });
  const tampered: Sealed = { ...sealed, epk: foreign.epk };
  assert.throws(() => openX25519(recipient.privateKeyPem, tampered));
});

test('the wrong private key cannot open the box', () => {
  const recipient = generatePacketKeypair();
  const attacker = generatePacketKeypair();
  const sealed = sealX25519(recipient.publicKeyPem, { secret: 'x' });
  assert.throws(() => openX25519(attacker.privateKeyPem, sealed));
});
