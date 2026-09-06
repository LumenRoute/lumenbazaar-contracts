# Local Command Samples

These commands assume `deployments/local.json` has been created by `node scripts/local/deploy-local.mjs` and that the exported IDs below match that manifest.

```powershell
$env:STELLAR_NETWORK = "local"
$env:STELLAR_ACCOUNT = "local-deployer"
$env:UPTO_SESSION_CONTRACT_ID = "C..."
$env:TEST_TOKEN_CONTRACT_ID = "C..."
$env:BUYER = "G..."
$env:SELLER = "G..."
$RESOURCE_HASH = "0000000000000000000000000000000000000000000000000000000000000001"
$USAGE_HASH = "0000000000000000000000000000000000000000000000000000000000000002"
```

Deploy and initialize:

```powershell
node scripts/local/deploy-local.mjs
node scripts/local/initialize-local.mjs
```

Mint local test tokens to the buyer:

```powershell
stellar contract invoke --id $env:TEST_TOKEN_CONTRACT_ID --source-account $env:STELLAR_ACCOUNT --network local -- mint --to $env:BUYER --amount 1000
```

Create a capped session:

```powershell
$SESSION_ID = stellar contract invoke --id $env:UPTO_SESSION_CONTRACT_ID --source-account $env:BUYER --network local -- create_session --buyer $env:BUYER --seller $env:SELLER --asset $env:TEST_TOKEN_CONTRACT_ID --max_amount 100 --expires_at_ledger 500000 --resource_hash $RESOURCE_HASH
```

Inspect the session:

```powershell
stellar contract invoke --id $env:UPTO_SESSION_CONTRACT_ID --source-account $env:BUYER --network local --send no -- get_session --session_id $SESSION_ID
stellar contract read --id $env:UPTO_SESSION_CONTRACT_ID --network local --output json
```

Settle actual usage:

```powershell
stellar contract invoke --id $env:UPTO_SESSION_CONTRACT_ID --source-account $env:SELLER --network local --auth-mode non-root -- settle --session_id $SESSION_ID --actual_amount 42 --usage_hash $USAGE_HASH
```

Cancel before settlement:

```powershell
stellar contract invoke --id $env:UPTO_SESSION_CONTRACT_ID --source-account $env:BUYER --network local -- cancel --session_id $SESSION_ID
```
