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
