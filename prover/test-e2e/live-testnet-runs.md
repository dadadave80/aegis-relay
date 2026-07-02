# Live testnet run log — final deployment

Registry `CC4HXXHUE6ZCIVVN4XAHPV4JMYHEWK7ZIKILQMG5WCJ4V67NWLFTVGCA`, 2026-07-02.
All commands per docs/demo-script.md crib sheet (network `proxied` = local
forward proxy around a flaky system resolver; identical bytes on the wire).

## Shipment 1 — CONFIDENTIAL COURIER (CT-A rail)

See `confidential-e2e.md` for the full record: 50 XLM escrowed with the amount
hidden (Pedersen commitment on the hooked OZ token), premature settle rejected
`Error(Contract, #4302)`, withdraw-to-public rejected `#4301`, Groth16 A1
deliver tx `e531caf6…`, hook-admitted settle tx `2d990d64…` (no amount on
explorer), auditor key 0 decrypted 500000000 units.

## Shipment 3 — TRANSPARENT DRONE (lane 7)

- `create` (25 XLM, method 3, lane 7, origin 6.4900/3.3500 → dest 6.5244/3.3792) → id 3
- `accept` (carrier commit `13415…5434`; head computed on-chain)
- `dronesim fly` (16 waypoints, live t_0, corridor lane 7) + `prove` (~3.7 s for
  the 70,565-constraint A2 circuit) + `submit --id 3` → **flight_ok = true**
  (corridor root read from the airspace contract per I1, BN254 pairing check on-chain)
- `sign-pod` + `prove-delivery` + `deliver` → state DELIVERED, paid 250000000

## Shipment 4 — LIVE ATTACK REJECTIONS (drone, kept IN_TRANSIT deliberately)

1. **Replay** of shipment 3's flight proof → `Error(Contract, #4)`
   TsBeforeAccept — the T7 freshness layer (`t_0 ≥ accept_ts`) fires before
   the proof is even checked.
2. **Bit-flipped proof** (pi_a off-curve) → `Error(Crypto, InvalidInput)` —
   host point-deserialization rejects.
3. **Valid-points-wrong-proof** (pi_a ↔ pi_c swapped on an otherwise honest,
   fresh flight) → `Error(Contract, #1)` **BadProof** — the pairing check
   itself fails.

Witness-level attack rejections (stray/teleport/gap/nonmono/splice/heavy/
altitude/foreign-key) are covered by `prover/test-e2e/dronesim-attacks.test.mjs` —
those cannot even produce a proof.

Note on rejection artifacts: Soroban's mandatory preflight executes the full
host stack, so a failing invoke is rejected at simulation — no fee-charged
failed transaction lands on-chain. The captured diagnostics above are the
faithful artifact of each rejection.

## Archive

Shipment on the superseded first deployment: transparent COURIER lifecycle
(create → accept → PoD → deliver, 25 XLM) on registry `CA5LRPUB…ONIOD` —
see docs/testnet.md archive section.
