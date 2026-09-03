# Upto Session Contract

`upto-session` enforces capped metered payment sessions for LumenBazaar x402
`upto` flows.

## Session ID Derivation

Session IDs are deterministic SHA-256 digests of the XDR encoding of:

- buyer
- seller
- asset
- max amount
- expiry ledger
- resource hash
- contract-local monotonic sequence

The sequence is stored in instance storage and increments before each new
session ID is returned. This prevents identical resource requests from
overwriting an existing session while keeping the derivation reproducible from
stored inputs and sequence evidence.

## Events

### `SessionCreated`

Topics:

- `session_id`

Data:

- `buyer`
- `seller`
- `asset`
- `max_amount`
- `expires_at_ledger`
- `resource_hash`

## Usage Hash

`settle` requires a non-zero `usage_hash`. The backend should derive this hash
from a canonical usage receipt that includes:

- session ID
- resource hash
- buyer
- seller
- asset
- measured usage unit
- measured usage quantity
- settled amount
- request hash
- response hash, when available
- metering start and end ledger or timestamp

The contract stores only the digest. The backend remains responsible for
retaining and serving the canonical receipt body.
