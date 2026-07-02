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

import { spawnSync } from 'node:child_process';
import { encodeProof, type SnarkjsProof } from './bn254.js';

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
export function buildInvoke(cmd: InvokeCommand): string[] {
  const network = cmd.network ?? process.env.AEGIS_NETWORK ?? 'testnet';
  const argv = [
    'stellar',
    'contract',
    'invoke',
    '--id',
    cmd.registryId,
    '--source',
    cmd.source,
    '--network',
    network,
    '--',
    cmd.fn,
  ];
  for (const [name, value] of cmd.args) {
    if (value === undefined) continue; // Option None → omit flag
    argv.push(`--${name}`, value);
  }
  return argv;
}

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
export function runInvoke(argv: string[]): InvokeResult {
  const [bin, ...rest] = argv;
  const res = spawnSync(bin, rest, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (res.error) {
    throw new Error(`failed to spawn '${bin}': ${res.error.message}`);
  }
  const stdout = res.stdout ?? '';
  const stderr = res.stderr ?? '';
  const ok = res.status === 0;
  if (!ok) {
    throw new Error(
      `stellar invoke failed (exit ${res.status}):\n` +
        `  argv: ${argv.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ')}\n` +
        `  stderr: ${stderr.trim()}\n  stdout: ${stdout.trim()}`,
    );
  }
  return { ok, status: res.status, stdout, stderr };
}

/** Hex of the big-endian-encoded proof (bn254.ts encoders): a=128, b=256, c=128 hex chars. */
export function proofToInvokeJson(proofJson: SnarkjsProof): {
  a: string;
  b: string;
  c: string;
} {
  const enc = encodeProof(proofJson);
  return {
    a: Buffer.from(enc.a).toString('hex'), // BytesN<64>  → 128 hex chars
    b: Buffer.from(enc.b).toString('hex'), // BytesN<128> → 256 hex chars
    c: Buffer.from(enc.c).toString('hex'), // BytesN<64>  → 128 hex chars
  };
}

/**
 * Resolve the registry contract id from an explicit value, then
 * $AEGIS_REGISTRY_ID. Returns undefined when neither is set (CLIs then PRINT
 * the invoke argv instead of submitting).
 */
export function resolveRegistryId(explicit?: string): string | undefined {
  return explicit ?? process.env.AEGIS_REGISTRY_ID ?? undefined;
}

/**
 * Minimal `--key value` / boolean-flag parser for the operator CLIs.
 * `--flag` with no following value (or followed by another `--flag`) is `"true"`.
 */
export function parseFlags(args: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = args[i + 1];
    if (next === undefined || next.startsWith('--')) {
      out[key] = 'true';
    } else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

// ── Testnet role addresses + native SAC (public info; docs/testnet.md) ───────
// G.../C... addresses only — never secrets. Overridable via env/flags.

export const TESTNET = {
  admin: 'GAYEHGWF66UOQCNQLH4ROGRWTMQ2FFQEN6VQKH42GUJOKU3PFY2BGSSH',
  merchant: 'GBXY6FYG5ZIBVPPCJ2LFZ3XZDTS3K4DJHMIPYP5GXOWCW6JMY7DQMA7N',
  carrier: 'GBAMBJG3UA4GMWJDY7QT2NOPKVK3AFMLNVDGJPXO73J5UUL6P6AVC2NQ',
  issuer: 'GA2TW4FN2OKPIFFODXJ2AQKNA3QYTVMBK72763EEJOSU3SQLQ2NYUR6Z',
  authority: 'GAGZFIJUI3MCR3VCLW6G5TQOPBAWSF3KD5PRDD3D7D34CCOCOBFBGBW5',
  nativeSac: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
} as const;

/** stellar keys keystore names for `--source`. */
export const SOURCE = {
  admin: 'relay-admin',
  merchant: 'relay-merchant',
  carrier: 'relay-carrier',
} as const;
