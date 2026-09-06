import { join } from "node:path";
import {
  buildContracts,
  deployContract,
  hasFlag,
  mergeContracts,
  repoRoot,
  sourceAccount,
} from "../lib/stellar-cli.mjs";

const dryRun = hasFlag("--dry-run");
const source = sourceAccount();
const manifestPath = join(repoRoot, "deployments", "local.json");

buildContracts({ dryRun });

const contracts = [
  deployContract({
    name: "upto-session",
    alias: "lumenbazaar-upto-session-local",
    wasm: "target/wasm32v1-none/release/upto_session.wasm",
    source,
    network: "local",
    dryRun,
  }),
  deployContract({
    name: "test-token",
    alias: "lumenbazaar-test-token-local",
    wasm: "target/wasm32v1-none/release/test_token.wasm",
    source,
    network: "local",
    dryRun,
  }),
  deployContract({
    name: "policy-wallet-example",
    alias: "lumenbazaar-policy-wallet-local",
    wasm: "target/wasm32v1-none/release/policy_wallet_example.wasm",
    source,
    network: "local",
    dryRun,
  }),
];

mergeContracts(manifestPath, contracts, { dryRun });
