# Testnet Lifecycle Evidence - 2026-10-07

The corrected v2 deployment completed a real escrow lifecycle on Stellar testnet with fresh buyer and seller accounts. The complete machine-readable record, including exact commands, is `artifacts/testnet/lifecycle-2026-10-07.json`.

## Result

| Path | Session | Public result |
| --- | --- | --- |
| Create and settle | `5f8f...d896` | 10,000,000 escrowed; 6,500,000 paid; 3,500,000 refunded |
| Create and cancel | `72ba...067e` | 5,000,000 fully refunded |
| Expiry recovery | `af92...00ff` | settlement rejected at ledger 5,067,620; 3,000,000 permissionlessly recovered at ledger 5,067,627 |
| Cross-session seller | `cb27...aea1` | a seller from another session could not authorize settlement; 1,000,000 fully refunded on cleanup |

The buyer began with zero LBT, received 50,000,000 test-only units, and ended with 43,500,000. The seller ended with 6,500,000. The recovery caller and escrow contract both ended with zero. The equation `50,000,000 = 43,500,000 + 6,500,000 + 0 + 0` proves conservation across the published flow.

## Adversarial Results

| Case | Result | Submitted transaction |
| --- | --- | --- |
| Wrong signer | Missing stored seller signing key | No; rejected in simulation |
| Amount above cap | `#8 AmountExceedsCap` | No; rejected in simulation |
| Settlement at expiry | `#4 ExpiredSession` | No; rejected in simulation |
| Repeated settlement | `#6 SessionAlreadySettled` | No; rejected in simulation |
| Repeated cancellation | `#7 SessionCancelled` | No; rejected in simulation |
| Seller from another session | Missing bound seller signing key | No; rejected in simulation |

Rejections have no transaction hash because Stellar CLI simulation refused to build or submit an invalid transaction. The evidence records the observed ledger and command instead of inventing an on-chain record.

## Public Verification

The successful transactions are linked by their hashes in the JSON evidence and can be queried from Horizon or Stellar Expert. Decoded v2 events can be replayed without a signer:

```bash
stellar events --start-ledger 5067573 --id CCENNI5ZMMD3DCJXG5MURDXWUU3NG6JCFHDCDSEI4OMNWDJRY2IR36L3 --type contract --network testnet --output json
node scripts/check-testnet-lifecycle.mjs
```

LBT is a custom test-only token, not Circle USDC. This evidence is testnet-only and makes no mainnet claim.
