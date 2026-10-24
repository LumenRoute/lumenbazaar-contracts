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

## Revocation

`revoke_policy(agent)` requires the owner's signature. It removes the agent's policy, records the revocation ledger, and publishes `AgentPolicyRevoked`. From then on `get_policy`, `check_payment`, and `authorize_payment` for that agent return `PolicyRevoked` (14). `get_policy_revocation(agent)` returns the revocation ledger, or `None` when the agent is not revoked.

- Revoking an agent that never had a policy returns `PolicyNotFound` and records nothing.
- Revoking an already revoked agent returns `PolicyRevoked`, keeps the original ledger, and emits nothing.
- Other agents' policies and every agent's recorded daily spend are unaffected. A later `set_policy` for the agent is an explicit re-grant that clears the revocation; spend recorded earlier the same ledger-day still counts toward the daily cap.

Revocation in this example is not a production custody control; see the warning above.

## Owner Rotation

The contract provides an expiring two-step owner rotation modeled independently from `upto-session` administration:

- `propose_owner(pending_owner, expires_at_ledger)`: The current owner proposes a replacement owner before a specified ledger expiry. Self-targeted proposals or proposals overwriting an active proposal fail.
- `accept_owner()`: The pending owner accepts the proposal before `expires_at_ledger`. Expired proposals, missing proposals, and unauthorized calls fail. Upon acceptance, the owner updates atomically, the proposal is cleared, and existing spending policies and daily counters survive intact.
- `cancel_owner_rotation()`: The current owner cancels an active proposal.
- `get_owner_rotation()`: Queries the active proposal, if one exists.
- `get_owner()`: Queries the current owner address.

See [docs/policy-examples.md](docs/policy-examples.md) for the executable examples mirrored by the test suite.
