# Reviewed Mismatches

`scripts/reproduce-testnet-wasm.mjs` and the testnet WASM release workflow fail
when a clean build does not reproduce a hash recorded in a deployment manifest.
A file in this directory is the only way to publish such a release, and it must
be merged through review before the release tag is created.

The file name is the manifest's file name, for example `testnet-2026-09-06.json`.
The format is strict: unknown keys, missing fields and malformed values fail the
release.

```json
{
  "schemaVersion": 1,
  "manifest": "deployments/testnet-2026-09-06.json",
  "entries": [
    {
      "kind": "hash-mismatch",
      "artifact": "upto_session.wasm",
      "recordedSha256": "<64 lowercase hex: the hash in the manifest>",
      "reproducedSha256": "<64 lowercase hex: the hash the clean build produced>",
      "reason": "<at least 40 characters explaining why the bytes differ and why that is safe>",
      "reviewedBy": "@github-handle",
      "reviewedAt": "YYYY-MM-DD",
      "reviewUrl": "https://github.com/LumenRoute/lumenbazaar-contracts/pull/<number>"
    },
    {
      "kind": "excluded-unrecorded-artifact",
      "artifact": "policy_wallet_example.wasm",
      "reproducedSha256": "<64 lowercase hex>",
      "reason": "<at least 40 characters explaining why the build produces it but the deployment did not use it>",
      "reviewedBy": "@github-handle",
      "reviewedAt": "YYYY-MM-DD",
      "reviewUrl": "https://github.com/LumenRoute/lumenbazaar-contracts/pull/<number>"
    }
  ]
}
```

Rules:

- `hash-mismatch` applies only when both hashes match exactly. The artifact is
  published and labelled `reviewed-mismatch` in `checksums.json`. The manifest's
  recorded hash is never edited.
- `excluded-unrecorded-artifact` applies only to a built artifact that the
  manifest does not record, with exactly that reproduced hash. Excluded artifacts
  are never published.
- An entry that does not apply to the build fails the release.
- Never add an entry to make a release pass without understanding the difference.

No reviewed mismatches are committed today.
