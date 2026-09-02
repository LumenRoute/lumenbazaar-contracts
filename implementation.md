# LumenBazaar Contracts Implementation Plan

Source document: `../LUMENBAZAAR_FULL_PROJECT_DOCUMENTATION.md`

Repo role: Soroban contracts for capped metered x402 `upto` payment sessions, optional smart-wallet policy examples, test token utilities, generated bindings, deployment scripts, and contract security evidence.

Primary stack:

- Rust
- Soroban SDK
- Stellar CLI
- Cargo

Target layout:

```txt
contracts/
  upto-session/
  policy-wallet-example/
  test-token/
```

Implementation rules:

- Only put logic on-chain when the project needs on-chain enforcement.
- Keep exact x402 payments contract-free where Stellar/Soroban auth entries and Stellar Asset Contract support are sufficient.
- Build `upto-session` narrowly around capped metered settlement.
- Testnet comes before mainnet.
- Generate ABI/spec files and TypeScript bindings when applicable.
- Clearly mark the policy wallet as an example, not a production wallet.

## Phase 1: Repository Foundation

Parts:

- Scaffold the Rust workspace.
- Add Soroban SDK dependencies.
- Add `README.md`, `LICENSE`, `CONTRIBUTING.md`, `SECURITY.md`, PR template, issue template, and CI.
- Add rustfmt and clippy configuration.

Completion check:

- Fresh clone can run formatting, lint, and placeholder tests.

## Phase 2: Workspace Layout

Parts:

- Add `contracts/upto-session`.
- Add `contracts/policy-wallet-example`.
- Add `contracts/test-token`.
- Add shared test helpers if needed.

Completion check:

- Each contract package builds independently.

## Phase 3: Contract Interface Definition

Parts:

- Define public interface for `initialize`.
- Define public interface for `create_session`.
- Define public interface for `settle`.
- Define public interface for `cancel`.
- Define public interface for `get_session`.
- Define public interface for `extend_ttl`.

Completion check:

- The intended ABI is visible before implementation complexity is added.

## Phase 4: Storage Types

Parts:

- Define `Session`.
- Define `SessionStatus`.
- Define storage keys.
- Add storage layout versioning.
- Add typed wrappers for IDs and hashes where helpful.

Completion check:

- Session state can be serialized and retrieved in unit tests.

## Phase 5: Error Types

Parts:

- Add `AlreadyInitialized`.
- Add `Unauthorized`.
- Add `InvalidAmount`.
- Add `ExpiredSession`.
- Add `SessionNotFound`.
- Add `SessionAlreadySettled`.
- Add `SessionCancelled`.
- Add `AmountExceedsCap`.
- Add `InvalidAsset`.
- Add `InvalidSeller`.
- Add `TtlExtensionFailed`.

Completion check:

- Every documented error code exists and is stable.

## Phase 6: Initialization

Parts:

- Implement `initialize(admin: Address)`.
- Store admin once.
- Reject repeat initialization.
- Add initialization tests.

Completion check:

- Contract cannot be initialized twice.

## Phase 7: Session ID Strategy

Parts:

- Define deterministic session ID creation.
- Include buyer, seller, asset, max amount, expiry, resource hash, and nonce or equivalent uniqueness input.
- Prevent accidental collision.
- Document ID derivation.

Completion check:

- Tests prove two distinct sessions do not overwrite each other.

## Phase 8: Session Input Validation

Parts:

- Validate buyer address.
- Validate seller address.
- Validate asset address.
- Reject zero or negative `max_amount`.
- Reject already-expired sessions.
- Require resource hash.

Completion check:

- Invalid inputs fail before storage writes.

## Phase 9: Create Session Authorization

Parts:

- Require buyer authorization.
- Bind session to fixed seller.
- Bind session to fixed asset.
- Bind session to fixed resource hash.
- Store unsettled session status.

Completion check:

- Unauthorized callers cannot create sessions on behalf of buyers.

## Phase 10: Create Session Events

Parts:

- Emit session-created event.
- Include session ID.
- Include buyer, seller, asset, cap, expiry, and resource hash.
- Keep event shape stable.

Completion check:

- Indexers can observe session creation from events.

## Phase 11: Get Session

Parts:

- Implement `get_session(session_id: BytesN<32>) -> Session`.
- Return full session state.
- Return `SessionNotFound` for missing sessions.

Completion check:

- Backend bindings can retrieve session state by ID.

## Phase 12: Settlement Authorization

Parts:

- Implement `settle`.
- Require seller or authorized settlement actor according to final design.
- Reject wrong seller.
- Reject missing session.
- Reject cancelled or settled sessions.

Completion check:

- Only the intended recipient path can settle usage.

## Phase 13: Settlement Amount Validation

Parts:

- Reject zero or negative actual amount.
- Reject actual amount above cap.
- Reject settlement after expiry.
- Store actual settled amount.

Completion check:

- Over-cap and expired settlement attempts fail deterministically.

## Phase 14: Asset Transfer

Parts:

- Integrate with Stellar Asset Contract transfer behavior.
- Transfer `actual_amount` from buyer to seller.
- Ensure the asset matches the session asset.
- Surface asset transfer failures.

Completion check:

- Valid settlement transfers the configured asset only.

## Phase 15: Usage Receipt Hash

Parts:

- Require `usage_hash`.
- Store usage hash on settlement.
- Document hash inputs expected from backend usage receipts.

Completion check:

- A settled session includes verifiable usage evidence hash.

## Phase 16: Single Settlement Guarantee

Parts:

- Set session status to settled atomically.
- Reject repeat settlement.
- Add double-settlement tests.

Completion check:

- A session cannot be settled twice even with repeated calls.

## Phase 17: Settlement Events

Parts:

- Emit session-settled event.
- Include session ID.
- Include actual amount.
- Include usage hash.
- Include seller and asset.

Completion check:

- Backend can index settlement events for receipts.

## Phase 18: Cancellation

Parts:

- Implement `cancel(session_id)`.
- Allow buyer cancellation before settlement.
- Reject cancellation after settlement.
- Reject cancellation for missing sessions.

Completion check:

- Buyer can close unused authorization safely.

## Phase 19: Cancellation Events

Parts:

- Emit session-cancelled event.
- Include session ID and buyer.
- Keep event schema stable.

Completion check:

- Backend and docs can track cancellation lifecycle.

## Phase 20: TTL Strategy

Parts:

- Decide instance and persistent storage TTL rules.
- Implement safe TTL extension for active sessions.
- Reject extension for missing or finalized sessions where appropriate.
- Document resource usage implications.

Completion check:

- TTL behavior is tested and documented.

## Phase 21: Expiry Behavior

Parts:

- Reject settlement after `expires_at_ledger`.
- Define whether expired sessions can be cancelled or only observed.
- Add expiry tests.

Completion check:

- Expired sessions cannot move funds.

## Phase 22: Test Token

Parts:

- Add `test-token` contract only if needed for local tests.
- Keep it separate from production session logic.
- Add mint and transfer helpers for tests.

Completion check:

- Contract tests can run without depending on external token state.

## Phase 23: Core Contract Tests

Parts:

- Test valid session creation.
- Test unauthorized session creation.
- Test invalid cap rejection.
- Test valid settlement.
- Test wrong seller rejection.

Completion check:

- Core positive and negative paths pass in `cargo test`.

## Phase 24: Safety Tests

Parts:

- Test over-cap rejection.
- Test double-settlement rejection.
- Test expired settlement rejection.
- Test cancellation before settlement.
- Test cancellation after settlement rejection.

Completion check:

- The documented contract guarantees have regression tests.

## Phase 25: Storage And Event Tests

Parts:

- Test session persistence.
- Test storage layout version.
- Test TTL extension.
- Test emitted event payloads.
- Test `get_session` responses.

Completion check:

- Backend and indexer assumptions are stable.

## Phase 26: Policy Wallet Example Foundation

Parts:

- Scaffold `policy-wallet-example`.
- Add clear documentation banner that it is not production wallet code.
- Implement minimal smart account example shape.
- Add tests that prove it is isolated from `upto-session`.

Completion check:

- Example compiles and cannot be mistaken for required production infrastructure.

## Phase 27: Policy Wallet Spending Rules

Parts:

- Add max amount per payment.
- Add max amount per day.
- Add allowed sellers.
- Add allowed assets.
- Add allowed resource hashes.
- Add expiration window checks.

Completion check:

- Agent spending policies are demonstrable in tests.

## Phase 28: Policy Wallet Documentation Tests

Parts:

- Add examples for allowed payment.
- Add examples for blocked payment.
- Add examples for expired policy.
- Add examples for wrong seller and wrong asset.

Completion check:

- Docs can reference working policy examples.

## Phase 29: ABI And Spec Generation

Parts:

- Generate contract ABI/spec files.
- Commit generated artifacts if that is the chosen repo policy.
- Add CI check to keep generated artifacts current.

Completion check:

- Backend can consume stable generated contract interfaces.

## Phase 30: TypeScript Bindings

Parts:

- Generate TypeScript bindings for `upto-session`.
- Add package output or artifact folder.
- Add binding smoke test.

Completion check:

- Backend integration can call contract methods through generated bindings.

## Phase 31: Local Deployment Scripts

Parts:

- Add local network deployment script.
- Add test token deployment script if used.
- Add initialize script.
- Add sample create, settle, cancel, and inspect commands.

Completion check:

- A developer can deploy and exercise the contract locally.

## Phase 32: Testnet Deployment Scripts

Parts:

- Add testnet deploy script.
- Add environment example for testnet.
- Add contract ID recording process.
- Add deployment verification command.

Completion check:

- Testnet deployment is reproducible and documented.

## Phase 33: Gas And Resource Usage

Parts:

- Record resource usage for create session.
- Record resource usage for settle.
- Record resource usage for cancel.
- Record resource usage for TTL extension.

Completion check:

- Docs include realistic gas/resource expectations.

## Phase 34: Backend Integration Handoff

Parts:

- Publish contract IDs.
- Publish generated bindings.
- Publish function and error reference.
- Provide example usage hashes.

Completion check:

- Backend `upto` implementation has everything needed to integrate safely.

## Phase 35: Security Checklist

Parts:

- Check authorization boundaries.
- Check cap enforcement.
- Check double-settlement prevention.
- Check expiry handling.
- Check asset and seller binding.
- Check event correctness.

Completion check:

- Audit readiness package can reference completed checklist items.

## Phase 36: Audit Readiness

Parts:

- Freeze public interface for review.
- Document known limitations.
- Document threat model.
- Document test coverage.
- Document deployment procedure.

Completion check:

- External reviewers can inspect contract behavior without reverse-engineering intent.

## Phase 37: Mainnet Readiness

Parts:

- Require completed tests.
- Require documented testnet deployment.
- Require reviewed generated bindings.
- Require operational sign-off.
- Require security review decision.

Completion check:

- Mainnet deployment has explicit gates and does not happen by accident.

## Phase 38: Maintenance

Parts:

- Track Soroban SDK updates.
- Regenerate bindings after interface changes.
- Keep storage version notes current.
- Add regression tests for every discovered bug.

Completion check:

- Contract repo remains safe, reproducible, and aligned with backend and docs.
