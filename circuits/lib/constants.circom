pragma circom 2.1.6;

// ---------------------------------------------------------------------------
// constants.circom — NORMATIVE protocol constants (DESIGN.md §5.2–§5.5, §6).
//
// These constants exist in exactly three places, kept in lockstep by parity
// tests (DESIGN §5): contracts/aegis-common (Rust), this file (circom), and
// prover/src/lib/constants.ts (TypeScript). Change one, change all three.
// ---------------------------------------------------------------------------

// --- Domain-separation tags (DESIGN §5.2) ---
// Every Poseidon call takes a distinct leading tag; a hash without a tag is a
// spec violation. Never reuse tags.
function DOM_SHIP()    { return 1; }  // shipment commitment C_S
function DOM_ACCEPT()  { return 2; }  // custody head, genesis (single-carrier)
function DOM_HANDOFF() { return 3; }  // custody head, advance (A4, stretch)
function DOM_HANDMSG() { return 4; }  // handoff message signed by both parties
function DOM_PODMSG()  { return 5; }  // proof-of-delivery message signed by recipient
function DOM_NULL()    { return 6; }  // delivery nullifier
function DOM_PKC()     { return 7; }  // carrier public-key commitment
function DOM_CRED()    { return 8; }  // credential tree leaf
function DOM_CELL()    { return 9; }  // geocell tree leaf (corridor + dest region)
function DOM_FLIGHT()  { return 10; } // flight-log running digest init
function DOM_COND()    { return 11; } // condition-log running digest init (stretch)
function DOM_EMPTY()   { return 12; } // reserved for padding leaves — UNUSED (see PAD)

// --- Flight / telemetry bounds (DESIGN §5.5, §9 A2) ---
function WINDOW_SEC()  { return 600; }  // PoD / flight freshness window, seconds
function GAP_MAX_SEC() { return 30; }   // max gap between consecutive waypoints, seconds
function ALT_MAX_DM()  { return 1200; } // max altitude, decimeters AGL
function VMAX_U()      { return 20; }   // max speed in lat_q units/sec: floor(v_max_mps / 1.194)

// --- Geocell resolutions & fixed tree depths (DESIGN §5.4, §6.3) ---
function RC_RES()         { return 15; } // corridor cell resolution (Morton r)
function RD_RES()         { return 17; } // destination-region cell resolution (Morton r)
function CORRIDOR_DEPTH() { return 12; } // corridor tree depth (<= 4096 RC-cells)
function DEST_DEPTH()     { return 6; }  // destination region tree depth (<= 64 RD-cells)
function CRED_DEPTH()     { return 10; } // credential tree depth (issuer, per-epoch root)

// --- Delivery method / payload (DESIGN §9 A2, §11) ---
function DRONE_MAX_G()  { return 5000; } // fallback drone payload limit, grams
function METHOD_DRONE() { return 3; }    // method enum value for drone delivery

// --- Canonical padding leaf (DESIGN §5.2, threat T13) ---
// PAD = poseidon2(0, 0) with circomlib Poseidon parameters — the canonical
// padding leaf for every fixed-depth Merkle tree (matches the transplanted
// contracts/poseidon-merkle crate and the TS prover; DOM_EMPTY stays reserved
// but unused). Every membership gadget MUST constrain leaf != PAD().
function PAD() { return 14744269619966411208579211824598458697587494354926760081771325075741142829156; }
