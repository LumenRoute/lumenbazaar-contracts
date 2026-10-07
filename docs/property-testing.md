# Contract Property Testing

`generated_sequences_preserve_value_caps_and_isolation` runs against the real
`upto-session` and Stellar asset contracts. Every case creates two sessions
with distinct buyers, sellers, and assets, then generates up to 23 actions from
this set:

| Code | Generated action |
| ---: | --- |
| 0 | Settle with zero, one, midpoint, exact-cap, or over-cap amount |
| 1 | Buyer cancellation |
| 2 | Advance to the exact expiry ledger |
| 3 | Permissionless expiry recovery |
| 4 | Valid settlement followed by an immediate replay |
| 5 | Settlement carrying only an attacker authorization |

After every action, the test compares contract state and all three token
balances with its state model. It asserts value conservation, cap enforcement,
terminal-state immutability, and isolation between both sessions and assets.

The CI/default campaign is 128 cases with fixed seed
`0x4c554d454e425a52`. Proptest shrinks a failure and prints the smallest
reproducing input. The fixed seed makes the generated sequence reproducible.

Run the CI campaign:

```bash
cargo test -p upto-session generated_sequences_preserve_value_caps_and_isolation -- --nocapture --test-threads=1
```

Run an expanded campaign before deployment:

```bash
LUMENBAZAAR_PROPERTY_CASES=512 cargo test -p upto-session generated_sequences_preserve_value_caps_and_isolation -- --nocapture --test-threads=1
```

On PowerShell, set the override for the command process:

```powershell
$env:LUMENBAZAAR_PROPERTY_CASES = "512"
cargo test -p upto-session generated_sequences_preserve_value_caps_and_isolation -- --nocapture --test-threads=1
Remove-Item Env:LUMENBAZAAR_PROPERTY_CASES
```

The generated amount strategy always includes 1, 2, and 10,000,000 plus values
through 999,999. `maximum_value_session_conserves_escrow` separately executes a
full `i128::MAX` funding and settlement path, while `liability_arithmetic_is_checked`
covers aggregate overflow and zero underflow.
