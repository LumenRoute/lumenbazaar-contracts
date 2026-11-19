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

const contracts = [
  deployContract({
    name: "upto-session",
    alias: "lumenbazaar-upto-session-local",
    wasm: "target/wasm32v1-none/release/upto_session.wasm",
    source,
    network,
    dryRun,
    timeoutMs: DEFAULT_RPC_RETRY_POLICY.attemptTimeoutMs,
  }),
  deployContract({
    name: "test-token",
    alias: "lumenbazaar-test-token-local",
    wasm: "target/wasm32v1-none/release/test_token.wasm",
    source,
    network,
    dryRun,
    timeoutMs: DEFAULT_RPC_RETRY_POLICY.attemptTimeoutMs,
  }),
  deployContract({
    name: "policy-wallet-example",
    alias: "lumenbazaar-policy-wallet-local",
    wasm: "target/wasm32v1-none/release/policy_wallet_example.wasm",
    source,
    network,
    dryRun,
    timeoutMs: DEFAULT_RPC_RETRY_POLICY.attemptTimeoutMs,
  }),
];

mergeContracts(manifestPath, contracts, { dryRun });
