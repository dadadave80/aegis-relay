import { test, expect } from "bun:test";
import { buildEddsa, buildPoseidon } from "circomlibjs";
import { signPodBrowser, hexToBytes } from "./sign-browser";

// Pinned fixture — every value < BN254 scalar field r.
const FIX = {
  seedHex: "01".repeat(32),
  shipmentId: 42,
  carrierPkCommit: "12345678901234567890",
  cellRd: "987654321",
  ts: 1_700_000_000,
} as const;

const DOM_PODMSG = 5n;

// Golden vector: deterministic EdDSA-Poseidon output for FIX, locked from the
// prover-dist recipient.signPod reference path. Proves node/bun/browser parity.
const GOLDEN = {
  R8x: "14096562531871567268486947786239539474187363526868524743791081843279728841793",
  R8y: "4519269772876913247747127903344600168414194767092648667362530706554758514352",
  S: "2212755858311729726135700802042100446201435558261968345478997182793010900987",
} as const;

function podMsgFE(
  poseidon: Awaited<ReturnType<typeof buildPoseidon>>,
  bjF: { e(x: bigint): unknown },
  ts: number,
): unknown {
  const dec = poseidon.F.toString(
    poseidon([
      DOM_PODMSG,
      BigInt(FIX.shipmentId),
      BigInt(FIX.carrierPkCommit),
      BigInt(FIX.cellRd),
      BigInt(ts),
    ]),
  );
  return bjF.e(BigInt(dec));
}

test("hexToBytes decodes a 32-byte seed and tolerates a 0x prefix", () => {
  const b = hexToBytes(FIX.seedHex);
  expect(b).toBeInstanceOf(Uint8Array);
  expect(b.length).toBe(32);
  expect(b[0]).toBe(1);
  expect(hexToBytes("0x" + FIX.seedHex).length).toBe(32);
});

test("signPodBrowser matches the pinned golden vector", async () => {
  const sig = await signPodBrowser(FIX);
  expect(sig.R8[0]).toBe(GOLDEN.R8x);
  expect(sig.R8[1]).toBe(GOLDEN.R8y);
  expect(sig.S).toBe(GOLDEN.S);
});

test("signPodBrowser signature is accepted by eddsa.verifyPoseidon (client parity)", async () => {
  const [eddsa, poseidon] = await Promise.all([buildEddsa(), buildPoseidon()]);
  const bjF = eddsa.babyJub.F;
  const pub = eddsa.prv2pub(hexToBytes(FIX.seedHex));
  const sig = await signPodBrowser(FIX);
  const R8: [unknown, unknown] = [bjF.e(BigInt(sig.R8[0])), bjF.e(BigInt(sig.R8[1]))];
  expect(eddsa.verifyPoseidon(podMsgFE(poseidon, bjF, FIX.ts), { R8, S: BigInt(sig.S) }, pub)).toBe(true);
});

test("verifyPoseidon rejects the signature under a tampered ts", async () => {
  const [eddsa, poseidon] = await Promise.all([buildEddsa(), buildPoseidon()]);
  const bjF = eddsa.babyJub.F;
  const pub = eddsa.prv2pub(hexToBytes(FIX.seedHex));
  const sig = await signPodBrowser(FIX);
  const R8: [unknown, unknown] = [bjF.e(BigInt(sig.R8[0])), bjF.e(BigInt(sig.R8[1]))];
  expect(eddsa.verifyPoseidon(podMsgFE(poseidon, bjF, FIX.ts + 1), { R8, S: BigInt(sig.S) }, pub)).toBe(false);
});
