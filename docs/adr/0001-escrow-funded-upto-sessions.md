# ADR 0001: Escrow-Funded Upto Sessions

<!-- markdownlint-disable MD013 -->

- Status: Accepted
- Date: 2026-10-07
- Owners: LumenBazaar contracts maintainers
- Decision scope: `upto-session` funding, authorization, settlement, and recovery
- Supersedes: the unfunded session behavior in release `0.1.0`

## Context

The audited `upto-session` contract records a buyer-authorized cap at session
creation. Settlement later requires the seller and calls the token contract to
transfer funds from the buyer. A normal Stellar account has not authorized that
later token transfer merely because it authorized session creation. Tests that
globally mock authorization hide this gap.

The product requirement is a single deferred settlement that:

- works for a normal Stellar account;
- lets the seller settle without a second buyer signature;
- cannot move more than the cap;
- isolates funds between sessions and assets;
- returns unused funds on settlement, cancellation, or expiry;
- leaves no administrator withdrawal path; and
- can be proven with exact authorization trees and live testnet transactions.

Soroban authorization covers an address and its authorized invocation tree.
Calling `require_auth` at creation does not create a reusable authorization for
an unrelated future transaction. A contract is, however, considered to
authorize direct sub-contract calls that it invokes. This lets an escrow
contract transfer tokens held at its own address without a custom account.

## Options Considered

| Model | Seller-only settlement | Normal account support | Session isolation | Recovery risk | Decision |
| --- | --- | --- | --- | --- | --- |
| Escrow the full cap at creation | Yes | Yes | Strong when liabilities are recorded per session | Requires TTL and refund handling | Selected |
| Token allowance plus `transfer_from` | Yes while allowance remains valid | Depends on token allowance support | Shared allowances are easy to mis-scope | Buyer can revoke; expiry and residual allowance require coordination | Rejected |
| Custom-account `__check_auth` policy | Yes | No; buyer must use a contract account | Can be strong | Custom account and policy become critical custody code | Rejected for this version |
| Buyer co-signs settlement | No | Yes | Strong | No locked funds, but buyer can withhold the required signature | Rejected because it changes the product promise |

### Why escrow is selected

Escrow turns the cap from an off-chain promise into an on-chain liability. The
buyer authorizes the exact token transfer while creating the session. Later,
the contract pays from its own balance, so settlement does not depend on a
reusable buyer authorization, an allowance that can be revoked, or custom
account code.

The cost is deliberate: the buyer locks the full cap for the session lifetime.
The UI and backend must show that amount and expiry before signing. Short,
bounded expiries and permissionless expiry recovery limit the lock duration.

The first implementation limits expiry to 518,400 ledgers after creation and
reserves a further 241,920-ledger recovery window. Those values correspond to
approximately 30 and 14 days at the project's 17,280-ledger-per-day planning
assumption; ledger sequence, not wall-clock time, remains authoritative.

## Decision

Version 2 of `upto-session` will escrow `max_amount` at creation. It remains a
single-settlement state machine.

### Supported assets

Initialization records an immutable allowlist of reviewed SEP-41 token contract
addresses for that deployment. Session creation rejects any other asset. The
administrator cannot add an asset or withdraw escrowed funds after
initialization. Supporting another asset requires a reviewed new deployment.

This does not make a malicious token safe. Release evidence must identify each
allowed token and why it is trusted. Testnet LBT remains test-only and must not
be described as USDC.

### Creation

`create_session` will:

1. Validate buyer, seller, allowed asset, positive cap, future expiry, and
   non-zero resource hash.
2. Require the buyer to authorize the complete creation invocation.
3. Derive a unique session ID.
4. Transfer exactly `max_amount` from the buyer to the current contract.
5. Store an open session with `escrowed_amount = max_amount`.
6. Increase the aggregate liability for the asset by `max_amount`.
7. Set session and liability storage TTL beyond the expiry and recovery window.
8. Emit a versioned funded-session event.

The token transfer, liability update, session write, and event are one atomic
contract invocation. Any failure rolls back all of them, including the session
sequence change.

### Settlement

Before `expires_at_ledger`, the stored seller may settle once for an
`actual_amount` where `0 < actual_amount <= max_amount`.

Settlement will:

1. Load an open, funded session.
2. Validate seller, asset, amount, expiry, and non-zero usage hash.
3. Require the stored seller's authorization.
4. Mark the session settled and reduce the asset liability by `max_amount`.
5. Transfer `actual_amount` from the contract to the seller.
6. Transfer `max_amount - actual_amount` from the contract to the buyer when the
   remainder is non-zero.
7. Set `escrowed_amount` to zero and emit a versioned settlement event that
   records the paid and refunded amounts.

Both token transfers and the state transition are atomic. A failed transfer
must not leave a paid-but-open or settled-but-unpaid session.

### Cancellation

Before expiry, the buyer may cancel an open session. Cancellation requires the
stored buyer, reduces the liability by the full cap, refunds the full cap to the
buyer, sets `escrowed_amount` to zero, and marks the session cancelled.

Buyer cancellation and seller settlement can race. The first finalized
transaction wins and the other receives a deterministic terminal-state error.
Sellers must not deliver irreversible off-chain value before the settlement
transaction is accepted for the intended usage.

### Expiry recovery invocation

At or after `expires_at_ledger`, settlement and pre-expiry cancellation are
rejected. Any caller may invoke `recover_expired`; no caller authorization is
needed because funds can only return to the stored buyer.

Expiry recovery reduces the liability by the full cap, refunds the full cap to
the buyer, sets `escrowed_amount` to zero, and marks the session expired. The
caller cannot choose a recipient or amount.

The session and its per-asset liability record must remain restorable until
recovery completes. Every relevant invocation extends their TTL together.
Release tooling must monitor open sessions, recover them promptly at expiry,
and document how to restore archived persistent entries before calling
`recover_expired`. Storage expiry must never be interpreted as debt discharge.

The boundary is intentionally exact:

- ledger `expires_at_ledger - 1`: settlement or buyer cancellation may succeed;
- ledger `expires_at_ledger`: only expiry recovery may succeed; and
- later ledgers: only expiry recovery may succeed until the session is final.

### Administration

The deployment administrator authorizes initialization only. It has no method
to settle, cancel, recover early, change a session, change the allowlist, or
withdraw tokens. Accidental tokens sent directly to the contract are not
liabilities and are not recoverable through the session interface.

## Authorization Model

### Initialization

```text
admin
`-- upto_session.initialize(admin, supported_assets)
```

### Creation and funding

```text
buyer
`-- upto_session.create_session(buyer, seller, asset, cap, expiry, resource_hash)
    `-- asset.transfer(buyer, upto_session, cap)
```

The buyer signs this complete tree in the creation transaction. There is no
stored or reusable signature.

### Seller-only settlement

```text
seller
`-- upto_session.settle(session_id, actual_amount, usage_hash)
```

The two direct token calls use the current contract as their source. Soroban
treats direct calls by the invoker contract as authorized. No buyer
authorization is requested during settlement.

### Buyer cancellation

```text
buyer
`-- upto_session.cancel(session_id)
```

### Expiry recovery

```text
transaction source or any caller
`-- upto_session.recover_expired(session_id)
```

There is no `require_auth` for the caller. The stored buyer is the only refund
recipient.

## Balance And Liability Invariants

For each supported asset `a`:

- `L(a)` is the sum of `escrowed_amount` for every open session using `a`.
- `B(a)` is the token balance of the `upto-session` contract for `a`.
- `L(a) >= 0` and `B(a) >= L(a)` must always hold.
- The session entry and the liability record that accounts for it share a
  recovery horizon and are never extended independently.
- An open session has `escrowed_amount == max_amount > 0`.
- A terminal session has `escrowed_amount == 0`.
- A session can reduce `L(a)` exactly once and only by its own `max_amount`.
- Funds associated with one asset or session cannot satisfy another session's
  liability.
- Unsolicited token transfers may make `B(a) > L(a)` but never authorize the
  contract to spend that excess through a session.

Expected balance changes for a cap `C` and settlement amount `A` are:

| Transition | Buyer | Seller | Contract | Liability |
| --- | ---: | ---: | ---: | ---: |
| Create | `-C` | `0` | `+C` | `+C` |
| Settle | `+(C-A)` | `+A` | `-C` | `-C` |
| Cancel | `+C` | `0` | `-C` | `-C` |
| Recover expired | `+C` | `0` | `-C` | `-C` |

Arithmetic uses checked operations. Overflow, underflow, a negative liability,
or `B(a) < L(a)` is a contract error and blocks the transition.

## Failure And Recovery Walkthrough

| Scenario | Required behavior |
| --- | --- |
| Insufficient buyer balance | Funding transfer fails atomically; no session or liability remains. |
| Unsupported asset | Creation fails before authorization or storage mutation. |
| Wrong creator | Buyer authorization fails; no funds move. |
| Revoked prior authorization | Irrelevant; creation needs current authorization and settlement spends escrow. |
| Wrong seller | Seller authorization fails; session remains funded and open. |
| Zero or over-cap settlement | Validation fails before token movement. |
| Settlement at expiry | Rejected; expiry recovery is available in the same ledger. |
| Partially used but not settled | Seller submits one aggregate settlement before expiry; otherwise expiry recovery returns the full cap and off-chain usage is not payable through this session. |
| Buyer cancels before seller settlement | Full refund; later settlement receives a terminal-state error. |
| Repeated settlement, cancellation, or recovery | Deterministic terminal-state error; no balance or liability change. |
| Failed token transfer | Entire invocation rolls back, including status and liability. |
| Multiple sessions share an asset | Each transition uses only its stored cap; aggregate liability remains covered. |
| Session storage nears expiry | TTL is extended through the recovery window before data can disappear. |

## Rejected Alternatives

### Allowance and `transfer_from`

Allowances add state outside the session contract. They may be shared, revoked,
expired, or consumed by another spender path. Correct isolation would require a
per-session spender or equivalent token support, and recovery would need to
coordinate both contract state and residual allowance. This is more fragile
than locking a bounded cap once.

### Custom account

A custom account can enforce policy in `__check_auth`, but it changes the buyer
wallet requirement and makes authentication code part of the custody boundary.
The existing `policy-wallet-example` does not implement `__check_auth` and must
not be used as evidence for this model. Custom accounts may be evaluated later
as an optional funding source, not as the only way to use `upto-session`.

### Buyer co-signing at settlement

Requiring the buyer again would make the current transfer valid, but it removes
seller-only deferred settlement. It also lets an unavailable or uncooperative
buyer block payment after service use. If that behavior is ever offered, it
must be named as a separate co-sign product rather than `upto` escrow.

## Migration And Compatibility

The deployed `0.1.0` contract is unfunded and has no upgrade entry point. It
must not be mutated or presented as compatible with this decision.

Implementation requires:

- a new storage layout version;
- an immutable supported-asset configuration;
- `escrowed_amount` and an expired terminal state;
- aggregate per-asset liability storage;
- bounded expiry, coordinated TTL extension, and archived-entry restoration;
- a `recover_expired` entry point;
- versioned creation, settlement, cancellation, and recovery events;
- regenerated XDR, TypeScript bindings, fixtures, and backend handoff docs; and
- a new testnet deployment and contract ID.

No open session is migrated from the old contract. Clients must switch contract
IDs explicitly. Historical manifests remain immutable and continue to state
that they prove deployment only.

## Validation Required Before Release

- Assert the exact buyer creation and nested token-transfer authorization tree.
- Settle without buyer authorization or global auth mocks.
- Prove buyer cancellation and permissionless expiry recovery.
- Test wrong signer, insufficient balance, unsupported asset, zero amount,
  over-cap, exact-expiry, repeated calls, failed token transfer, and races.
- Prove the balance and liability invariants with multiple buyers, sellers,
  sessions, and assets.
- Run generated action sequences with reproducible seeds.
- Publish live testnet create, settle, cancel, expiry recovery, and negative
  transactions with before/after balances and decoded events.

## References

- [Stellar contract authorization](https://developers.stellar.org/docs/learn/fundamentals/contract-development/authorization)
- [Soroban SDK `Address::require_auth`](https://docs.rs/soroban-sdk/latest/soroban_sdk/struct.Address.html#method.require_auth)
- [Soroban SDK contract invoker authorization](https://docs.rs/soroban-sdk/latest/soroban_sdk/struct.Env.html#method.authorize_as_current_contract)
- [Soroban token client](https://docs.rs/soroban-sdk/latest/soroban_sdk/token/struct.TokenClient.html)
