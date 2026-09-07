# Deployments

Deployment manifests are written here by the repo scripts.

- `local.json` is ignored and belongs to a developer machine.
- `testnet.json` is ignored until the project chooses to publish a specific deployment.
- Example manifests may be committed when they document the expected shape.
- `testnet-2026-09-06.json` is the sanitized public evidence for the first testnet deployment. It
  contains no signing material and does not claim a live payment flow.

For testnet:

1. Copy `.env.testnet.example` to `.env.testnet` or export the same variables in your shell.
2. Run `node scripts/testnet/deploy-testnet.mjs`.
3. Run `node scripts/testnet/initialize-testnet.mjs`.
4. Run `node scripts/testnet/verify-testnet.mjs`.
5. Share the resulting `deployments/testnet.json` with backend operators through the agreed secure handoff channel.

Validate committed public evidence with `node scripts/check-deployment-evidence.mjs`.
