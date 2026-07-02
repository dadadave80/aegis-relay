# Demo video script — Aegis Relay (target 2:40, hard cap 3:00)

Record at 1080p+. Terminal: large font, dark theme. Browser: dashboard + stellar.expert tabs pre-opened. Every on-chain claim gets an explorer shot.

## Shot list

**0:00–0:15 — Problem.** Dashboard `/` hero on screen. VO: "Every shipment today leaks its manifest: what's inside, what it's worth, who's receiving it, and the exact route it travels. Aegis Relay settles deliveries on Stellar while the chain learns none of that."

**0:15–0:40 — Create + fund.** Terminal: `merchant.ts create …`. Cut to stellar.expert on the create tx. VO: "The merchant escrows payment against a single Poseidon commitment. The chain sees this opaque field element — and on the confidential rail, not even the escrow amount."

**0:40–0:55 — Carrier accept.** Terminal: `carrier.ts verify-packet` (VERDICT: OK line) then `accept`. Dashboard `/track/[id]` timeline advances to IN TRANSIT; camera lingers on the "what the chain sees vs never learns" panel. VO: "The carrier verifies the sealed packet against the on-chain commitment before accepting — and on the confidential rail, verifies the hidden escrow balance too. Custody is now bound to a key commitment the chain can't link to anyone."

**0:55–1:20 — Drone flight.** Terminal: `dronesim.ts fly … && dronesim.ts prove` (the SIMULATED-secure-element banner must be visible). Dashboard `/map`: public corridor grid + watermarked true route. VO: "A drone flies the regulator-approved lane. Sixteen signed telemetry points become one Groth16 proof: inside the corridor, no gaps, no teleports, under the altitude and speed caps — without publishing a single coordinate."

**1:20–1:35 — submit_flight on-chain.** Terminal: `dronesim.ts submit` → explorer tx. Dashboard timeline shows FLIGHT VERIFIED. VO: "The contract reads the corridor root from the regulator's own store and verifies the proof with Stellar's native BN254 pairing check."

**1:35–1:50 — Delivery + settlement.** Terminal: `recipient.ts sign-pod` then `carrier.ts prove-delivery && deliver` → explorer: escrow transfer to payout. VO: "The recipient's signature — bound to this carrier, this place, this moment — becomes the delivery proof. Verify and settle, one atomic transaction. On the confidential rail the settlement lands with no amount on the explorer."

**1:50–2:05 — Auditor beat (CT).** Auditor decrypt output next to the amount-less explorer tx. VO: "Private to the world — transparent to the regulator. Every confidential transfer carries auditor ciphertexts only the designated regulator key can open."

**2:05–2:25 — The kicker: attacks fail.** Terminal: `dronesim.ts fly --attack stray` → "REJECTED AT WITNESS GENERATION"; then the hook-blocked premature settle (transfer from escrow before DELIVERED → contract panic on explorer). VO: "A drone that strays one cell off-corridor cannot even produce a proof. And escrow keys grant zero spending authority — the token's hooks ask the registry's state machine first."

**2:25–2:40 — Honest limitations + close.** README Honest Limitations section on screen. VO: "The proof trusts the drone's key, not physics — secure-element attestation is the roadmap. The confidential rail is an unaudited OpenZeppelin preview. Dev ceremony, single contributor. It's all in the README — along with everything that already works on testnet today." End card: repo URL + registry contract ID.

## Command crib sheet (final deployment IDs — fill after redeploy)

```bash
export AEGIS_REGISTRY_ID=…  AEGIS_AIRSPACE_ID=…  AEGIS_NETWORK=testnet
cd prover
node --import tsx/esm src/merchant.ts create --to-lat 6.5244 --to-lon 3.3792 --amount 250000000 --deadline-hours 24 --method drone --lane 7
node --import tsx/esm src/carrier.ts verify-packet --packet out/ships/N/packet.json --id N
node --import tsx/esm src/carrier.ts accept --packet out/ships/N/packet.json --payout $(stellar keys address relay-carrier)
node --import tsx/esm src/dronesim.ts fly …  && … prove && … submit --id N
node --import tsx/esm src/recipient.ts sign-pod --packet … --id N --carrier-commit … --lat 6.5244 --lon 3.3792
node --import tsx/esm src/carrier.ts prove-delivery --packet … --id N --pod out/ships/N/pod.json
node --import tsx/esm src/carrier.ts deliver --id N        # within 600 s of sign-pod
node --import tsx/esm src/dronesim.ts fly --attack stray … # the rejection beat
```
