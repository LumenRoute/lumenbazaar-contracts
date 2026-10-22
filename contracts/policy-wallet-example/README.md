# Policy Wallet Example

This package is example code only. It is not production wallet infrastructure, is not audited, and should not custody funds without a full wallet security design.

The contract demonstrates the shape of a policy-controlled smart account for LumenBazaar agents:

- Stores an owner address that authorizes wallet administration.
- Stores the target `upto-session` contract address used by the surrounding application.
- Exposes `require_owner` as the minimal owner gate used by later spending-policy examples.
- Keeps all state in this contract instance so it remains isolated from `upto-session`.

Spending policies are keyed by agent address and can restrict:

- Maximum amount per payment.
- Maximum total amount per ledger-day bucket.
- Maximum number of successful authorizations per ledger-day bucket (`max_authorizations_per_day`).
- Allowed sellers (with optional per-seller payment and daily ceilings).
- Allowed assets.
- Allowed resource hashes (with optional per-resource payment and daily ceilings).
- Validity window by ledger sequence (`valid_from_ledger` to `valid_until_ledger`, inclusive).

`check_payment` validates a proposed payment without mutating state. `authorize_payment` requires the agent signature and records the amount against the current ledger-day bucket.

See [docs/policy-examples.md](docs/policy-examples.md) for the executable examples mirrored by the test suite.
