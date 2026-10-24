# Deployments

Deployment manifests are written here by the repo scripts.

- `local.json` is ignored and belongs to a developer machine.
- `testnet.json` is ignored until the project chooses to publish a specific deployment.
- Example manifests may be committed when they document the expected shape.
- `testnet-2026-09-06.json` is the sanitized public evidence for the first testnet deployment. It
  contains no signing material and does not claim a live payment flow.
- `testnet-2026-10-07.json` is the immutable corrected v2 deployment evidence. It records the
  reviewed source commit, dedicated public admin, exact toolchain, WASM and interface hashes, and
  upload/deploy/initialize transactions without replacing the September record.
- `testnet-v2-supported-assets.json` is the public initialization input for the corrected escrow
  deployment.
- `testnet-2026-10-20.json` is the first generated manifest: the interface v3 `upto-session` and
  LBT `test-token` deployment used for the live rejection evidence in
  `artifacts/testnet/live-evidence-2026-10-20.json`. It is evidence infrastructure, not a release.

For testnet:

1. Copy `.env.testnet.example` to `.env.testnet` or export the same variables in your shell.
2. Run `node scripts/testnet/deploy-testnet.mjs` (optionally `--contracts upto-session,test-token`).
3. Run `node scripts/testnet/initialize-testnet.mjs`.
4. Run `node scripts/testnet/verify-testnet.mjs`.
5. Share the resulting `deployments/testnet.json` with backend operators through the agreed secure handoff channel.
6. Publish the sanitized record with `node scripts/testnet/generate-public-manifest.mjs`.

Validate committed public evidence with `node scripts/check-deployment-evidence.mjs`.

## Generating public manifests

The deploy and initialize scripts record every transaction hash in the ignored
`deployments/testnet.json` and save the network's own receipt for each transaction under the
ignored `deployments/receipts/testnet/<hash>.json`. A receipt holds only public fields from RPC
`getTransaction`: status, ledger, the ledger close time, and the source account. Public RPC keeps
transactions for a limited window, so receipts are captured at deployment time.

```bash
node scripts/testnet/generate-public-manifest.mjs                 # deployments/testnet-YYYY-MM-DD.json
node scripts/testnet/generate-public-manifest.mjs --kind evidence # artifacts/testnet/live-evidence-YYYY-MM-DD.json
node scripts/testnet/generate-public-manifest.mjs --dry-run       # validate only, write nothing
```

The generator copies an allowlist of public fields. Ledgers and timestamps come only from receipts,
never from local clocks or local manifest values, and the file date is the earliest receipt close
time. Keys are sorted and the output ends with a newline, so regenerating from the same inputs is
byte-identical; an existing file with different content is never overwritten.

It exits non-zero and writes nothing when:

- the input network is not `testnet`, or a receipt is not a testnet receipt for that transaction;
- any recorded transaction has no receipt, a deployment transaction did not succeed, or a
  transaction was signed by an account other than the recorded deployer (upload, deploy) or admin
  (initialize);
- the input has a field outside the allowlist. Known local-only fields (`alias`, `name`, `network`,
  `wasm`, `generatedAt`, `localAliases`) are dropped and listed; anything else is reported by path;
- secret-pattern validation matches. The scan runs before writing and reports the field path and
  rule, never the value. It rejects Stellar secret seeds, BIP-39-style mnemonic word runs, 64-hex
  values outside hash fields, absolute local paths (`/home/`, `/Users/`, drive letters), `.stellar`
  and `.soroban` paths, long base64 XDR envelopes, configured identity aliases (manifest aliases,
  `LUMENBAZAAR_*`/`STELLAR_ACCOUNT` variables, and `stellar keys ls`), and the repository's
  `lumenbazaar-*-deployer/admin/buyer/seller` alias naming convention;
- the result fails the same validation as `scripts/check-deployment-evidence.mjs`, which the
  generator also runs after writing.

When the CLI skips a WASM upload because another account already installed it, the deploy script
submits the install transaction explicitly so the published upload is signed by the deployer.

## Live rejection evidence

`scripts/testnet/smoke-testnet.mjs` records the live cases for wrong signers, over-cap settlement,
and the expiry boundary against a published deployment manifest. It needs five funded local
identities, created for example with `stellar keys generate <name> --network testnet --fund`, which
stay in the CLI's ignored configuration directory:

```bash
LUMENBAZAAR_ADMIN=<token admin> LUMENBAZAAR_BUYER=<buyer> LUMENBAZAAR_SELLER=<seller> \
LUMENBAZAAR_WRONG_SELLER=<other account> LUMENBAZAAR_WRONG_BUYER=<other account> \
  node scripts/testnet/smoke-testnet.mjs --deployment-manifest deployments/testnet-YYYY-MM-DD.json
node scripts/testnet/generate-public-manifest.mjs --kind evidence
```

Rejected attempts are submitted as real transactions so the network, not the CLI, rejects them.
Each is built without simulation, given the resource footprint of a valid sibling simulation, and
signed by the attempting account. Expiry cases poll RPC `getLatestLedger` with a bounded timeout
instead of sleeping. A case that could only be observed in simulation must be labelled
`simulation-only` with no transaction hash; the generator and checker reject anything else.

## Scheduled Horizon verification

`.github/workflows/horizon-evidence.yml` runs daily and on manual dispatch, never on pull requests,
with read-only permissions and no secrets. It runs `node scripts/verify-horizon-evidence.mjs`, which
resolves every transaction in `deployments/testnet-*.json`,
`artifacts/testnet/lifecycle-*.json`, and `artifacts/testnet/live-evidence-*.json` through Horizon
`/transactions/{hash}` and compares the ledger, close time, source account, and success flag with the
published expected outcome. Rejections published as on-ledger failures must verify as failed.
Simulation-only rejections have no transaction and are counted separately.

Reading a result:

- **Exit 0, VERIFIED:** every published transaction matches Horizon.
- **Exit 1, MISMATCH (job fails):** Horizon contradicts the evidence, for example a missing
  transaction, a different ledger or signer, or a success flag that differs from the expected
  outcome. Treat this as an evidence-integrity failure. The summary table lists each operation with
  an explorer link, and the manifest links point at the tested commit. A testnet reset also appears
  here as missing transactions.
- **Exit 2, OUTAGE (warning only):** Horizon timed out or returned 5xx/429 after one attempt plus
  three retries with backoff. Nothing was contradicted; rerun the workflow.

Pull-request CI never contacts testnet. It runs the offline generator and verifier tests, which
cover mismatches and outages against fixtures and a loopback server.

`replacement-rehearsal.example.json` documents the client routing state used by
the executable local replacement rehearsal. Live rehearsal evidence is written
under ignored `target/rehearsals/`; it is local evidence, not a public deployment
claim.

`scripts/testnet/smoke-lifecycle.mjs` is an opt-in runner that submits a bounded live lifecycle and
writes a sanitized report under ignored `target/testnet-smoke/`. See `docs/testnet-lifecycle-smoke.md`.
Reports are not committed unless the project chooses to publish one as evidence.

The exact build, deployment, and independent verification commands for the corrected deployment
are in `docs/testnet-deployment-2026-10-07.md`.
