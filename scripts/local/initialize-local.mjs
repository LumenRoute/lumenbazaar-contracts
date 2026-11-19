import { join } from "node:path";
import {
  DEFAULT_RPC_RETRY_POLICY,
  hasFlag,
  invokeContract,
  readManifest,
  repoRoot,
  resolveExpectedNetworkIdentity,
  sourceAccount,
  verifyNetworkPassphraseSync,
} from "../lib/stellar-cli.mjs";

const dryRun = hasFlag("--dry-run");
const source = sourceAccount();
const network = process.env.STELLAR_NETWORK || "local";
const manifest = readManifest(join(repoRoot, "deployments", "local.json"));
const contracts = manifest.contracts || {};

if (!dryRun) {
  verifyNetworkPassphraseSync({ network });
} else {
  resolveExpectedNetworkIdentity(network);
}

const admin = process.env.LUMENBAZAAR_ADMIN || source;
const tokenAdmin = process.env.LUMENBAZAAR_TEST_TOKEN_ADMIN || admin;
const policyOwner = process.env.LUMENBAZAAR_POLICY_OWNER || admin;
const maxSessionAmount = process.env.LUMENBAZAAR_MAX_SESSION_AMOUNT || "1000000000";
if (!/^[1-9][0-9]*$/.test(maxSessionAmount)) {
  throw new Error("LUMENBAZAAR_MAX_SESSION_AMOUNT must be a positive integer");
}
const maxAssetExposure =
  process.env.LUMENBAZAAR_MAX_ASSET_EXPOSURE || "100000000000";
if (!/^[1-9][0-9]*$/.test(maxAssetExposure)) {
  throw new Error("LUMENBAZAAR_MAX_ASSET_EXPOSURE must be a positive integer");
}
const maxBuyerExposure =
  process.env.LUMENBAZAAR_MAX_BUYER_EXPOSURE || "10000000000";
if (!/^[1-9][0-9]*$/.test(maxBuyerExposure)) {
  throw new Error("LUMENBAZAAR_MAX_BUYER_EXPOSURE must be a positive integer");
}
const uptoSessionContract =
  process.env.LUMENBAZAAR_UPTO_SESSION_CONTRACT_ID ||
  contracts["upto-session"]?.contractId ||
  "dry-run-upto-session";
const testTokenContract =
  process.env.LUMENBAZAAR_TEST_TOKEN_CONTRACT_ID ||
  contracts["test-token"]?.contractId ||
  "dry-run-test-token";
const policyWalletContract =
  process.env.LUMENBAZAAR_POLICY_WALLET_CONTRACT_ID ||
  contracts["policy-wallet-example"]?.contractId ||
  "dry-run-policy-wallet";

invokeContract({
  contractId: testTokenContract,
  source: tokenAdmin,
  network,
  args: ["initialize", "--admin", tokenAdmin],
  dryRun,
  timeoutMs: DEFAULT_RPC_RETRY_POLICY.attemptTimeoutMs,
});

invokeContract({
  contractId: uptoSessionContract,
  source: admin,
  network,
  args: [
    "initialize",
    "--admin",
    admin,
    "--asset_policies",
    JSON.stringify([
      {
        asset: testTokenContract,
        max_session_amount: maxSessionAmount,
        max_asset_exposure: maxAssetExposure,
        max_buyer_exposure: maxBuyerExposure,
      },
    ]),
  ],
  dryRun,
  timeoutMs: DEFAULT_RPC_RETRY_POLICY.attemptTimeoutMs,
});

invokeContract({
  contractId: policyWalletContract,
  source: policyOwner,
  network,
  args: [
    "initialize",
    "--owner",
    policyOwner,
    "--upto_session_contract",
    uptoSessionContract,
  ],
  dryRun,
  timeoutMs: DEFAULT_RPC_RETRY_POLICY.attemptTimeoutMs,
});
