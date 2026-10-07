import { readFileSync } from "node:fs";
import { join } from "node:path";

import { repoRoot } from "./lib/stellar-cli.mjs";

const evidencePath = join(repoRoot, "artifacts", "testnet", "lifecycle-2026-10-07.json");
const source = readFileSync(evidencePath, "utf8");
const evidence = JSON.parse(source);
const hashPattern = /^[a-f0-9]{64}$/;
const contractPattern = /^C[A-Z2-7]{55}$/;
const accountPattern = /^G[A-Z2-7]{55}$/;
const secretPattern = /\bS[A-Z2-7]{55}\b/;
const requiredRejections = new Set([
  "wrong_signer",
  "over_cap",
  "expired_settlement",
  "repeated_settle",
  "repeated_cancel",
  "cross_session_seller",
]);

if (secretPattern.test(source)) {
  throw new Error("Lifecycle evidence contains signing material.");
}
if (evidence.network !== "testnet" || !contractPattern.test(evidence.contractId)) {
  throw new Error("Lifecycle evidence has an invalid network or contract ID.");
}
if (!contractPattern.test(evidence.asset?.contractId)) {
  throw new Error("Lifecycle evidence has an invalid asset contract ID.");
}
for (const [name, account] of Object.entries(evidence.actors)) {
  if (!accountPattern.test(account)) {
    throw new Error(`Lifecycle actor ${name} is invalid.`);
  }
}

for (const operation of evidence.successfulOperations) {
  if (!hashPattern.test(operation.transactionHash)) {
    throw new Error(`Successful operation ${operation.name} has no transaction hash.`);
  }
  if (!Number.isInteger(operation.ledger) || Number.isNaN(Date.parse(operation.createdAt))) {
    throw new Error(`Successful operation ${operation.name} has incomplete ledger evidence.`);
  }
  if (typeof operation.command !== "string" || !operation.command.startsWith("stellar ")) {
    throw new Error(`Successful operation ${operation.name} has no replay command.`);
  }
  if (operation.event && operation.event.eventVersion !== 2) {
    throw new Error(`Successful operation ${operation.name} has the wrong event version.`);
  }
}

for (const rejection of evidence.rejections) {
  requiredRejections.delete(rejection.name);
  if (rejection.transactionHash !== null) {
    throw new Error(`Rejected simulation ${rejection.name} must not claim a transaction hash.`);
  }
  if (!Number.isInteger(rejection.observedAtLedger) || !rejection.result || !rejection.command) {
    throw new Error(`Rejected simulation ${rejection.name} has incomplete evidence.`);
  }
}
if (requiredRejections.size > 0) {
  throw new Error(`Lifecycle evidence is missing rejections: ${[...requiredRejections].join(", ")}`);
}

const before = evidence.balances.beforeMint;
const after = evidence.balances.afterLifecycle;
const minted = BigInt(evidence.balances.mintedToBuyer);
const beforeTotal = Object.values(before).reduce((sum, value) => sum + BigInt(value), 0n);
const afterTotal = Object.values(after).reduce((sum, value) => sum + BigInt(value), 0n);
if (beforeTotal + minted !== afterTotal || BigInt(after.escrowContract) !== 0n) {
  throw new Error("Lifecycle token balances do not conserve value or leave escrow empty.");
}

const statuses = Object.values(evidence.terminalSessions).map((session) => session.status);
for (const required of ["Settled", "Cancelled", "Expired"]) {
  if (!statuses.includes(required)) {
    throw new Error(`Lifecycle evidence has no terminal ${required} session.`);
  }
}
for (const session of Object.values(evidence.terminalSessions)) {
  if (session.escrowedAmount !== "0") {
    throw new Error("A terminal lifecycle session retains escrow.");
  }
}

console.log("testnet lifecycle evidence is complete and value-conserving");
