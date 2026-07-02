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
export declare function toBE32(value: bigint | string): Uint8Array;
/** Concatenate byte arrays. */
export declare function concatBytes(...arrays: Uint8Array[]): Uint8Array;
/**
 * Encode a snarkjs G1 point as BE32(x) || BE32(y) (64 bytes).
 * snarkjs pi_a / pi_c = [x, y, "1"] (affine, trailing projective 1 dropped).
 */
export declare function encodeG1(point: string[]): Uint8Array;
/**
 * Encode a snarkjs G2 point as BE32(x_c1)||BE32(x_c0) || BE32(y_c1)||BE32(y_c0)
 * (128 bytes).
 *
 * snarkjs pi_b JSON = [[x_c0, x_c1], [y_c0, y_c1], …] — real limb (c0) first.
 * Soroban wants the IMAGINARY limb (c1) FIRST, i.e. the inverse of the snarkjs
 * JSON order. (v1-verified; swapping these limbs makes every pairing check
 * fail with no other symptom.)
 */
export declare function encodeG2(point: string[][]): Uint8Array;
/** snarkjs proof.json shape (Groth16 over BN254). */
export interface SnarkjsProof {
    pi_a: string[];
    pi_b: string[][];
    pi_c: string[];
}
/** Soroban-ready proof bytes: a (64), b (128), c (64). */
export interface EncodedProof {
    a: Uint8Array;
    b: Uint8Array;
    c: Uint8Array;
}
/** Encode a parsed snarkjs proof.json into Soroban G1/G2 byte form. */
export declare function encodeProof(proof: SnarkjsProof): EncodedProof;
/**
 * Normalize snarkjs publicSignals (strings, bigints, or numbers) to the
 * canonical decimal-string array used everywhere in this repo.
 */
export declare function encodePublics(publicSignals: Array<string | bigint | number>): string[];
/** Convert a bigint (or decimal string) to an xdr.ScVal U256 for contract calls. */
export declare function bigintToU256ScVal(value: bigint | string): xdr.ScVal;
/** Proof as ScMap { a: Bytes(64), b: Bytes(128), c: Bytes(64) } for invocation. */
export declare function proofToScVal(proof: EncodedProof): xdr.ScVal;
