# Corrected Testnet Deployment - 2026-10-07

This deployment uses contract source commit `41940839d8f49c733b1815e108fc9740b1285f32` and preserves `deployments/testnet-2026-09-06.json` as historical evidence. The signed transactions used local Stellar identity aliases; no signing material is stored in this repository.

## Public Addresses

- Deployer: `GAVPY5NSR6I4JNQFM5C4CUEVMNPZWT4A5IGXREQEAAPNSC4EHOHYHKH4`
- Dedicated admin: `GCYEX7MPJL64ZJ7ABZSPRC7YEBSI7OMC62FFEVFHCZFREBOYJPQDUCYJ`
- Up-to session v2: `CCENNI5ZMMD3DCJXG5MURDXWUU3NG6JCFHDCDSEI4OMNWDJRY2IR36L3`
- LBT test token: `CB256KDRXDO2FYJN3YBYZE5KCU46WIIE67DRP5T7HI45DRH2GM6YOJFS`
- Policy wallet example: `CDV2BMIT6CSRKQVWL7OH33KG22ADLOGOR2PDUHBHPSHFIMKXUWPX4GFH`

LBT is a custom test-only token. It is not Circle USDC, and this is not a mainnet deployment.

## Reviewed Build

Run from the exact source commit with the versions in `docs/release-toolchain.md`:

```bash
stellar contract build --locked
stellar contract info hash --wasm target/wasm32v1-none/release/upto_session.wasm
stellar contract info hash --wasm target/wasm32v1-none/release/test_token.wasm
stellar contract info hash --wasm target/wasm32v1-none/release/policy_wallet_example.wasm
```

The expected hashes are recorded in `deployments/testnet-2026-10-07.json`.

## Upload And Deploy

Replace the local identity aliases below with identities for the public accounts listed above. The upload commands return the recorded WASM hashes, and the deploy commands return the recorded contract IDs.

```bash
stellar contract upload --wasm target/wasm32v1-none/release/upto_session.wasm --source-account lumenbazaar-testnet-deployer --network testnet
stellar contract deploy --wasm-hash 121431386fedf8149476cbcd79740c242101286520d16456bce5affa7a0a2241 --source-account lumenbazaar-testnet-deployer --network testnet --alias lumenbazaar-upto-session-v2-2026-10-07

stellar contract upload --wasm target/wasm32v1-none/release/test_token.wasm --source-account lumenbazaar-testnet-deployer --network testnet
stellar contract deploy --wasm-hash 3e08bd7b09e3b2d277d5b02d84b52bb7b78ef8c71c794f221b6c7cf3b7a81324 --source-account lumenbazaar-testnet-deployer --network testnet --alias lumenbazaar-test-token-v2-2026-10-07

stellar contract upload --wasm target/wasm32v1-none/release/policy_wallet_example.wasm --source-account lumenbazaar-testnet-deployer --network testnet
stellar contract deploy --wasm-hash c9eb787ddfe517b8b285e6a35943853aec89cada602f910a0a0153152fc7bf8c --source-account lumenbazaar-testnet-deployer --network testnet --alias lumenbazaar-policy-wallet-v2-2026-10-07
```

## Initialize

```bash
stellar contract invoke --id CB256KDRXDO2FYJN3YBYZE5KCU46WIIE67DRP5T7HI45DRH2GM6YOJFS --source-account lumenbazaar-testnet-admin-v2 --network testnet -- initialize --admin GCYEX7MPJL64ZJ7ABZSPRC7YEBSI7OMC62FFEVFHCZFREBOYJPQDUCYJ

stellar contract invoke --id CCENNI5ZMMD3DCJXG5MURDXWUU3NG6JCFHDCDSEI4OMNWDJRY2IR36L3 --source-account lumenbazaar-testnet-admin-v2 --network testnet -- initialize --admin GCYEX7MPJL64ZJ7ABZSPRC7YEBSI7OMC62FFEVFHCZFREBOYJPQDUCYJ --supported_assets-file-path deployments/testnet-v2-supported-assets.json

stellar contract invoke --id CDV2BMIT6CSRKQVWL7OH33KG22ADLOGOR2PDUHBHPSHFIMKXUWPX4GFH --source-account lumenbazaar-testnet-admin-v2 --network testnet -- initialize --owner GCYEX7MPJL64ZJ7ABZSPRC7YEBSI7OMC62FFEVFHCZFREBOYJPQDUCYJ --upto_session_contract CCENNI5ZMMD3DCJXG5MURDXWUU3NG6JCFHDCDSEI4OMNWDJRY2IR36L3
```

## Independent Verification

These commands require no signer and can run from a clean checkout:

```bash
stellar contract info hash --id CCENNI5ZMMD3DCJXG5MURDXWUU3NG6JCFHDCDSEI4OMNWDJRY2IR36L3 --network testnet
stellar contract info interface --id CCENNI5ZMMD3DCJXG5MURDXWUU3NG6JCFHDCDSEI4OMNWDJRY2IR36L3 --network testnet --output json
stellar contract invoke --id CCENNI5ZMMD3DCJXG5MURDXWUU3NG6JCFHDCDSEI4OMNWDJRY2IR36L3 --source-account GCYEX7MPJL64ZJ7ABZSPRC7YEBSI7OMC62FFEVFHCZFREBOYJPQDUCYJ --network testnet --send no -- interface_version
LUMENBAZAAR_DEPLOYMENT_MANIFEST=deployments/testnet-2026-10-07.json node scripts/testnet/verify-testnet.mjs
node scripts/check-deployment-evidence.mjs
```

The live/local comparison on 2026-10-07 returned identical hashes and byte-identical JSON interfaces for all three contracts. `interface_version()` returned `2`. Transaction hashes, ledgers, and timestamps are in the immutable manifest and are publicly queryable through Horizon or Stellar Expert.
