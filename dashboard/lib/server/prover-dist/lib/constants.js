/**
 * constants.ts — normative protocol constants (DESIGN.md §5, single TS source).
 *
 * These MUST stay identical to `contracts/aegis-common/src/lib.rs` (Rust) and
 * the values pinned in `fixtures/parity.json`. The parity tests
 * (`prover npm test`, `cargo test -p aegis-common`, `node
 * circuits/test/parity.test.mjs`) enforce the lockstep — never edit one side
 * alone.
 */
// ── Domain-separation tags (DESIGN.md §5.2) ─────────────────────────────────
// Every Poseidon call takes a distinct leading tag; a hash without a tag is a
// spec violation. Never reuse tags.
export const DOM_SHIP = 1n; // shipment commitment C_S
export const DOM_ACCEPT = 2n; // custody head, genesis (single-carrier)
export const DOM_HANDOFF = 3n; // custody head, advance (A4, stretch)
export const DOM_HANDMSG = 4n; // handoff message signed by both parties
export const DOM_PODMSG = 5n; // proof-of-delivery message signed by recipient
export const DOM_NULL = 6n; // delivery nullifier
export const DOM_PKC = 7n; // carrier public-key commitment
export const DOM_CRED = 8n; // credential tree leaf
export const DOM_CELL = 9n; // geocell tree leaf (corridor + dest region)
export const DOM_FLIGHT = 10n; // flight-log running digest init
export const DOM_COND = 11n; // condition-log running digest init (stretch)
export const DOM_EMPTY = 12n; // canonical padding tag (reserved, unused)
// ── Protocol parameters (DESIGN.md §5.3–§5.5, §6) ───────────────────────────
export const WINDOW_SEC = 600; // flight window length, seconds
export const GAP_MAX_SEC = 30; // max gap between waypoints, seconds
export const ALT_MAX_DM = 1200; // max altitude, decimeters AGL
export const VMAX_MPS = 25; // max speed, meters/second
export const VMAX_U = 20; // floor(VMAX_MPS / 1.194) — lat_q units/second
export const RC_RES = 15; // corridor-cell Morton resolution
export const RD_RES = 17; // destination-region-cell Morton resolution
export const CORRIDOR_DEPTH = 12; // corridor tree depth (≤ 4096 RC cells)
export const DEST_DEPTH = 6; // destination region tree depth (≤ 64 RD cells)
export const CRED_DEPTH = 10; // issuer credential tree depth
export const DRONE_MAX_G = 5000; // drone payload hard cap, grams
export const METHOD_COURIER = 1;
export const METHOD_LOCKER = 2;
export const METHOD_DRONE = 3;
// ── Padding leaf ────────────────────────────────────────────────────────────
// PAD = Poseidon(0, 0) with circomlib parameters — the canonical zero leaf for
// every fixed-depth Merkle tree (Rust poseidon-merkle, circom gadgets, TS).
// Pinned from fixtures/parity.json — regenerate with
// prover/scripts/gen-parity.mjs.
export const PAD = '14744269619966411208579211824598458697587494354926760081771325075741142829156';
