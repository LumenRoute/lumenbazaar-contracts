# Policy Wallet Examples

These examples are mirrored by executable tests in `src/test.rs`.

Spending policy validity boundaries are inclusive: a policy is active for ledger sequences satisfying `valid_from_ledger <= ledger_sequence <= valid_until_ledger`.

| Scenario | Test name | Expected result |
| --- | --- | --- |
| Allowed payment | `documentation_allowed_payment_example_authorizes` | The agent-authorized payment succeeds and increments daily spend. |
| Blocked payment | `documentation_blocked_payment_example_reports_amount_cap` | A payment over the per-payment cap returns `AmountExceedsPaymentCap`. |
| Seller payment cap | `documentation_seller_payment_cap_example_reports_amount_cap` | A payment over the seller-specific per-payment cap returns `AmountExceedsPaymentCap`. |
| Seller daily cap | `documentation_seller_daily_cap_example_reports_daily_cap` | A payment over the seller-specific daily cap returns `AmountExceedsDailyCap` while other sellers remain spendable. |
| Resource payment cap | `documentation_resource_payment_cap_example_reports_amount_cap` | A payment over the resource-specific per-payment cap returns `AmountExceedsPaymentCap`. |
| Resource daily cap | `documentation_resource_daily_cap_example_reports_daily_cap` | A payment over the resource-specific daily cap returns `AmountExceedsDailyCap` while other resources remain spendable. |
| Authorization count limit | `documentation_authorization_limit_example_reports_limit_exceeded` | An authorization exceeding `max_authorizations_per_day` returns `AuthorizationLimitExceeded`. |
| Pre-activation policy | `documentation_pre_activation_policy_example_reports_not_active` | A payment checked before `valid_from_ledger` returns `PolicyNotActive` and leaves spend unchanged. |
| Expired policy | `documentation_expired_policy_example_reports_expired` | A payment checked after `valid_until_ledger` returns `PolicyExpired`. |
| Wrong seller | `documentation_wrong_seller_example_reports_seller_error` | A seller outside the allowlist returns `SellerNotAllowed`. |
| Wrong asset | `documentation_wrong_asset_example_reports_asset_error` | An asset outside the allowlist returns `AssetNotAllowed`. |

## Policy Replacement and Day Rollover Semantics

- **Policy Replacement**: When a spending policy is replaced via `set_policy`, stored same-day and historical spend counters (`DailySpend`, `DailySellerSpend`, and `DailyResourceSpend`) are preserved. New caps take effect immediately against already-accumulated daily spend.
- **Day Rollover**: All daily spending counters are partitioned by ledger day (`sequence / LEDGERS_PER_DAY`). When the ledger sequence advances past the day boundary, all spend queries and authorization checks reset to zero automatically.
