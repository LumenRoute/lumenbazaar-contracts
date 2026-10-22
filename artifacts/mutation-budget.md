# Mutation Testing Budget

**Issue:** #17 – Add mutation tests for authorization and cap checks  
**Contracts in scope:** `upto-session`, `policy-wallet-example`

---

## Purpose

This document records the mutation testing scope, the reviewed threshold for
surviving mutants, and the scheduled execution budget.  It is updated whenever
the threshold is revised or a previously-surviving mutant is justified.

---

## Mutation Targets

The following security-critical guards are the **only** targets for mutation.
All other code (validation helpers, events, storage, IDs, bindings, tests) is
excluded via `.cargo-mutants.toml`.

### `upto-session`

| # | File | Guard | Mutant type | Killing test(s) |
|---|------|-------|-------------|-----------------|
| A | `lib.rs` | `buyer.require_auth()` in `create_session` | Remove auth call | `mutation_buyer_auth_removal_in_create_session_is_caught`, `mutation_buyer_auth_wrong_party_in_create_session_is_caught`, `create_session_requires_buyer_auth` |
| B | `lib.rs` | `session.seller.require_auth()` in `settle` | Remove auth call | `mutation_seller_auth_removal_in_settle_is_caught`, `mutation_seller_auth_wrong_party_in_settle_is_caught`, `settle_requires_seller_auth`, `settle_rejects_wrong_seller_auth` |
| C | `lib.rs` | `session.buyer.require_auth()` in `cancel` | Remove auth call | `mutation_buyer_auth_removal_in_cancel_is_caught`, `mutation_buyer_auth_seller_cannot_cancel_session`, `cancel_requires_buyer_auth` |
| D | `lib.rs` | `max_amount > asset_cap` in `create_session` | Invert / remove | `mutation_asset_cap_inversion_in_create_session_is_caught`, `mutation_asset_cap_exact_boundary_succeeds`, `per_asset_caps_enforce_boundaries_before_buyer_authorization` |
| E | `validation.rs` | `actual_amount > session.max_amount` in `validate_settlement_amount` | Invert / remove | `mutation_settlement_cap_inversion_is_caught`, `mutation_settlement_cap_exact_boundary_succeeds`, `settle_rejects_invalid_amounts_and_expiry` |
| F | `validation.rs` | `ledger >= expires_at_ledger` in `validate_settlement_amount` | Invert | `mutation_settle_expiry_check_inversion_is_caught`, `mutation_settle_expiry_check_before_boundary_succeeds`, `expiry_boundary_selects_exactly_one_terminal_path` |
| G | `lib.rs` | `ledger >= expires_at_ledger` in `cancel` | Invert | `mutation_cancel_expiry_check_inversion_is_caught`, `mutation_cancel_expiry_check_before_boundary_succeeds`, `expiry_boundary_selects_exactly_one_terminal_path` |
| H | `lib.rs` | `ledger < expires_at_ledger` in `recover_expired` | Invert | `mutation_recover_not_expired_check_inversion_is_caught`, `mutation_recover_at_expiry_boundary_succeeds`, `expiry_boundary_selects_exactly_one_terminal_path` |
| I | `lib.rs` | `match session.status` finalized guard in `settle` | Remove arm / invert | `mutation_finalized_guard_in_settle_rejects_*`, `settle_rejects_finalized_sessions`, `settle_prevents_double_settlement` |
| J | `lib.rs` | `match session.status` finalized guard in `cancel` | Remove arm / invert | `mutation_finalized_guard_in_cancel_rejects_*`, `cancel_rejects_already_settled_session` |
| K | `lib.rs` | `match session.status` finalized guard in `recover_expired` | Remove arm / invert | `mutation_finalized_guard_in_recover_rejects_*`, `expiry_recovery_rejects_missing_settled_and_cancelled_sessions` |

### `policy-wallet-example`

| # | File | Guard | Mutant type | Killing test(s) |
|---|------|-------|-------------|-----------------|
| L | `lib.rs` | `owner.require_auth()` in `initialize` | Remove auth call | `mutation_owner_auth_removal_in_initialize_is_caught`, `mutation_owner_auth_wrong_party_in_initialize_is_caught`, `initialize_requires_owner_auth` |
| M | `lib.rs` | `owner.require_auth()` via `require_owner_auth` in `set_policy` | Remove auth call | `mutation_owner_auth_removal_in_set_policy_is_caught`, `mutation_owner_auth_wrong_party_in_set_policy_is_caught` |
| N | `lib.rs` | `agent.require_auth()` in `authorize_payment` | Remove auth call | `mutation_agent_auth_removal_in_authorize_payment_is_caught`, `mutation_agent_auth_wrong_party_in_authorize_payment_is_caught` |
| O | `lib.rs` | `amount > policy.max_amount_per_payment` | Invert | `mutation_payment_cap_inversion_is_caught` |
| P | `lib.rs` | `next_spent > policy.max_amount_per_day` | Invert | `mutation_daily_cap_inversion_is_caught`, `mutation_daily_cap_exact_boundary_succeeds` |
| Q | `lib.rs` | `ledger > policy.valid_until_ledger` in `validate_payment` | Invert | `mutation_policy_expiry_check_inversion_is_caught`, `mutation_policy_expiry_check_at_boundary_succeeds` |
| R | `lib.rs` | Daily-spend storage write in `authorize_payment` | Remove write | `mutation_authorize_payment_must_record_daily_spend` |

---

## Reviewed Threshold

**Accepted surviving mutants: 0** for all targets A–R above.

Any surviving mutant in this set must either be:
1. Fixed by strengthening the corresponding test, **or**
2. Justified here with a written rationale and a reviewer sign-off before merge.

### Known justified survivors (none at this time)

_None._

---

## Execution Budget

Running `cargo mutants` against the two in-scope crates with
`--timeout-multiplier 3.0` and `--minimum-test-timeout 60` (configured in
`.cargo-mutants.toml`):

| Metric | Value |
|--------|-------|
| Estimated mutant count (upto-session) | ~70 |
| Estimated mutant count (policy-wallet-example) | ~35 |
| Wall-clock time per mutant (CI, 4-core) | ~45–90 s |
| Total estimated CI time | ~2–4 h |
| Scheduled cadence | Per PR touching `contracts/*/src/lib.rs` or `contracts/*/src/validation.rs` |

The CI workflow (`ci.yml`) runs `cargo test --workspace --all-features` on
every PR.  A full `cargo mutants` run is gated as an optional step; it can be
triggered manually or on a nightly schedule to stay within CI cost constraints.

### Running locally

```sh
# Install cargo-mutants (one-time)
cargo install cargo-mutants

# Run against the security-critical files only (fastest)
cargo mutants \
  --file contracts/upto-session/src/lib.rs \
  --file contracts/upto-session/src/validation.rs \
  --file contracts/policy-wallet-example/src/lib.rs

# Or use the workspace config (all excluded files are respected)
cargo mutants
```

---

## Out of Scope

The following are explicitly excluded from mutation and do not count toward the
threshold:

- `bindings/` – generated TypeScript, not Rust production code  
- `contracts/*/src/test.rs`, `auth_test.rs`, `property_test.rs`, `receipt_test.rs`, `mutation_test.rs` – test-only code  
- `contracts/*/src/errors.rs`, `events.rs`, `ids.rs`, `storage.rs`, `types.rs` – infrastructure with no security branches  
- `formal/` – TLA+/Alloy models, not compiled into the contract  
- `scripts/` – Node.js tooling  
