# CT-A confidential-escrow live e2e — testnet run record (2026-07-02)

Auditable run log for the rung-R3/CT-A lifecycle (DESIGN §6.6, PIVOT §3.3):
hook-caged per-shipment escrow on the Aegis fork of the OpenZeppelin
confidential token, driven by `prover/src/confidential.ts` (`@ctd/sdk`,
UltraHonk/Grumpkin — consumed as a black box, guardrail 10) against the final
deployment below. Every step ran live on testnet through the local RPC
forward proxy (`--network proxied` / `http://127.0.0.1:8971`).

## Deployment under test (`prover/scripts/deploy-all.mjs`, ledger 3398061)

| Contract | ID |
|---|---|
| aegis-registry | `CC4HXXHUE6ZCIVVN4XAHPV4JMYHEWK7ZIKILQMG5WCJ4V67NWLFTVGCA` |
| aegis-credentials | `CBEDJCSBU3IKHW34HAZPL55CFJ5AZOTBJUGFXR5TS5JMRJN7W37K4FQF` |
| aegis-airspace | `CCOEGSF3BSLXYKZMMX2OCSOJONAGORRWSI33TIUX3EHPVVHNMVHNENOY` |
| CT verifier (6 VKs registered) | `CBSD5PB2C2M43JPLSP5OGMQUXCCKQ3BI2JOOKAMVGOFMWZ3WMLYR2J26` |
| CT auditor (Grumpkin key id 0) | `CCORKIVLRHR3AIZB47VNVAHHIMNJ6QPEMDQYJQLJWOTSTXGJSO53GPP4` |
| aegis-ct-token (AegisEscrowHooks) | `CAIRUFAAIRRPIEKR7Q56JSI5B6PX3GMISCRHHQNAWFCFHIOD7W3XYHDC` |
| underlying (native XLM SAC) | `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC` |

`addr_f` parity (SDK Poseidon2 ↔ contract):
`0x1fae60f85958b6eb6cf62650cd59ad24e626058277f9883042ae4d26f1d106f0` — OK.
`registry.set_ct_token(token)` executed (mutual pin, T25). Corridor lane 7
approved (window 1783005174..1785597234); credential root epoch 1 = PAD.

## a. `setup-merchant --amount 3_000_000_000` — 300 XLM public float

```
merchant: registered (auditor 0, tx 9e263fa840b97226cbb10b32929312af02422593c8d41bd9dc4f1cdc14f85165)
NOTE: this deposit of 3000000000 units is PUBLIC on-chain — it is the merchant's
aggregate float across shipments, not a per-shipment figure (DESIGN §6.6 residual leak).
deposit  tx 451a8e8a8c8e9acb2e182c14357469b71f982b67d481368e8d806085931482a8
merge    tx 873ff5103a04c32cfedb01806d75f69687eeeec24a1e640acec36406f074aa22
merchant spendable = 3000000000 units (state matches chain: true)
```

## b. `fund-escrow --id-hint ct-a --amount 500_000_000` — 50 XLM, amount HIDDEN

```
escrow E = GD4IFDV6L7XH5EBYQZ5DNY6BVRXNJF2AD3GZ56VSZ6QSFJX4BU4UZBP5
escrow E: registered (auditor 0, tx cddfba5fc79ece2157d1a6e05903fd7c65c76b416add0c5975df5a1d975674ee)
confidential_transfer merchant→E: tx 5bb126b76b24ee1c09dae2bef5ec3ab9e6402c9f3190dabc4ad853c6905263e2  (amount hidden on-chain)
merge E: tx 635cfdfc20b35ed6a048a5780c35b593f7693c6c67fd9d1ac5e06a5e4b7c068c
merchant spendable now 2500000000 units (opening reconciled from chain)
```

E's Stellar secret, Grumpkin keys, and the transfer opening `(v, r)` persisted
to `prover/out/ships/ct-a/escrow.json` (gitignored — T26: openings must
outlive the RPC's ~7-day event retention). Only E's address was printed.

## c. `create-shipment` — confidential rail, amount 0 on the registry

```
create_shipment --amount 0 --milestones [10000] --escrow_deadline 1783123200
                --method 1 (Courier) --rail 1 (Confidential)
                --escrow "GD4IFDV6...UZBP5" --token CAIRUFAA...XYHDC
shipment id = 1   tx ff240af6cb1855056d1bd8d4ce7141b700dbdbae3dc668034a3c7ec004b6e294 (ledger 3398132)
C_S = 649092956804392830482617543001796172036359795011301848306466425041448257629
escrow_of(GD4IFDV6…) = 1
```

The registry never learns the amount: `amount = 0`, funds live solely as a
Pedersen commitment on the CT token.

## d. `verify-escrow` — carrier-side packet-verify extended to funds (T12/T25)

```
token pin (T25)  : OK (CAIRUFAAIRRPIEKR7Q56JSI5B6PX3GMISCRHHQNAWFCFHIOD7W3XYHDC)
opening commit   : matches on-chain spendable
packet keys      : match registered account keys
VERDICT: MATCH — escrow balance = 500000000 units (visible to packet holders only)
```

## e. carrier `accept` (existing carrier.ts, payout = relay-carrier)

```
carrier_pk_commit = 13415324523707609707744631672777219342559815101648031148935797981489351165434
accept --id 1 → OK   tx 06170f72253ec9e1c50224929f5b93893f7abe2c1342e9f30036cdd095072320 (ledger 3398139)
```

## f. NEGATIVE — `settle` BEFORE deliver → hook rejects with #4302 (T23)

`settle --id 1 --escrow out/ships/ct-a/escrow.json --payout GBAMBJG3…C2NQ`
(the payout account registered first:
tx `3acad773dd0a2b4b6a1c26921b98aef73a971d1413503a857bfd59acafefc26f`), then
the E→payout transfer was proved and submitted — and the hooked token aborted
it:

```
simulate confidential_transfer failed: HostError: Error(Contract, #4302)

Event log (newest first):
  0: contract:CAIRUFAA…(token), topics:[error, Error(Contract, #4302)],
     data:"escalating error to VM trap from failed host function call: fail_with_error"
  1: contract:CAIRUFAA…(token), topics:[error, Error(Contract, #4302)],
     data:["failing with contract error", 4302]
  2: contract:CC4HXXHU…(registry), topics:[fn_return, release_allowed], data:false
  3: contract:CAIRUFAA…(token), topics:[fn_call, CC4HXXHU…, release_allowed],
     data:[1, GBAMBJG3UA4GMWJDY7QT2NOPKVK3AFMLNVDGJPXO73J5UUL6P6AVC2NQ]
  4: contract:CC4HXXHU…(registry), topics:[fn_return, escrow_of], data:1
  5: contract:CAIRUFAA…(token), topics:[fn_call, CC4HXXHU…, escrow_of],
     data:GD4IFDV6L7XH5EBYQZ5DNY6BVRXNJF2AD3GZ56VSZ6QSFJX4BU4UZBP5
```

The trace is the design executing verbatim: `on_transfer` cross-calls
`escrow_of(E) → Some(1)`, then `release_allowed(1, payout) → false` (state
still IN_TRANSIT), and the hook panics with `EscrowReleaseNotAllowed = 4302`.
Honest note: the rejection surfaces at Soroban's mandatory RPC preflight
(simulation executes the full host call stack, including the hook), so the
doomed transaction is never fee-charged on-chain — the CLI records the full
diagnostic trace above as the rejection artifact. Exit code: 1 (settle
command failed, as required).

## f2. NEGATIVE — `withdraw-probe`: escrow exit to the public rail → #4301 (T24)

```
withdraw-probe: attempting withdraw of 500000000 units from escrow E to the PUBLIC rail…
withdraw REJECTED as required: simulate withdraw failed: HostError: Error(Contract, #4301)

Event log (newest first):
  0: contract:CAIRUFAA…(token), topics:[error, Error(Contract, #4301)], data:"escalating error…"
  1: contract:CAIRUFAA…(token), topics:[error, Error(Contract, #4301)],
     data:["failing with contract error", 4301]
  2: contract:CC4HXXHU…(registry), topics:[fn_return, escrow_of], data:1
  3: contract:CAIRUFAA…(token), topics:[fn_call, CC4HXXHU…, escrow_of],
     data:GD4IFDV6L7XH5EBYQZ5DNY6BVRXNJF2AD3GZ56VSZ6QSFJX4BU4UZBP5
```

`on_withdraw` panics unconditionally for registry-mapped escrows
(`EscrowWithdrawBlocked = 4301`): key possession is proof-generation
capability, never spending authority (guardrail 11).

## g. PoD + Groth16 A1 + `deliver` (existing recipient.ts / carrier.ts)

```
sign-pod    → Signed PoD for shipment 1 at cell 12920082684 (ts 1783005626)
prove-delivery → snarkjs groth16 fullProve, proof/public written (ts window 600 s respected)
deliver --id 1 → OK  tx e531caf6f59e417548830204e5985a445c0a50755fa4154caa673bc37fa77fcd (ledger 3398220)
```

On-chain BN254 pairing check passed against storage-derived publics
(`[shipment_id, C_S, head, nullifier, ts]` — I1); nullifier
`1617529691519694420864534573227741954455007131065684709673212894738353624826`
spent; state → DELIVERED. No funds moved in this tx (`amount == 0` on the
confidential rail — verify-then-settle, §6.6).

## h. `settle` AFTER deliver → hook admits (the second tx of verify-then-settle)

```
settle shipment #1: confidential_transfer E → GBAMBJG3…C2NQ (amount hidden)
SETTLED: tx 2d990d64577a95af182aec1e1032a9f96c9cf965ad7714ac9cc8e737b93f9aa3 (ledger 3398224)
payout receiving balance = 500000000 units (re-commits to chain: true)
```

Same command as step f — the only difference is registry state
(`release_allowed(1, payout)` now true). The explorer shows this settlement
with NO amount; the payout's balance was confirmed by decrypting with the
carrier's own viewing keys and re-committing against the on-chain point.

## i. `audit --tx 2d990d64…` — the regulator beat

```
=== REGULATOR AUDIT (auditor key 0 decrypts the on-chain ciphertexts) ===
transfer tx      : 2d990d64577a95af182aec1e1032a9f96c9cf965ad7714ac9cc8e737b93f9aa3 (ledger 3398224)
from             : GD4IFDV6L7XH5EBYQZ5DNY6BVRXNJF2AD3GZ56VSZ6QSFJX4BU4UZBP5
to               : GBAMBJG3UA4GMWJDY7QT2NOPKVK3AFMLNVDGJPXO73J5UUL6P6AVC2NQ
amount           : 500000000 units  (50 XLM)
sender balance   : 0 units (post-transfer)
channels agree   : true (sender + recipient ciphertexts decrypt to the same amount)
private to the world, transparent to the regulator.
```

## Final on-chain state (registry `status --id 1`)

```json
{"state": 2 (DELIVERED), "rail": 1 (Confidential), "amount": "0", "paid": "0",
 "c_s": "6490929568…257629", "escrow_deadline": 1783123200,
 "payout": "GBAMBJG3…C2NQ", "token": "CAIRUFAA…XYHDC", "milestones": [10000]}
```

`paid` stays 0 forever — the registry never knew the amount. The 50 XLM moved
only as Pedersen commitments; the one plaintext copies live in the packet
(`escrow.json`) and behind the regulator's auditor key.

## Result

Full CT-A lifecycle green on testnet: fund → create → verify-escrow(MATCH) →
accept → **premature settle REJECTED #4302** → **withdraw REJECTED #4301** →
Groth16 deliver → settle admitted → payout confirmed (500000000) →
auditor decrypt (50 XLM). G4 banked.
