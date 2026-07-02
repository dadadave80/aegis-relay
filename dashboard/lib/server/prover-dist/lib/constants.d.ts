/**
 * constants.ts — normative protocol constants (DESIGN.md §5, single TS source).
 *
 * These MUST stay identical to `contracts/aegis-common/src/lib.rs` (Rust) and
 * the values pinned in `fixtures/parity.json`. The parity tests
 * (`prover npm test`, `cargo test -p aegis-common`, `node
 * circuits/test/parity.test.mjs`) enforce the lockstep — never edit one side
 * alone.
 */
export declare const DOM_SHIP = 1n;
export declare const DOM_ACCEPT = 2n;
export declare const DOM_HANDOFF = 3n;
export declare const DOM_HANDMSG = 4n;
export declare const DOM_PODMSG = 5n;
export declare const DOM_NULL = 6n;
export declare const DOM_PKC = 7n;
export declare const DOM_CRED = 8n;
export declare const DOM_CELL = 9n;
export declare const DOM_FLIGHT = 10n;
export declare const DOM_COND = 11n;
export declare const DOM_EMPTY = 12n;
export declare const WINDOW_SEC = 600;
export declare const GAP_MAX_SEC = 30;
export declare const ALT_MAX_DM = 1200;
export declare const VMAX_MPS = 25;
export declare const VMAX_U = 20;
export declare const RC_RES = 15;
export declare const RD_RES = 17;
export declare const CORRIDOR_DEPTH = 12;
export declare const DEST_DEPTH = 6;
export declare const CRED_DEPTH = 10;
export declare const DRONE_MAX_G = 5000;
export declare const METHOD_COURIER = 1;
export declare const METHOD_LOCKER = 2;
export declare const METHOD_DRONE = 3;
export declare const PAD = "14744269619966411208579211824598458697587494354926760081771325075741142829156";
