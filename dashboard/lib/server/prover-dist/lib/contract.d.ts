/**
 * contract.ts — `stellar contract invoke` argv builder + runner, and the
 * snarkjs-proof → invoke-JSON encoder.
 *
 * No contracts are deployed yet, so transaction submission SHELLS OUT to the
 * `stellar` CLI (v27) with role keys already in its keystore (relay-merchant,
 * relay-carrier, relay-admin). The registry contract id comes from
 * $AEGIS_REGISTRY_ID or an explicit `--registry` flag. These argv arrays are
 * built now and exercised at deploy time; the shapes are snapshot-tested.
 *
 * ── stellar-cli v27 argument conventions ────────────────────────────────────
 * `stellar contract invoke --id <C...> --source <key> --network testnet -- \
 *      <fn> --<argname> <value> ...`
 * Each contract-function parameter becomes a `--<argname>` flag whose name
 * matches the Rust parameter name exactly. Value encodings used here:
 *   - u64 / u32 / i128  → decimal number as a string
 *   - Address           → G.../C... string
 *   - U256              → DECIMAL string (e.g. C_S, carrier_pk_commit, nullifier)
 *   - Vec<u32>          → JSON array string, e.g. "[10000]"
 *   - enum (unit variant, e.g. Method/Rail) → the variant name as a bare string
 *                          ("Courier", "Transparent") — soroban unit-variant form
 *   - Option<T>         → provide the inner value for Some; OMIT the flag for None
 *   - struct (Proof)    → JSON object string with hex BytesN fields:
 *                          '{"a":"<128hex>","b":"<256hex>","c":"<128hex>"}'
 * Each call site documents its concrete JSON shape in a comment above it.
 */
import { type SnarkjsProof } from './bn254.js';
/** An ordered [flagName, value] pair; `undefined` value → omit (Option None). */
export type InvokeArg = [name: string, value: string | undefined];
export interface InvokeCommand {
    fn: string;
    args: InvokeArg[];
    /** stellar keys keystore name, e.g. "relay-merchant". */
    source: string;
    /** Registry contract id (from $AEGIS_REGISTRY_ID or --registry). */
    registryId: string;
    /** Defaults to "testnet". */
    network?: string;
}
/**
 * Build the full `stellar` argv (argv[0] = "stellar") for a contract invoke.
 * Deterministic ordering — this is what the snapshot tests pin.
 */
export declare function buildInvoke(cmd: InvokeCommand): string[];
export interface InvokeResult {
    ok: boolean;
    status: number | null;
    stdout: string;
    stderr: string;
}
/**
 * Run a built argv (argv[0] = "stellar") via spawnSync, surfacing a clear
 * error on non-zero exit or spawn failure. Never called from tests.
 */
export declare function runInvoke(argv: string[]): InvokeResult;
/** Hex of the big-endian-encoded proof (bn254.ts encoders): a=128, b=256, c=128 hex chars. */
export declare function proofToInvokeJson(proofJson: SnarkjsProof): {
    a: string;
    b: string;
    c: string;
};
/**
 * Resolve the registry contract id from an explicit value, then
 * $AEGIS_REGISTRY_ID. Returns undefined when neither is set (CLIs then PRINT
 * the invoke argv instead of submitting).
 */
export declare function resolveRegistryId(explicit?: string): string | undefined;
/**
 * Minimal `--key value` / boolean-flag parser for the operator CLIs.
 * `--flag` with no following value (or followed by another `--flag`) is `"true"`.
 */
export declare function parseFlags(args: string[]): Record<string, string>;
export declare const TESTNET: {
    readonly admin: "GAYEHGWF66UOQCNQLH4ROGRWTMQ2FFQEN6VQKH42GUJOKU3PFY2BGSSH";
    readonly merchant: "GBXY6FYG5ZIBVPPCJ2LFZ3XZDTS3K4DJHMIPYP5GXOWCW6JMY7DQMA7N";
    readonly carrier: "GBAMBJG3UA4GMWJDY7QT2NOPKVK3AFMLNVDGJPXO73J5UUL6P6AVC2NQ";
    readonly issuer: "GA2TW4FN2OKPIFFODXJ2AQKNA3QYTVMBK72763EEJOSU3SQLQ2NYUR6Z";
    readonly authority: "GAGZFIJUI3MCR3VCLW6G5TQOPBAWSF3KD5PRDD3D7D34CCOCOBFBGBW5";
    readonly nativeSac: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
};
/** stellar keys keystore names for `--source`. */
export declare const SOURCE: {
    readonly admin: "relay-admin";
    readonly merchant: "relay-merchant";
    readonly carrier: "relay-carrier";
};
