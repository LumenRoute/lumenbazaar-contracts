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
const source = sourceAccount("testnet-deployer");
const manifestPath = join(repoRoot, "deployments", "testnet.json");

buildContracts({ dryRun });

const contracts = [
  deployContract({
    name: "upto-session",
    alias: "lumenbazaar-upto-session-testnet",
    wasm: "target/wasm32v1-none/release/upto_session.wasm",
    source,
    network: "testnet",
    dryRun,
  }),
  deployContract({
    name: "test-token",
    alias: "lumenbazaar-test-token-testnet",
    wasm: "target/wasm32v1-none/release/test_token.wasm",
    source,
    network: "testnet",
    dryRun,
  }),
  deployContract({
    name: "policy-wallet-example",
    alias: "lumenbazaar-policy-wallet-testnet",
    wasm: "target/wasm32v1-none/release/policy_wallet_example.wasm",
    source,
    network: "testnet",
    dryRun,
  }),
];

mergeContracts(manifestPath, contracts, { dryRun });
