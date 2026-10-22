import { join } from "node:path";
import { recordReceipt, requireTestnet } from "../lib/network-receipts.mjs";
import {
  hasFlag,
  invokeContractTransaction,
  mergeContracts,
  publicKey,
  readManifest,
  repoRoot,
  sourceAccount,
} from "../lib/stellar-cli.mjs";

const dryRun = hasFlag("--dry-run");
const source = sourceAccount("testnet-deployer");
const manifestPath = join(repoRoot, "deployments", "testnet.json");
const manifest = readManifest(manifestPath);
const contracts = manifest.contracts || {};

if (!dryRun) {
  requireTestnet();
}

const admin = process.env.LUMENBAZAAR_ADMIN || source;
const tokenAdmin = process.env.LUMENBAZAAR_TEST_TOKEN_ADMIN || admin;
const policyOwner = process.env.LUMENBAZAAR_POLICY_OWNER || admin;
const maxSessionAmount = process.env.LUMENBAZAAR_MAX_SESSION_AMOUNT || "1000000000";
if (!/^[1-9][0-9]*$/.test(maxSessionAmount)) {
  throw new Error("LUMENBAZAAR_MAX_SESSION_AMOUNT must be a positive integer");
}
const uptoSessionContract = contractId("upto-session", "LUMENBAZAAR_UPTO_SESSION_CONTRACT_ID");
const testTokenContract = contractId("test-token", "LUMENBAZAAR_TEST_TOKEN_CONTRACT_ID");
const policyWalletContract = contractId("policy-wallet-example", "LUMENBAZAAR_POLICY_WALLET_CONTRACT_ID");

const initialized = [];

await initialize("test-token", testTokenContract, tokenAdmin, [
  "initialize",
  "--admin",
  dryRun ? tokenAdmin : publicKey(tokenAdmin),
]);

await initialize("upto-session", uptoSessionContract, admin, [
  "initialize",
  "--admin",
  dryRun ? admin : publicKey(admin),
  "--asset_policies",
  JSON.stringify([{ asset: testTokenContract, max_session_amount: maxSessionAmount }]),
]);

await initialize("policy-wallet-example", policyWalletContract, policyOwner, [
  "initialize",
  "--owner",
  dryRun ? policyOwner : publicKey(policyOwner),
  "--upto_session_contract",
  uptoSessionContract,
]);

if (!dryRun && contracts["upto-session"]) {
  const version = invokeContractTransaction({
    contractId: uptoSessionContract,
    source: admin,
    args: ["interface_version"],
    send: "no",
  }).stdout;
  initialized.push({ name: "upto-session", interfaceVersion: Number(version) });
}

mergeContracts(manifestPath, initialized, {
  dryRun,
  mergeEntries: true,
  fields: { admin: dryRun ? admin : publicKey(admin) },
});

async function initialize(name, id, signer, args) {
  if (!dryRun && !contracts[name] && !process.env[envName(name)]) {
    console.log(`skipped ${name}: not deployed in deployments/testnet.json`);
    return;
  }
  const { transactionHash } = invokeContractTransaction({ contractId: id, source: signer, args, dryRun });
  if (dryRun) {
    return;
  }
  if (!transactionHash) {
    throw new Error(`Initializing ${name} returned no transaction hash.`);
  }
  await recordReceipt(transactionHash);
  initialized.push({ name, initialize: { transactionHash } });
  console.log(`initialized ${name}`);
}

function contractId(name, variable) {
  return process.env[variable] || contracts[name]?.contractId || `dry-run-${name}`;
}

function envName(name) {
  return {
    "upto-session": "LUMENBAZAAR_UPTO_SESSION_CONTRACT_ID",
    "test-token": "LUMENBAZAAR_TEST_TOKEN_CONTRACT_ID",
    "policy-wallet-example": "LUMENBAZAAR_POLICY_WALLET_CONTRACT_ID",
  }[name];
}
