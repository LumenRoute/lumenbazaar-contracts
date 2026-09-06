# Security Checklist

This checklist records the contract controls that are ready for audit review.

| Control | Status | Test evidence | Notes |
| --- | --- | --- | --- |
| Authorization boundaries | Complete | `initialize_stores_admin_once`, `create_session_requires_buyer_auth`, `settle_requires_seller_auth`, `settle_rejects_wrong_seller_auth`, `cancel_requires_buyer_auth` | Buyer creates/cancels, seller settles, admin initializes once. |
| Cap enforcement | Complete | `settle_rejects_invalid_amounts_and_expiry`, `validation::tests::rejects_invalid_settlement_amounts` | Settlement must be positive and cannot exceed `max_amount`. |
| Double-settlement prevention | Complete | `settle_prevents_double_settlement`, `settle_rejects_finalized_sessions`, `cancel_rejects_already_settled_session` | Finalized sessions cannot be settled or cancelled again. |
| Expiry handling | Complete | `validation::tests::rejects_expired_sessions`, `validation::tests::rejects_settlement_at_or_after_expiry`, `expired_open_session_remains_observable_and_buyer_cancellable` | New sessions and settlements reject expired ledger windows; expired open sessions remain readable and cancellable. |
| Asset and seller binding | Complete | `validation::tests::rejects_invalid_seller_or_asset_bindings`, `invalid_create_inputs_do_not_consume_sequence` | Seller cannot equal buyer and payment asset cannot equal buyer or seller. |
| Event correctness | Complete | `create_session_emits_stable_event`, `settle_emits_stable_event`, `cancel_emits_stable_event` | Event assertions compare typed event XDR for stable topics and payloads. |

## Remaining Review Notes

- `policy-wallet-example` is not audited wallet infrastructure.
- Resource usage is recorded in `artifacts/resource-usage/upto-session.md`, but live RPC simulation is still required before production fee budgeting.
- `test-token` is utility code for local and testnet testing, not a production asset contract.
