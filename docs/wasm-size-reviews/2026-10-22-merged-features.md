# Proposed budget refresh for merged features

## Reason

The previous WASM baseline (`a8ac359ae155a85b5d71f16d5476aa26d3310cd3`) predates merged
contract features. Validation repairs at `bd1f6fef1f7dfe9ff5970101f61876a5d02a899e` restore buildable source
without removing these features. This proposal records fresh measurements from
Rust 1.93.1, Soroban SDK 28.0.0, Stellar CLI 28.0.0 and Node 22.12.0.

`upto-session` grew with creation pause, seller exposure, buyer/seller session
counts, cap reduction, delayed cap increases, lifecycle reason commitments and
session ledger/scheme metadata (feature commits `45ae985`, `69c943d`, `7a752d7`,
`c5fa5c8`, `ac903e0`, `faf1de8`, `c92d32f`, `1695404`). The policy wallet gained
activation windows, seller/resource ceilings and authorization counts (`b00fa38`,
`0d34689`, `b7901a0`, `a32d83a`). New session fields and counters increase storage
writes/rent; reading these fields and extending their TTL increases native work.

| Contract | Old baseline bytes | New optimized bytes | New maximum | Headroom |
| --- | ---: | ---: | ---: | ---: |
| upto-session | 33977 | 52153 | 62583 | 20% |
| policy-wallet-example | 8742 | 15030 | 18036 | 20% |
| test-token | 3273 | 3273 | 4091 | 25% |

Fresh native measurements and their generated table are committed in
`artifacts/resource-usage/upto-session.json` and `.md`. The table below lists
every changed resource ceiling. Existing 25% headroom and zero-field invariants
are retained; some ceilings tighten when fresh observations are lower.

| Operation | Field | Old ceiling | Measured | Proposed ceiling |
| --- | --- | ---: | ---: | ---: |
| cancel | instructions | 704459 | 740343 | 925429 |
| cancel | mem_bytes | 116322 | 115938 | 144923 |
| cancel | memory_read_entries | 10 | 11 | 14 |
| cancel | write_entries | 7 | 8 | 10 |
| cancel | write_bytes | 1655 | 1940 | 2425 |
| cancel | persistent_rent_ledger_bytes | 10000000 | 12000000 | 15000000 |
| cancel | estimated_fee_stroops | 2873087 | 2349888 | 2937360 |
| create_session | instructions | 790230 | 812828 | 1016035 |
| create_session | mem_bytes | 143228 | 142036 | 177545 |
| create_session | memory_read_entries | 10 | 11 | 14 |
| create_session | write_entries | 8 | 9 | 12 |
| create_session | write_bytes | 2440 | 2668 | 3335 |
| create_session | persistent_rent_ledger_bytes | 1205152000 | 1576121600 | 1970152000 |
| create_session | persistent_entry_rent_bumps | 5 | 7 | 9 |
| create_session | estimated_fee_stroops | 14418917 | 17458461 | 21823077 |
| extend_ttl | instructions | 73960 | 117438 | 146798 |
| extend_ttl | mem_bytes | 11464 | 14793 | 18492 |
| extend_ttl | memory_read_entries | 4 | 6 | 8 |
| extend_ttl | estimated_fee_stroops | 53 | 83 | 104 |
| recover_expired | instructions | 681678 | 721086 | 901358 |
| recover_expired | mem_bytes | 111139 | 110955 | 138694 |
| recover_expired | memory_read_entries | 8 | 9 | 12 |
| recover_expired | write_entries | 5 | 7 | 9 |
| recover_expired | write_bytes | 1560 | 1864 | 2330 |
| recover_expired | persistent_rent_ledger_bytes | 4999750 | 7999600 | 9999500 |
| recover_expired | estimated_fee_stroops | 77362 | 113305 | 141632 |
| settle | instructions | 1046715 | 1012057 | 1265072 |
| settle | mem_bytes | 170047 | 161054 | 201318 |
| settle | memory_read_entries | 12 | 12 | 15 |
| settle | write_entries | 8 | 9 | 12 |
| settle | write_bytes | 1975 | 2200 | 2750 |
| settle | persistent_rent_ledger_bytes | 195152000 | 164121600 | 205152000 |
| settle | estimated_fee_stroops | 4671714 | 3827371 | 4784214 |

## Security impact

No authorization, arithmetic, escrow, lifecycle or compatibility check is
removed to reduce resource use. The default gates still fail on missing fields,
unbounded event topics, unexpected size increases or costs above these proposed
ceilings. No override flag is enabled in CI. Native estimates do not constitute
a live fee quote or production deployment approval.

## Approval

This is an automated proposal prepared at Mintworx's request to repair validation
for issues #144-#147. It is **not approved by a maintainer**. Review of the merged
feature costs and this baseline update is required before merging the PRs.
Passing checks against the proposed budgets must not be described as maintainer
approval or an independent security audit.
