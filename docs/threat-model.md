# Threat Model

This document covers the `upto-session` contract and the example-only policy wallet. The custom
`test-token` exists only for local and testnet validation and is not a production asset.

## Assets and trust boundaries

- Buyers authorize session creation and cancellation for their own funds.
- Sellers authorize settlement and cannot settle more than the buyer's cap.
- The configured token contract is trusted to implement the expected transfer interface correctly.
- The `resource_hash` and `usage_hash` values are commitments only. The contract does not validate
  off-chain resource contents or metering calculations.
- RPC nodes, Horizon, indexers, backend services, and user interfaces are outside the on-chain trust
  boundary. Clients must verify finalized transaction results before presenting settlement as final.

## Authorization and replay

- `create_session` requires buyer authorization and binds buyer, seller, asset, cap, expiry, resource
  hash, and an incrementing sequence into the session ID.
- `settle` requires the stored seller's authorization and finalizes a session once.
- `cancel` requires the stored buyer's authorization and prevents later settlement.
- Repeated settlement and cancellation attempts fail against finalized state.

## Amount, expiry, and storage risks

- Caps and settlement amounts must be positive, and settlement cannot exceed the stored cap.
- Settlement at or after the expiry ledger is rejected.
- Contract storage TTL can outlive or expire independently of off-chain records. Operators must not
  treat a missing off-chain record as proof that an on-chain session is absent.
- TTL extension is limited to open sessions. The repository's tests cover missing, settled, and
  cancelled session rejection, but live boundary-ledger evidence is still required before release.

## Administration and upgrades

- `upto-session` stores an administrator during one-time initialization but currently exposes no
  contract upgrade entry point.
- Deployed instances are therefore operationally immutable through this interface. A code change
  requires a new deployment and explicit migration or reconfiguration by clients.
- The policy wallet owner can update its own spending policy. That authority does not grant access to
  another buyer's session or permit settlement by a different seller.

## Known limitations

- `upto` is a LumenBazaar extension and is not presented as an upstream-standard Stellar x402 scheme.
- Unit tests use Soroban's test environment and do not replace live testnet authorization evidence.
- The published deployment manifest proves upload, deployment, and initialization, not create,
  settle, cancel, expiry, or adversarial live transactions.
- Production use requires an independently reviewed token, a live transaction submission client,
  durable backend idempotency, and monitoring for failed or delayed finality.
