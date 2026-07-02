/**
 * bn254.ts — BN254 point/scalar byte encoders for Soroban (CAP-0074) and the
 * U256 ScVal helper for contract invocation.
 *
 * Consolidated from the v1 donor repo's proven encoders (prover index +
 * gen-fixtures); the G2 limb order below is the classic multi-hour footgun and
 * is already solved here — do not "fix" it.
 *
 * Encoding rules (Ethereum-compatible / soroban-sdk 26.1.0):
 *   Bn254G1Affine = BytesN<64>  = BE32(X) || BE32(Y)
 *   Bn254G2Affine = BytesN<128> = BE32(x_c1)||BE32(x_c0) || BE32(y_c1)||BE32(y_c0)
 */
import { xdr } from '@stellar/stellar-sdk';
/** Encode a bigint (or decimal string) as a 32-byte big-endian Uint8Array. */
export function toBE32(value) {
    let n = typeof value === 'bigint' ? value : BigInt(value);
    if (n < 0n)
        throw new Error(`Value ${value} is negative`);
    const out = new Uint8Array(32);
    for (let i = 31; i >= 0; i--) {
        out[i] = Number(n & 0xffn);
        n >>= 8n;
    }
    if (n !== 0n)
        throw new Error(`Value ${value} does not fit in 32 bytes`);
    return out;
}
/** Concatenate byte arrays. */
export function concatBytes(...arrays) {
    const total = arrays.reduce((s, a) => s + a.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const a of arrays) {
        out.set(a, offset);
        offset += a.length;
    }
    return out;
}
/**
 * Encode a snarkjs G1 point as BE32(x) || BE32(y) (64 bytes).
 * snarkjs pi_a / pi_c = [x, y, "1"] (affine, trailing projective 1 dropped).
 */
export function encodeG1(point) {
    return concatBytes(toBE32(point[0]), toBE32(point[1]));
}
/**
 * Encode a snarkjs G2 point as BE32(x_c1)||BE32(x_c0) || BE32(y_c1)||BE32(y_c0)
 * (128 bytes).
 *
 * snarkjs pi_b JSON = [[x_c0, x_c1], [y_c0, y_c1], …] — real limb (c0) first.
 * Soroban wants the IMAGINARY limb (c1) FIRST, i.e. the inverse of the snarkjs
 * JSON order. (v1-verified; swapping these limbs makes every pairing check
 * fail with no other symptom.)
 */
export function encodeG2(point) {
    const [x_c0, x_c1] = point[0];
    const [y_c0, y_c1] = point[1];
    return concatBytes(toBE32(x_c1), toBE32(x_c0), toBE32(y_c1), toBE32(y_c0));
}
/** Encode a parsed snarkjs proof.json into Soroban G1/G2 byte form. */
export function encodeProof(proof) {
    return {
        a: encodeG1(proof.pi_a),
        b: encodeG2(proof.pi_b),
        c: encodeG1(proof.pi_c),
    };
}
/**
 * Normalize snarkjs publicSignals (strings, bigints, or numbers) to the
 * canonical decimal-string array used everywhere in this repo.
 */
export function encodePublics(publicSignals) {
    return publicSignals.map((s) => BigInt(s).toString(10));
}
/** Convert a bigint (or decimal string) to an xdr.ScVal U256 for contract calls. */
export function bigintToU256ScVal(value) {
    const n = typeof value === 'bigint' ? value : BigInt(value);
    if (n < 0n || n >= 1n << 256n)
        throw new Error(`Value ${value} out of U256 range`);
    const mask = (1n << 64n) - 1n;
    const u64 = (v) => xdr.Uint64.fromString(v.toString());
    return xdr.ScVal.scvU256(new xdr.UInt256Parts({
        hiHi: u64((n >> 192n) & mask),
        hiLo: u64((n >> 128n) & mask),
        loHi: u64((n >> 64n) & mask),
        loLo: u64(n & mask),
    }));
}
/** Proof as ScMap { a: Bytes(64), b: Bytes(128), c: Bytes(64) } for invocation. */
export function proofToScVal(proof) {
    const entry = (key, bytes) => new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol(key),
        val: xdr.ScVal.scvBytes(Buffer.from(bytes)),
    });
    return xdr.ScVal.scvMap([entry('a', proof.a), entry('b', proof.b), entry('c', proof.c)]);
}
