# Test Token Contract

`test-token` is a local utility contract for LumenBazaar contract tests. It is
not part of the production capped-session payment path.

It implements only the helper surface needed for local tests:

- one-time admin initialization
- admin-only minting
- holder-authorized transfers
- balance inspection
- static token metadata

Production `upto-session` deployments should use the Stellar Asset Contract for
the configured SEP-41 asset. The token's symbol is LBT; it is a custom
test-only token and is not USDC. `scripts/check-test-token-guard.mjs` rejects
any deployment manifest or release artifact list that includes `test-token`
under a pubnet, production, unknown or missing network label, and runs in CI and
in the testnet WASM release workflow. Local and testnet use is unaffected (see
"Test-token release guard" in `deployments/README.md`). This package exists so workspace tests can exercise
local token behavior without depending on external token state.

The opt-in `testutils` feature also exports an adversarial token harness with
failed-transfer, false-balance, partial-transfer, and nested-callback modes. It
is compiled only for host-side security tests and is not present in the default
test-token WASM build.
