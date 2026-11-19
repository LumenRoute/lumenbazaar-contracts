import { join } from "node:path";
import {
  DEFAULT_RPC_RETRY_POLICY,
  buildContracts,
  deployContract,
  hasFlag,
  mergeContracts,
  repoRoot,
  resolveExpectedNetworkIdentity,
  sourceAccount,
  verifyNetworkPassphraseSync,
} from "../lib/stellar-cli.mjs";

const dryRun = hasFlag("--dry-run");
const source = sourceAccount();
const network = process.env.STELLAR_NETWORK || "local";
const manifestPath = join(repoRoot, "deployments", "local.json");

if (!dryRun) {
  verifyNetworkPassphraseSync({ network });
} else {
  resolveExpectedNetworkIdentity(network);
}

buildContracts({ dryRun });

const testToken = deployContract({
  name: "test-token",
  alias: "lumenbazaar-test-token-local",
  wasm: "target/wasm32v1-none/release/test_token.wasm",
  source,
  network,
  dryRun,
  timeoutMs: DEFAULT_RPC_RETRY_POLICY.attemptTimeoutMs,
});

mergeContracts(manifestPath, [testToken], { dryRun });
